import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { JwtPayload, RoleName } from '@nexus/types';
import { PrismaService } from '../prisma/prisma.service';
import { TenantUserRepository } from '../tenancy/tenant-user.repository';
import { AuditService } from '../audit/audit.service';
import { Role } from '../rbac/roles.enum';
import { PasswordService } from './password.service';
import { TwoFaService } from './twofa.service';
import { TokenService, TokenPair } from './token.service';
import { PlatformLoginDto, TenantLoginDto } from './dto/auth.dto';

interface RequestCtx {
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantUsers: TenantUserRepository,
    private readonly passwords: PasswordService,
    private readonly twoFa: TwoFaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  // ─── Preferências do utilizador (tema por perfil) ───────────
  private static readonly THEME_WHITELIST = new Set([
    '', 'grafite', 'oceano', 'violeta', 'esmeralda', 'indigo', 'neon', 'claro',
  ]);

  /** Tema guardado para o utilizador autenticado (vazio = padrão). */
  async getPreferences(user: JwtPayload): Promise<{ theme: string }> {
    try {
      if (user.subjectType === 'PLATFORM') {
        const pu = await this.prisma.platformUser.findUnique({
          where: { id: user.sub },
          select: { theme: true },
        });
        return { theme: pu?.theme ?? '' };
      }
      const theme = await this.tenantUsers.getTheme(user.tenantSchema!, user.sub);
      return { theme };
    } catch {
      return { theme: '' };
    }
  }

  /** Grava o tema do utilizador (ignora valores fora da lista). */
  async setPreferences(user: JwtPayload, theme: string): Promise<{ theme: string }> {
    const clean = AuthService.THEME_WHITELIST.has(theme) ? theme : '';
    try {
      if (user.subjectType === 'PLATFORM') {
        await this.prisma.platformUser.update({
          where: { id: user.sub },
          data: { theme: clean },
        });
      } else {
        await this.tenantUsers.setTheme(user.tenantSchema!, user.sub, clean);
      }
    } catch {
      /* best-effort — não falha o pedido por causa da preferência */
    }
    return { theme: clean };
  }

