import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Env } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptSecret, encryptSecret, maskSecret } from '../crypto/secret-box';

/**
 * Envio de e-mails transaccionais (boas-vindas, recuperação de senha/PIN, alertas).
 *
 * Configuração SMTP, por ordem de prioridade:
 *   1) BD (mail_config) — gerida pelo SUPER ADMIN no painel, sem código nem env;
 *   2) Env do Render (SMTP_HOST/PORT/USER/PASS/FROM/SECURE) — fallback.
 * Sem nenhuma das duas, os e-mails só vão para o log e `isEnabled()` é falso.
 */
export interface MailConfigView {
  host: string | null;
  port: number;
  secure: boolean;
  username: string | null;
  fromAddr: string | null;
  enabled: boolean;
  hasPassword: boolean;
  passwordMask: string | null;
  source: 'db' | 'env' | 'none';
}

interface Resolved { transporter: nodemailer.Transporter; from: string }

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private cache: { key: string; resolved: Resolved } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get key(): string {
    return this.config.get('CONFIG_ENCRYPTION_KEY', { infer: true });
  }

  /** Lê os parâmetros SMTP efectivos (BD tem prioridade; senão env). */
  private async params(): Promise<
    { host: string; port: number; secure: boolean; user: string; pass: string; from: string; source: 'db' | 'env'; cacheKey: string } | null
  > {
    const row = await this.prisma.mailConfig.findFirst().catch(() => null);
    if (row && row.enabled && row.host && row.username && row.passwordEnc) {
      let pass = '';
      try { pass = decryptSecret(row.passwordEnc, this.key); } catch { pass = ''; }
      if (pass) {
        return {
          host: row.host, port: row.port, secure: row.secure, user: row.username, pass,
          from: row.fromAddr || `Ndombaxi System <${row.username}>`,
          source: 'db', cacheKey: `db:${row.updatedAt.getTime()}`,
        };
      }
    }
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (host && user && pass) {
      const port = Number(process.env.SMTP_PORT ?? 465);
      const secure = (process.env.SMTP_SECURE ?? (port === 465 ? 'true' : 'false')) === 'true';
      return {
        host, port, secure, user, pass,
        from: process.env.SMTP_FROM || `Ndombaxi System <${user}>`,
        source: 'env', cacheKey: `env:${host}:${port}:${user}`,
      };
    }
    return null;
  }

  private async resolve(): Promise<Resolved | null> {
    const p = await this.params();
    if (!p) { this.cache = null; return null; }
    if (this.cache?.key === p.cacheKey) return this.cache.resolved;
    const transporter = nodemailer.createTransport({ host: p.host, port: p.port, secure: p.secure, auth: { user: p.user, pass: p.pass } });
    this.cache = { key: p.cacheKey, resolved: { transporter, from: p.from } };
    this.logger.log(`E-mail SMTP pronto (${p.host}:${p.port}, fonte: ${p.source}).`);
    return this.cache.resolved;
  }

  /** Há SMTP real configurado? (a recuperação por e-mail precisa disto). */
  async isEnabled(): Promise<boolean> {
    return (await this.params()) !== null;
  }

  /** Envia texto simples (ou regista no log se não houver SMTP). */
  async send(to: string, subject: string, body: string): Promise<void> {
    const r = await this.resolve();
    if (!r) { this.logger.log(`[MAIL-LOG] to=${to} subject="${subject}"\n${body}`); return; }
    await r.transporter.sendMail({ from: r.from, to, subject, text: body });
  }

  /** Envia HTML. Lança se o SMTP não estiver configurado (para a UI avisar). */
  async sendHtml(to: string, subject: string, html: string): Promise<void> {
    const r = await this.resolve();
    if (!r) { this.logger.log(`[MAIL-LOG html] to=${to} subject="${subject}"`); throw new Error('Serviço de e-mail não configurado.'); }
    await r.transporter.sendMail({ from: r.from, to, subject, html });
  }

  async sendWelcome(to: string, companyName: string, companyCode: string, tempPassword: string): Promise<void> {
    await this.send(
      to,
      `Bem-vindo ao Ndombaxi System — ${companyName}`,
      [
        `Olá,`, ``,
        `A sua empresa "${companyName}" foi registada na plataforma Ndombaxi System.`,
        `Código da empresa: ${companyCode}`,
        `Senha temporária: ${tempPassword}`, ``,
        `O acesso será activado após aprovação. Altere a senha no primeiro login.`,
      ].join('\n'),
    );
  }

  // ── Gestão (Super Admin) ───────────────────────────────────
  /** Vista segura da configuração (sem a password em claro). */
  async getConfig(): Promise<MailConfigView> {
    const row = await this.prisma.mailConfig.findFirst().catch(() => null);
    if (row) {
      let mask: string | null = null;
      if (row.passwordEnc) { try { mask = maskSecret(decryptSecret(row.passwordEnc, this.key)); } catch { mask = '••••••••'; } }
      return {
        host: row.host, port: row.port, secure: row.secure, username: row.username,
        fromAddr: row.fromAddr, enabled: row.enabled, hasPassword: !!row.passwordEnc,
        passwordMask: mask, source: (row.enabled && row.host && row.username && row.passwordEnc) ? 'db' : (process.env.SMTP_HOST ? 'env' : 'none'),
      };
    }
    return {
      host: process.env.SMTP_HOST ?? null, port: Number(process.env.SMTP_PORT ?? 465),
      secure: (process.env.SMTP_SECURE ?? 'true') === 'true', username: process.env.SMTP_USER ?? null,
      fromAddr: process.env.SMTP_FROM ?? null, enabled: !!process.env.SMTP_HOST,
      hasPassword: !!process.env.SMTP_PASS, passwordMask: process.env.SMTP_PASS ? '••••••••' : null,
      source: process.env.SMTP_HOST ? 'env' : 'none',
    };
  }

  /** Guarda a configuração SMTP (password encriptada; só roda se vier nova). */
  async saveConfig(dto: {
    host?: string; port?: number; secure?: boolean; username?: string;
    password?: string; fromAddr?: string; enabled?: boolean;
  }): Promise<MailConfigView> {
    const existing = await this.prisma.mailConfig.findFirst().catch(() => null);
    const passwordEnc = dto.password === undefined
      ? undefined
      : dto.password ? encryptSecret(dto.password, this.key) : null;
    const data = {
      host: dto.host?.trim() || null,
      port: dto.port ?? 465,
      secure: dto.secure ?? true,
      username: dto.username?.trim() || null,
      fromAddr: dto.fromAddr?.trim() || null,
      enabled: dto.enabled ?? true,
      ...(passwordEnc !== undefined ? { passwordEnc } : {}),
    };
    if (existing) await this.prisma.mailConfig.update({ where: { id: existing.id }, data });
    else await this.prisma.mailConfig.create({ data: { id: 'singleton', ...data, passwordEnc: passwordEnc ?? null } });
    this.cache = null; // força reconstrução do transporter
    return this.getConfig();
  }

  /** Envia um e-mail de teste para confirmar a configuração. */
  async sendTest(to: string): Promise<{ ok: boolean; message: string }> {
    try {
      await this.sendHtml(
        to,
        'Teste de e-mail — Ndombaxi System',
        '<p>✅ O teu SMTP está a funcionar. Este é um e-mail de teste do <strong>Ndombaxi System</strong>.</p>',
      );
      return { ok: true, message: `E-mail de teste enviado para ${to}.` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Falha ao enviar.' };
    }
  }
}
