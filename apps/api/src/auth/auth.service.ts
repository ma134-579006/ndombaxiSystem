import {
  ForbiddenException,
  Injectable,
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
