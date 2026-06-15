import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * Envio de e-mails transaccionais (boas-vindas, recuperação de senha/PIN, alertas).
 *
 * SMTP configurável por ambiente (Render), sem código:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE
 * Ex. Gmail: HOST=smtp.gmail.com PORT=465 SECURE=true USER=<email>
 *            PASS=<palavra-passe de app de 16 letras>.
 * Sem SMTP configurado, regista no log (desenvolvimento) e `enabled` é falso.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly from: string;

  constructor() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const port = Number(process.env.SMTP_PORT ?? 465);
    const secure = (process.env.SMTP_SECURE ?? (port === 465 ? 'true' : 'false')) === 'true';
    this.from = process.env.SMTP_FROM || (user ? `Ndombaxi System <${user}>` : 'Ndombaxi System');
    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
      this.logger.log(`E-mail SMTP configurado (${host}:${port}).`);
    } else {
      this.logger.warn('SMTP não configurado — e-mails só vão para o log (define SMTP_HOST/USER/PASS).');
    }
  }

  /** Há SMTP real configurado? (a recuperação por e-mail precisa disto). */
  get enabled(): boolean {
    return this.transporter !== null;
  }

  /** Envia texto simples (ou regista no log se não houver SMTP). */
  async send(to: string, subject: string, body: string): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[MAIL-LOG] to=${to} subject="${subject}"\n${body}`);
      return;
    }
    await this.transporter.sendMail({ from: this.from, to, subject, text: body });
  }

  /** Envia HTML. Lança se o SMTP não estiver configurado (para a UI avisar). */
  async sendHtml(to: string, subject: string, html: string): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[MAIL-LOG html] to=${to} subject="${subject}"`);
      throw new Error('Serviço de e-mail não configurado.');
    }
    await this.transporter.sendMail({ from: this.from, to, subject, html });
  }

  async sendWelcome(
    to: string,
    companyName: string,
    companyCode: string,
    tempPassword: string,
  ): Promise<void> {
    await this.send(
      to,
      `Bem-vindo ao Ndombaxi System — ${companyName}`,
      [
        `Olá,`,
        ``,
        `A sua empresa "${companyName}" foi registada na plataforma Ndombaxi System.`,
        `Código da empresa: ${companyCode}`,
        `Senha temporária: ${tempPassword}`,
        ``,
        `O acesso será activado após aprovação. Altere a senha no primeiro login.`,
      ].join('\n'),
    );
  }
}
