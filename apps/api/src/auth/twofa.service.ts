import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import type { Env } from '../config/env.validation';

/**
 * 2FA TOTP (§9.1) — compatível com Google Authenticator / Authy.
 */
@Injectable()
export class TwoFaService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  /** otpauth:// URI para gerar o QR Code de enrolamento. */
  buildOtpAuthUrl(accountEmail: string, secret: string): string {
    const issuer = this.config.get('TWOFA_ISSUER', { infer: true });
    return authenticator.keyuri(accountEmail, issuer, secret);
  }

  async buildQrCodeDataUrl(otpAuthUrl: string): Promise<string> {
    return QRCode.toDataURL(otpAuthUrl);
  }

  verify(token: string, secret: string): boolean {
    return authenticator.verify({ token, secret });
  }
}
