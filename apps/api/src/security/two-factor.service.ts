import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { MailService } from '../common/mail/mail.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * VERIFICAÇÃO EM 2 PASSOS — opcional e desligada por omissão, para:
 *  • Super Admin (PLATFORM:<id>), utilizadores das empresas (TENANT:<schema>:<id>) e
 *    associados do LPS Kwanza (KWANZA:<id>).
 *  • Quando ligada, pede um código de 6 dígitos no login, ao recuperar a senha e ao mudá-la.
 *  • Canais gratuitos primeiro: e-mail pelo SMTP do Super Admin e WhatsApp pela Meta Cloud API
 *    (Integrações → WhatsApp; o escalão gratuito cobre as conversas de autenticação iniciais).
 *    O Super Admin escolhe os canais e o modelo do WhatsApp em "Segurança (2FA)".
 *  • Os códigos guardam-se só como hash, valem `codeMinutes`, aceitam 5 tentativas e há limite de envios.
 */
export type TwoFaPurpose = 'LOGIN' | 'SETUP' | 'RESET' | 'CHANGE_PW' | 'DISABLE' | 'WITHDRAW';
export type TwoFaMethod = 'EMAIL' | 'WHATSAPP';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const PURPOSE_TEXT: Record<TwoFaPurpose, string> = {
  LOGIN: 'entrar na sua conta', SETUP: 'ativar a verificação em 2 passos', RESET: 'recuperar a sua senha',
  CHANGE_PW: 'mudar a sua senha', DISABLE: 'desligar a verificação em 2 passos', WITHDRAW: 'confirmar o seu pedido de saque',
};

export const maskEmail = (e: string) => { const [u, d] = e.split('@'); return d ? `${u.slice(0, 2)}${'•'.repeat(Math.max(2, u.length - 2))}@${d}` : e; };
export const maskPhone = (p: string) => { const d = p.replace(/\D/g, ''); return d.length > 4 ? `${'•'.repeat(d.length - 3)}${d.slice(-3)}` : d; };
/** Número para o WhatsApp: 9 dígitos de Angola → 244XXXXXXXXX; com indicativo, só os dígitos. */
export const waNumber = (p: string) => { const d = p.replace(/\D/g, ''); return d.length === 9 && d.startsWith('9') ? `244${d}` : d; };

export interface TwoFaConfigView { allowEmail: boolean; allowWhatsapp: boolean; waTemplate: string | null; waLang: string; waAuthButton: boolean; codeMinutes: number }
export interface TwoFaStatus { enabled: boolean; method: TwoFaMethod | null; to: string | null; channels: { email: boolean; whatsapp: boolean } }

@Injectable()
export class TwoFactorService {
  private readonly log = new Logger('2FA');
  constructor(private readonly prisma: PrismaService, private readonly mail: MailService, private readonly integrations: IntegrationsService) {}

  static platform(id: string) { return `PLATFORM:${id}`; }
  static tenant(schema: string, id: string) { return `TENANT:${schema}:${id}`; }
  static kwanza(id: string) { return `KWANZA:${id}`; }

  /* ─────────── configuração (Super Admin) ─────────── */
  async config(): Promise<TwoFaConfigView> {
    const c = await this.prisma.twoFactorConfig.findUnique({ where: { id: 'default' } }).catch(() => null);
    return {
      allowEmail: c?.allowEmail ?? true, allowWhatsapp: c?.allowWhatsapp ?? true, waTemplate: c?.waTemplate ?? null,
      waLang: c?.waLang ?? 'pt_PT', waAuthButton: c?.waAuthButton ?? true, codeMinutes: c?.codeMinutes ?? 10,
    };
  }
  async saveConfig(p: Partial<TwoFaConfigView>): Promise<TwoFaConfigView> {
    const cur = await this.config();
    const next = {
      allowEmail: p.allowEmail ?? cur.allowEmail, allowWhatsapp: p.allowWhatsapp ?? cur.allowWhatsapp,
      waTemplate: p.waTemplate === undefined ? cur.waTemplate : (String(p.waTemplate ?? '').trim().slice(0, 120) || null),
      waLang: (p.waLang ?? cur.waLang).trim().slice(0, 12) || 'pt_PT', waAuthButton: p.waAuthButton ?? cur.waAuthButton,
      codeMinutes: Math.min(30, Math.max(3, Math.round(p.codeMinutes ?? cur.codeMinutes))),
    };
    if (next.waTemplate && !/^[a-z0-9_]+$/.test(next.waTemplate)) throw new BadRequestException('Nome do modelo: só minúsculas, números e _.');
    await this.prisma.twoFactorConfig.upsert({ where: { id: 'default' }, create: { id: 'default', ...next }, update: { ...next, updatedAt: new Date() } });
    return next;
  }