  // ─── Login do Super Admin (plataforma) ──────────────────────
  async platformLogin(
    dto: PlatformLoginDto,
    ctx: RequestCtx,
  ): Promise<TokenPair> {
    const user = await this.prisma.platformUser.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    const ok =
      user && user.isActive && (await this.passwords.verify(user.passwordHash, dto.password));

    if (!user || !ok) {
      await this.audit.record({
        actorType: 'PLATFORM',
        actorId: user?.id ?? null,
        action: 'LOGIN_FAILED',
        entity: 'PlatformUser',
        entityId: user?.id ?? null,
        ip: ctx.ip,
        after: { email: dto.email },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const twoFaVerified = this.checkTwoFa(
      user.twoFaEnabled,
      user.twoFaSecret,
      dto.twoFaToken,
    );

    await this.prisma.platformUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role as RoleName,
      subjectType: 'PLATFORM',
      twoFaVerified,
    };

    await this.audit.record({
      actorType: 'PLATFORM',
      actorId: user.id,
      action: 'LOGIN_SUCCESS',
      entity: 'PlatformUser',
      entityId: user.id,
      ip: ctx.ip,
    });

    return this.tokens.issuePair(payload, ctx);
  }

  // ─── Login de utilizador de empresa (tenant) ────────────────
  async tenantLogin(dto: TenantLoginDto, ctx: RequestCtx): Promise<TokenPair> {
    if (!dto.companyCode) {
      throw new UnauthorizedException('Company code is required');
    }
    const company = await this.prisma.company.findUnique({
      where: { code: dto.companyCode },
    });
    if (!company) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (company.status !== 'ACTIVE') {
      throw new ForbiddenException(`Company is ${company.status.toLowerCase()}`);
    }

    const user = await this.tenantUsers.findByEmail(
      company.schemaName,
      dto.email.toLowerCase(),
    );

    if (!user || !user.is_active) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.locked_until && user.locked_until > new Date()) {
      throw new ForbiddenException(
        'Account temporarily locked due to failed login attempts',
      );
    }

    const passwordOk = await this.passwords.verify(
      user.password_hash,
      dto.password,
    );
    if (!passwordOk) {
      await this.tenantUsers.markLoginFailure(company.schemaName, user.id);
      await this.audit.record({
        actorType: 'TENANT',
        actorId: user.id,
        tenantSchema: company.schemaName,
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: user.id,
        ip: ctx.ip,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const twoFaVerified = this.checkTwoFa(
      user.two_fa_enabled,
      user.two_fa_secret,
      dto.twoFaToken,
    );

    await this.tenantUsers.markLoginSuccess(company.schemaName, user.id);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      subjectType: 'TENANT',
      tenantId: company.id,
      tenantSchema: company.schemaName,
      storeId: user.store_id ?? undefined,
      twoFaVerified,
    };

    await this.audit.record({
      actorType: 'TENANT',
      actorId: user.id,
      tenantSchema: company.schemaName,
      action: 'LOGIN_SUCCESS',
      entity: 'User',
      entityId: user.id,
      ip: ctx.ip,
    });

    return this.tokens.issuePair(payload, ctx);
  }

  // ─── Caixa: lista de operadores (nomes) por empresa ─────────
  async listOperators(
    companyCode: string,
  ): Promise<{ id: string; name: string; role: string }[]> {
    const company = await this.prisma.company.findUnique({ where: { code: companyCode } });
    if (!company || company.status !== 'ACTIVE') return [];
    return this.tenantUsers.listOperators(company.schemaName);
  }

  // ─── Caixa: login por NOME (id) + PIN (estilo Vendus) ───────
  async pinLogin(
    dto: { companyCode: string; userId: string; pin: string },
    ctx: RequestCtx,
  ): Promise<TokenPair> {
    const company = await this.prisma.company.findUnique({ where: { code: dto.companyCode } });
    if (!company) throw new UnauthorizedException('Credenciais inválidas');
    if (company.status !== 'ACTIVE') {
      throw new ForbiddenException(`Empresa ${company.status.toLowerCase()}`);
    }
    const user = await this.tenantUsers.findById(company.schemaName, dto.userId);
    if (!user || !user.is_active || !user.pin_hash) {
      throw new UnauthorizedException('Operador inválido ou sem PIN');
    }
    if (user.locked_until && user.locked_until > new Date()) {
      throw new ForbiddenException('Operador temporariamente bloqueado (tentativas falhadas)');
    }
    const ok = await this.passwords.verify(user.pin_hash, dto.pin);
    if (!ok) {
      await this.tenantUsers.markLoginFailure(company.schemaName, user.id);
      throw new UnauthorizedException('PIN incorreto');
    }
    await this.tenantUsers.markLoginSuccess(company.schemaName, user.id);
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      subjectType: 'TENANT',
      tenantId: company.id,
      tenantSchema: company.schemaName,
      storeId: user.store_id ?? undefined,
      twoFaVerified: true, // operador de caixa entra por PIN (sem 2FA)
    };
    await this.audit.record({
      actorType: 'TENANT', actorId: user.id, tenantSchema: company.schemaName,
      action: 'LOGIN_SUCCESS_PIN', entity: 'User', entityId: user.id, ip: ctx.ip,
    });
    return this.tokens.issuePair(payload, ctx);
  }

  // ─── Acesso shadow do Super Admin (impersonation, §2.2) ─────
  /**
   * O Super Admin entra no painel de uma empresa SEM saber a senha: emite um
   * par de tokens TENANT em nome do administrador da empresa. Auditado como
   * SHADOW_ACCESS. Não revela nem altera a senha do utilizador.
   */
  async impersonate(
    companyId: string,
    ctx: { adminId?: string | null; ip?: string | null },
  ): Promise<{ tokens: TokenPair; companyCode: string; companyName: string; email: string }> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Empresa não encontrada');

    const user = await this.tenantUsers.findByEmail(
      company.schemaName,
      company.responsibleEmail.toLowerCase(),
    );
    if (!user || !user.is_active) {
      throw new BadRequestException('A empresa não tem um administrador activo para aceder.');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      subjectType: 'TENANT',
      tenantId: company.id,
      tenantSchema: company.schemaName,
      storeId: user.store_id ?? undefined,
      twoFaVerified: true,
    };

    await this.audit.record({
      actorType: 'PLATFORM',
      actorId: ctx.adminId ?? null,
      tenantSchema: company.schemaName,
      action: 'SHADOW_ACCESS',
      entity: 'Company',
      entityId: companyId,
      after: { impersonated: user.email },
      ip: ctx.ip,
    });

    const tokens = await this.tokens.issuePair(payload, { ip: ctx.ip });
    return { tokens, companyCode: company.code, companyName: company.name, email: user.email };
  }

  // ─── Refresh com rotação ────────────────────────────────────
  async refresh(rawRefresh: string, ctx: RequestCtx): Promise<TokenPair> {
    const payload = await this.reconstructPayload(rawRefresh);
    return this.tokens.rotate(rawRefresh, payload, ctx);
  }

  async logout(rawRefresh: string): Promise<void> {
    await this.tokens.revoke(rawRefresh);
  }

  // ─── Setup de 2FA ───────────────────────────────────────────
  async beginTwoFaSetup(
    user: JwtPayload,
  ): Promise<{ secret: string; qrCodeDataUrl: string; otpAuthUrl: string }> {
    const secret = this.twoFa.generateSecret();
    const otpAuthUrl = this.twoFa.buildOtpAuthUrl(user.email, secret);
    const qrCodeDataUrl = await this.twoFa.buildQrCodeDataUrl(otpAuthUrl);

    if (user.subjectType === 'PLATFORM') {
      await this.prisma.platformUser.update({
        where: { id: user.sub },
        data: { twoFaSecret: secret, twoFaEnabled: false },
      });
    } else {
      await this.tenantUsers.setTwoFaSecret(
        user.tenantSchema!,
        user.sub,
        secret,
        false,
      );
    }
    return { secret, qrCodeDataUrl, otpAuthUrl };
  }

  async confirmTwoFa(user: JwtPayload, token: string): Promise<void> {
    let secret: string | null = null;
    if (user.subjectType === 'PLATFORM') {
      const pu = await this.prisma.platformUser.findUnique({
        where: { id: user.sub },
      });
      secret = pu?.twoFaSecret ?? null;
    } else {
      const tu = await this.tenantUsers.findById(user.tenantSchema!, user.sub);
      secret = tu?.two_fa_secret ?? null;
    }
    if (!secret || !this.twoFa.verify(token, secret)) {
      throw new UnauthorizedException('Invalid 2FA token');
    }
    if (user.subjectType === 'PLATFORM') {
      await this.prisma.platformUser.update({
        where: { id: user.sub },
        data: { twoFaEnabled: true },
      });
    } else {
      await this.tenantUsers.setTwoFaSecret(
        user.tenantSchema!,
        user.sub,
        secret,
        true,
      );
    }
    await this.audit.record({
      actorType: user.subjectType,
      actorId: user.sub,
      tenantSchema: user.tenantSchema ?? null,
      action: 'TWOFA_ENABLED',
      ip: null,
    });
  }

  // ─── Helpers ────────────────────────────────────────────────
  private checkTwoFa(
    enabled: boolean,
    secret: string | null,
    token?: string,
  ): boolean {
    if (!enabled) return true;
    if (!secret) return true;
    if (!token) {
      throw new UnauthorizedException({
        message: 'Two-factor authentication token required',
        error: 'TwoFaRequired',
      });
    }
    if (!this.twoFa.verify(token, secret)) {
      throw new UnauthorizedException('Invalid 2FA token');
    }
    return true;
  }

  private async reconstructPayload(rawRefresh: string): Promise<JwtPayload> {
    const { createHash } = await import('node:crypto');
    const tokenHash = createHash('sha256').update(rawRefresh).digest('hex');
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (record.subjectType === 'PLATFORM') {
      const u = await this.prisma.platformUser.findUnique({
        where: { id: record.subjectId },
      });
      if (!u || !u.isActive) throw new UnauthorizedException('Account disabled');
      return {
        sub: u.id,
        email: u.email,
        role: u.role as RoleName,
        subjectType: 'PLATFORM',
        twoFaVerified: !u.twoFaEnabled,
      };
    }

    const company = await this.prisma.company.findUnique({
      where: { schemaName: record.tenantSchema! },
    });
    if (!company || company.status !== 'ACTIVE') {
      throw new ForbiddenException('Company not active');
    }
    const u = await this.tenantUsers.findById(
      record.tenantSchema!,
      record.subjectId,
    );
    if (!u || !u.is_active) throw new UnauthorizedException('Account disabled');
    return {
      sub: u.id,
      email: u.email,
      role: u.role,
      subjectType: 'TENANT',
      tenantId: company.id,
      tenantSchema: company.schemaName,
      storeId: u.store_id ?? undefined,
      twoFaVerified: !u.two_fa_enabled,
    };
  }
}

export { Role };
