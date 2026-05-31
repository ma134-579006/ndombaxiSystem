import { Injectable, Logger } from '@nestjs/common';

/**
 * Envio de e-mails transaccionais (boas-vindas, alertas).
 *
 * NOTA: a integração real (SES/SendGrid — §12.2) entra mais tarde. Por agora
 * regista o e-mail no log para desenvolvimento local. Ponto único de troca.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async send(to: string, subject: string, body: string): Promise<void> {
    this.logger.log(`[MAIL] to=${to} subject="${subject}"\n${body}`);
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