  /** Canais que funcionam AGORA (permitidos pelo Super Admin e com o fornecedor configurado). */
  async channels(): Promise<{ email: boolean; whatsapp: boolean }> {
    const c = await this.config();
    const email = c.allowEmail && (await this.mail.isEnabled().catch(() => false));
    const wa = c.allowWhatsapp ? await this.integrations.getActive('WHATSAPP').catch(() => null) : null;
    return { email: email || this.devEcho, whatsapp: !!(wa?.secret && wa.settings?.phoneNumberId) || (c.allowWhatsapp && this.devEcho) };
  }

  /** Só em desenvolvimento/QA (nunca em produção): o código vai para o registo da API em vez de ser enviado. */
  private get devEcho() { return process.env.NODE_ENV !== 'production' && process.env.TWOFA_DEV_LOG === '1'; }

  /* ─────────── estado de cada conta ─────────── */
  async status(subject: string): Promise<TwoFaStatus> {
    const s = await this.prisma.twoFactorSetting.findUnique({ where: { subject } }).catch(() => null);
    const on = !!s?.enabled;
    const method = on ? (s!.method as TwoFaMethod) : null;
    const to = on ? (method === 'WHATSAPP' ? maskPhone(s!.phone ?? '') : maskEmail(s!.email ?? '')) : null;
    return { enabled: on, method, to, channels: await this.channels() };
  }
  async isEnabled(subject: string): Promise<boolean> {
    const s = await this.prisma.twoFactorSetting.findUnique({ where: { subject }, select: { enabled: true } }).catch(() => null);
    return !!s?.enabled;
  }

  /* ─────────── códigos ─────────── */
  private async deliver(channel: TwoFaMethod, target: string, code: string, purpose: TwoFaPurpose, minutes: number): Promise<void> {
    if (this.devEcho) { this.log.warn(`[2FA-DEV] ${purpose} ${channel} ${target} código ${code}`); return; }
    const text = `O seu código LPS é ${code}. Serve para ${PURPOSE_TEXT[purpose]} e vale ${minutes} minutos. Não o partilhe com ninguém.`;
    if (channel === 'EMAIL') {
      const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#16202c">
        <h2 style="color:#0f62fe;margin:0 0 12px">Código de verificação</h2>
        <p>Para ${PURPOSE_TEXT[purpose]}, introduza este código:</p>
        <p style="font-size:34px;font-weight:800;letter-spacing:8px;text-align:center;background:#f2f5fb;border-radius:12px;padding:16px 0;margin:18px 0">${code}</p>
        <p style="font-size:13px;color:#6b7686">Válido durante ${minutes} minutos. Se não foi você, ignore este e-mail e mude a sua senha.</p></div>`;
      await this.mail.sendHtml(target, `Código de verificação: ${code}`, html);
      return;
    }
    const cfg = await this.config();
    const wa = await this.integrations.getActive('WHATSAPP');
    if (!wa?.secret || !wa.settings?.phoneNumberId) throw new BadRequestException('O WhatsApp não está configurado.');
    const body = cfg.waTemplate
      ? {
        messaging_product: 'whatsapp', to: waNumber(target), type: 'template',
        template: {
          name: cfg.waTemplate, language: { code: cfg.waLang },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code }] },
            ...(cfg.waAuthButton ? [{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] }] : []),
          ],
        },
      }
      : { messaging_product: 'whatsapp', to: waNumber(target), type: 'text', text: { body: text } };
    const res = await fetch(`https://graph.facebook.com/v20.0/${String(wa.settings.phoneNumberId)}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${wa.secret}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      this.log.warn(`WhatsApp ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
      throw new BadRequestException('Não foi possível enviar o código por WhatsApp. Tente de novo dentro de instantes.');
    }
  }

  /** Envia um código já gerado por outro fluxo (ex.: recuperação de senha do associado). */
  async sendRaw(channel: TwoFaMethod, target: string, code: string, purpose: TwoFaPurpose) {
    const ch = await this.channels();
    if ((channel === 'EMAIL' && !ch.email) || (channel === 'WHATSAPP' && !ch.whatsapp)) throw new BadRequestException(channel === 'EMAIL' ? 'O envio por e-mail não está disponível.' : 'O envio por WhatsApp não está disponível.');
    await this.deliver(channel, target, code, purpose, 15);
  }

