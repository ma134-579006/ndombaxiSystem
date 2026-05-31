import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { SubjectType } from '@prisma/client';
import type { JwtPayload } from '@nexus/types';
import { PrismaService } from '../prisma/prisma.service';
import type { Env } from '../config/env.validation';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface IssueContext {
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private parseTtlMs(ttl: string): number {
    const m = /^(\d+)([smhd])$/.exec(ttl);
    if (!m) return 7 * 24 * 60 * 60 * 1000;
    const n = Number(m[1]);
    const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2]]!;
    return n * unit;
  }

  async issuePair(
    payload: JwtPayload,
    ctx: IssueContext = {},
  ): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    });

    const rawRefresh = randomBytes(48).toString('hex');
    const refreshTtl = this.config.get('JWT_REFRESH_TTL', { infer: true });
    const expiresAt = new Date(Date.now() + this.parseTtlMs(refreshTtl));

    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hashToken(rawRefresh),
        subjectType:
          payload.subjectType === 'PLATFORM'
            ? SubjectType.PLATFORM
            : SubjectType.TENANT,
        subjectId: payload.sub,
        tenantSchema: payload.tenantSchema ?? null,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        expiresAt,
      },
    });

    return { accessToken, refreshToken: rawRefresh };
  }

  /** Rotação de refresh token (§9.1): valida, revoga o antigo, emite novo par. */
  async rotate(
    rawRefresh: string,
    payload: JwtPayload,
    ctx: IssueContext = {},
  ): Promise<TokenPair> {
    const tokenHash = this.hashToken(rawRefresh);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (
      !existing ||
      existing.revokedAt ||
      existing.expiresAt < new Date() ||
      existing.subjectId !== payload.sub
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const pair = await this.issuePair(payload, ctx);
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    return pair;
  }

  async revoke(rawRefresh: string): Promise<void> {
    const tokenHash = this.hashToken(rawRefresh);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revoga todas as sessões de um sujeito (§9.1 — admin revoga instantaneamente). */
  async revokeAllForSubject(subjectId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { subjectId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
