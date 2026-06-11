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
import { GoogleAuthService } from './google-auth.service';
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
    private readonly google: GoogleAuthService,
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

  // ─── Resolução de empresa por código OU e-mail ──────────────
  /**
   * O código da empresa deixou de ser pedido no login: a empresa é encontrada
   * pelo E-MAIL do utilizador (responsável ou qualquer utilizador ativo).
   * Devolve TODOS os candidatos — quem chama decide o que fazer se houver
   * mais do que um (o mesmo e-mail pode existir em várias empresas).
   */
  private async companiesForEmail(email: string) {
    const v = email.trim().toLowerCase();
    const seen = new Set<string>();
    const out: Awaited<ReturnType<typeof this.prisma.company.findMany>> = [];
    const byResponsible = await this.prisma.company.findMany({
      where: { responsibleEmail: { equals: v, mode: 'insensitive' }, status: { notIn: ['SUSPENDED', 'CANCELLED'] } },
      take: 10,
    });
    for (const c of byResponsible) { seen.add(c.id); out.push(c); }
    // procura também nos utilizadores de cada empresa (operadores/equipa)
    const all = await this.prisma.company.findMany({
      where: { status: { notIn: ['SUSPENDED', 'CANCELLED'] } },
      take: 100,
    });
    for (const c of all) {
      if (seen.has(c.id)) continue;
      try {
        // sonda leve (colunas explícitas — forma estável entre schemas)
        if (await this.tenantUsers.emailExists(c.schemaName, v)) { seen.add(c.id); out.push(c); }
      } catch { /* schema indisponível — ignora */ }
    }
    return out;
  }

  /** Empresa por código (compatibilidade) ou, sem código, pelo e-mail dado. */
  private async resolveCompany(companyCode: string | undefined, email: string) {
    if (companyCode) {
      const c = await this.prisma.company.findUnique({ where: { code: companyCode.toLowerCase() } });
      if (!c) throw new UnauthorizedException('Invalid credentials');
      return c;
    }
    const candidates = await this.companiesForEmail(email);
    if (candidates.length === 0) throw new UnauthorizedException('Invalid credentials');
    if (candidates.length > 1) {
      // o frontend mostra um seletor e repete o pedido com companyCode
      throw new BadRequestException({
        message: 'Este e-mail existe em várias empresas. Escolhe a empresa.',
        error: 'ChooseCompany',
        companies: candidates.map((c) => ({ code: c.code, name: c.name })),
      });
    }
    return candidates[0];
  }

  // ─── Login de utilizador de empresa (tenant) ────────────────
  async tenantLogin(
    dto: TenantLoginDto,
    ctx: RequestCtx,
  ): Promise<TokenPair & { companyCode: string; companyName: string }> {
    const company = await this.resolveCompany(dto.companyCode, dto.email);
    // PENDING é permitido entrar (vê o ecrã de "aguarda aprovação" + chat);
    // só SUSPENDED/CANCELLED é que bloqueiam totalmente.
    if (company.status === 'SUSPENDED' || company.status === 'CANCELLED') {
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
      name: user.name,
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

    const pair = await this.tokens.issuePair(payload, ctx);
    // o frontend já não pede o código — devolvemos o resolvido (X-Tenant-Code)
    return { ...pair, companyCode: company.code, companyName: company.name };
  }

  /**
   * Login com Google (aditivo ao login por palavra-passe). A empresa é
   * encontrada automaticamente pelo e-mail da conta Google (o companyCode é
   * opcional — só usado para desempatar quando o e-mail existe em várias).
   * Usado no painel do gestor E na caixa.
   */
  async googleLogin(
    dto: { companyCode?: string; idToken: string },
    ctx: RequestCtx,
  ): Promise<TokenPair & { companyCode: string; companyName: string }> {
    const profile = await this.google.verify(dto.idToken);
    if (!profile.email) throw new UnauthorizedException('Conta Google sem e-mail.');

    const company = await this.resolveCompany(dto.companyCode, profile.email);
    if (company.status === 'SUSPENDED' || company.status === 'CANCELLED') throw new ForbiddenException(`Empresa ${company.status.toLowerCase()}`);

    const user = await this.tenantUsers.findByEmail(company.schemaName, profile.email);
    if (!user || !user.is_active) {
      throw new UnauthorizedException('Esta conta Google não está associada a nenhum utilizador desta empresa.');
    }

    await this.tenantUsers.markLoginSuccess(company.schemaName, user.id);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      subjectType: 'TENANT',
      tenantId: company.id,
      tenantSchema: company.schemaName,
      storeId: user.store_id ?? undefined,
      twoFaVerified: !user.two_fa_enabled, // Google já é 2º fator forte
    };
    await this.audit.record({
      actorType: 'TENANT', actorId: user.id, tenantSchema: company.schemaName,
      action: 'LOGIN_SUCCESS_GOOGLE', entity: 'User', entityId: user.id, ip: ctx.ip,
    });
    const pair = await this.tokens.issuePair(payload, ctx);
    return { ...pair, companyCode: company.code, companyName: company.name };
  }

  // ─── Caixa: lista de operadores (nomes) por empresa ─────────
  /**
   * `identifier` aceita o CÓDIGO da empresa (compatibilidade) ou o E-MAIL
   * registado (responsável ou de qualquer utilizador ativo). Devolve também
   * o código/nome resolvidos — a caixa usa-os no login por PIN — ou a lista
   * de empresas quando o e-mail existe em várias (`choices`).
   */
  async listOperators(identifier: string): Promise<{
    companyCode: string | null;
    companyName: string | null;
    operators: { id: string; name: string; role: string; store_id: string | null; store_name: string | null; photo_url: string | null }[];
    choices?: { code: string; name: string }[];
  }> {
    const v = identifier.trim().toLowerCase();
    if (!v) return { companyCode: null, companyName: null, operators: [] };
    let company = await this.prisma.company.findUnique({ where: { code: v } });
    if (!company && v.includes('@')) {
      const candidates = (await this.companiesForEmail(v)).filter((c) => c.status === 'ACTIVE');
      if (candidates.length > 1) {
        return {
          companyCode: null, companyName: null, operators: [],
          choices: candidates.map((c) => ({ code: c.code, name: c.name })),
        };
      }
      company = candidates[0] ?? null;
    }
    if (!company || company.status !== 'ACTIVE') return { companyCode: null, companyName: null, operators: [] };
    const operators = await this.tenantUsers.listOperators(company.schemaName);
    return { companyCode: company.code, companyName: company.name, operators };
  }

  /** Plano expirado? True só se a empresa já teve subscrições e nenhuma é válida
   *  agora (empresas legadas sem subscrição NÃO são bloqueadas). */
  private async isPlanExpired(companyId: string): Promise<boolean> {
    const subs = await this.prisma.subscription.findMany({
      where: { companyId },
      select: { status: true, expiresAt: true },
    });
    // Só bloqueia se a empresa JÁ teve um plano ATIVADO (com validade) e este
    // expirou. Empresas sem subscrição ou só com subscrições por aprovar (sem
    // expiresAt) NÃO são bloqueadas — protege os tenants existentes.
    const wasActivated = subs.some((s) => s.expiresAt);
    if (!wasActivated) return false;
    const now = Date.now();
    return !subs.some((s) => s.status === 'ACTIVE' && (!s.expiresAt || s.expiresAt.getTime() > now));
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
    // Plano expirado → bloqueia o caixa (acesso geral). O gestor renova no painel.
    if (await this.isPlanExpired(company.id)) {
      throw new ForbiddenException('Plano expirado. O gestor deve renovar no painel de gestão.');
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
      name: user.name,
      role: user.role,
      subjectType: 'TENANT',
      tenantId: company.id,
      tenantSchema: company.schemaName,
      storeId: user.store_id ?? undefined,
      storeName: user.store_name ?? undefined,
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
      name: user.name,
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
      storeName: u.store_name ?? undefined,
      twoFaVerified: !u.two_fa_enabled,
    };
  }
}

export { Role };