  /** Envia um código (limite: 1 a cada 30 s e 6 por hora, por conta e finalidade). */
  async send(subject: string, purpose: TwoFaPurpose, channel: TwoFaMethod, target: string): Promise<{ channel: TwoFaMethod; to: string }> {
    const ch = await this.channels();
    if ((channel === 'EMAIL' && !ch.email) || (channel === 'WHATSAPP' && !ch.whatsapp)) throw new BadRequestException(channel === 'EMAIL' ? 'O envio por e-mail não está disponível.' : 'O envio por WhatsApp não está disponível.');
    const recent = await this.prisma.twoFactorCode.findMany({ where: { subject, purpose, createdAt: { gt: new Date(Date.now() - 3_600_000) } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, usedAt: true } });
    // 30 s entre envios só enquanto o último código ainda está por usar (depois de usado, pode pedir outro já).
    if (recent[0] && !recent[0].usedAt && Date.now() - recent[0].createdAt.getTime() < 30_000) throw new HttpException({ message: 'Aguarde uns segundos antes de pedir outro código.', error: 'TwoFaWait' }, HttpStatus.TOO_MANY_REQUESTS);
    if (recent.length >= 6) throw new HttpException({ message: 'Pediu demasiados códigos. Tente de novo dentro de uma hora.', error: 'TwoFaWait' }, HttpStatus.TOO_MANY_REQUESTS);
    const minutes = (await this.config()).codeMinutes;
    const code = String(randomInt(100000, 1000000));
    await this.prisma.twoFactorCode.updateMany({ where: { subject, purpose, usedAt: null }, data: { usedAt: new Date() } });
    await this.prisma.twoFactorCode.create({ data: { subject, purpose, channel, target, codeHash: sha(`${subject}:${code}`), expiresAt: new Date(Date.now() + minutes * 60_000) } });
    await this.deliver(channel, target, code, purpose, minutes);
    return { channel, to: channel === 'WHATSAPP' ? maskPhone(target) : maskEmail(target) };
  }

  /** Confere o código (uma só utilização); devolve a linha do código para quem precise do destino. */
  async check(subject: string, purpose: TwoFaPurpose, code: string | undefined | null) {
    const c = String(code ?? '').replace(/\D/g, '');
    const row = await this.prisma.twoFactorCode.findFirst({ where: { subject, purpose, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    if (!row || row.attempts >= 5 || c.length !== 6) {
      if (row && c.length === 6) await this.prisma.twoFactorCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException({ message: 'Código inválido ou expirado.', error: 'TwoFaInvalid' });
    }
    if (row.codeHash !== sha(`${subject}:${c}`)) {
      await this.prisma.twoFactorCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException({ message: 'Código inválido ou expirado.', error: 'TwoFaInvalid' });
    }
    // Marca como usado só se ainda não estava (dois pedidos simultâneos com o mesmo código: só um passa).
    const n = await this.prisma.twoFactorCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!n.count) throw new UnauthorizedException({ message: 'Código inválido ou expirado.', error: 'TwoFaInvalid' });
    return row;
  }

  /**
   * Porta da verificação em 2 passos: sem 2FA ligada, passa. Com 2FA e sem código, envia um
   * código pelo canal da conta e responde 401 `TwoFaRequired` (o cliente mostra o campo e
   * repete o pedido com o código). Com código, confere-o.
   */
  async gate(subject: string, purpose: TwoFaPurpose, code?: string | null, resend = false): Promise<boolean> {
    const s = await this.prisma.twoFactorSetting.findUnique({ where: { subject } }).catch(() => null);
    if (!s?.enabled) return false;
    const method = s.method as TwoFaMethod;
    const target = method === 'WHATSAPP' ? s.phone : s.email;
    if (!target) return false;
    if (!code || resend) {
      let sent: { channel: TwoFaMethod; to: string };
      try { sent = await this.send(subject, purpose, method, target); } catch (e) {
        // Pedido repetido dentro dos 30 s: o código anterior continua válido — volta a pedir o campo.
        if (e instanceof HttpException && e.getStatus() === HttpStatus.TOO_MANY_REQUESTS && !resend) sent = { channel: method, to: method === 'WHATSAPP' ? maskPhone(target) : maskEmail(target) };
        else throw e;
      }
      throw new UnauthorizedException({ message: `Enviámos um código de verificação ${sent.channel === 'WHATSAPP' ? 'por WhatsApp' : 'por e-mail'} para ${sent.to}.`, error: 'TwoFaRequired', channel: sent.channel, to: sent.to });
    }
    await this.check(subject, purpose, code);
    return true;
  }

  /* ─────────── ativar / desligar ─────────── */
  async startSetup(subject: string, method: TwoFaMethod, target: string) {
    const t = String(target ?? '').trim();
    if (method === 'EMAIL' && !/^\S+@\S+\.\S+$/.test(t)) throw new BadRequestException('Indique um e-mail válido.');
    if (method === 'WHATSAPP' && waNumber(t).length < 11) throw new BadRequestException('Indique o número de WhatsApp (9 dígitos ou com indicativo).');
    return this.send(subject, 'SETUP', method, method === 'EMAIL' ? t.toLowerCase() : t.replace(/[^\d+]/g, ''));
  }
  async confirmSetup(subject: string, code: string, label?: string | null) {
    const row = await this.check(subject, 'SETUP', code);
    const method = row.channel as TwoFaMethod;
    const data = { enabled: true, method, email: method === 'EMAIL' ? row.target : undefined, phone: method === 'WHATSAPP' ? row.target : undefined, label: label ?? undefined, updatedAt: new Date() };
    await this.prisma.twoFactorSetting.upsert({ where: { subject }, create: { subject, ...data }, update: data });
    return this.status(subject);
  }
  async disable(subject: string, code: string) {
    await this.check(subject, 'DISABLE', code);
    await this.prisma.twoFactorSetting.updateMany({ where: { subject }, data: { enabled: false, updatedAt: new Date() } });
    return this.status(subject);
  }
  /** Pede o código para desligar (vai para o canal ativo). */
  async requestDisable(subject: string) {
    const s = await this.prisma.twoFactorSetting.findUnique({ where: { subject } });
    if (!s?.enabled) throw new BadRequestException('A verificação em 2 passos já está desligada.');
    const method = s.method as TwoFaMethod;
    return this.send(subject, 'DISABLE', method, (method === 'WHATSAPP' ? s.phone : s.email) ?? '');
  }
  /** Pede um código para uma finalidade (ex.: mudar a senha com a sessão aberta). */
  async requestCode(subject: string, purpose: TwoFaPurpose) {
    const s = await this.prisma.twoFactorSetting.findUnique({ where: { subject } });
    if (!s?.enabled) return { channel: null, to: null };
    const method = s.method as TwoFaMethod;
    return this.send(subject, purpose, method, (method === 'WHATSAPP' ? s.phone : s.email) ?? '');
  }

  /** Super Admin: desliga a 2FA de quem perdeu o acesso ao e-mail/WhatsApp (procura por e-mail, telefone ou sujeito). */
  async adminDisable(who: string) {
    const w = String(who ?? '').trim();
    if (w.length < 4) throw new BadRequestException('Indique o e-mail, o telefone ou o código do associado.');
    const tail = w.replace(/\D/g, '').slice(-9);
    const assoc = /^[A-Za-z0-9]{6}$/.test(w)
      ? await this.prisma.kwanzaAssociate.findUnique({ where: { code: w.toUpperCase() }, select: { id: true } }).catch(() => null) : null;
    const rows = await this.prisma.twoFactorSetting.findMany({ where: { enabled: true, OR: [
      { email: w.toLowerCase() }, { label: w.toLowerCase() }, ...(tail.length === 9 ? [{ phone: { endsWith: tail } }] : []),
      ...(assoc ? [{ subject: TwoFactorService.kwanza(assoc.id) }] : []),
    ] } });
    if (!rows.length) throw new BadRequestException('Nenhuma conta com a verificação em 2 passos ligada corresponde a esse dado.');
    await this.prisma.twoFactorSetting.updateMany({ where: { subject: { in: rows.map((r) => r.subject) } }, data: { enabled: false, updatedAt: new Date() } });
    return { disabled: rows.length };
  }

  /** Números para o painel do Super Admin. */
  async stats() {
    const rows = await this.prisma.twoFactorSetting.findMany({ where: { enabled: true }, select: { subject: true, method: true } });
    const by = (p: string) => rows.filter((r) => r.subject.startsWith(p)).length;
    return { total: rows.length, platform: by('PLATFORM:'), tenant: by('TENANT:'), kwanza: by('KWANZA:'), email: rows.filter((r) => r.method === 'EMAIL').length, whatsapp: rows.filter((r) => r.method === 'WHATSAPP').length };
  }

  /** Teste do Super Admin: envia um código de exemplo para o destino indicado. */
  async test(channel: TwoFaMethod, target: string) {
    const ch = await this.channels();
    if ((channel === 'EMAIL' && !ch.email) || (channel === 'WHATSAPP' && !ch.whatsapp)) throw new BadRequestException(channel === 'EMAIL' ? 'Configure primeiro o SMTP (E-mail).' : 'Configure primeiro o WhatsApp em Integrações.');
    const code = String(randomInt(100000, 1000000));
    await this.deliver(channel, channel === 'EMAIL' ? target.trim().toLowerCase() : target.replace(/[^\d+]/g, ''), code, 'LOGIN', (await this.config()).codeMinutes);
    return { ok: true as const };
  }
}
