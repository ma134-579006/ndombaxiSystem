import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';

export interface GoogleProfile {
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  sub: string; // id Google
}

/**
 * Verifica um ID token do Google (fluxo Google Identity Services) contra o
 * endpoint oficial tokeninfo, validando a audiência (o nosso Client ID). Não
 * precisa de Client Secret — é o fluxo recomendado para "Sign in with Google".
 */
@Injectable()
export class GoogleAuthService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async verify(idToken: string): Promise<GoogleProfile> {
    if (!idToken) throw new UnauthorizedException('Token Google em falta.');
    // O botão próprio (igual ao do Vendus) usa o fluxo de token do Google e
    // envia um ACCESS token (ex.: "ya29…"), não um ID token (JWT "eyJ…").
    if (!/^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(idToken)) return this.verifyAccessToken(idToken);
    const clientId = this.config.get('GOOGLE_CLIENT_ID', { infer: true });
    let data: Record<string, string> | null = null;
    try {
      const res = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      );
      if (res.ok) data = (await res.json()) as Record<string, string>;
    } catch {
      data = null;
    }
    if (!data || !data.sub) {
      throw new UnauthorizedException('Não foi possível validar a conta Google.');
    }
    // A audiência tem de ser o nosso Client ID (impede tokens de outras apps).
    if (clientId && data.aud !== clientId) {
      throw new UnauthorizedException('Conta Google não autorizada para esta aplicação.');
    }
    if (data.email_verified !== 'true' && data.email_verified !== undefined && String(data.email_verified) !== 'true') {
      // tokeninfo devolve email_verified como string "true"/"false"
      if (String(data.email_verified) !== 'true') {
        throw new UnauthorizedException('O e-mail da conta Google não está verificado.');
      }
    }
    return {
      email: (data.email ?? '').toLowerCase(),
      emailVerified: String(data.email_verified) === 'true',
      name: data.name ?? null,
      picture: data.picture ?? null,
      sub: data.sub,
    };
  }

  /** Access token do Google: tokeninfo confirma a audiência (o nosso Client ID)
   *  e o e-mail verificado; o nome vem do userinfo. */
  private async verifyAccessToken(accessToken: string): Promise<GoogleProfile> {
    const clientId = this.config.get('GOOGLE_CLIENT_ID', { infer: true });
    const base = process.env.GOOGLE_OAUTH_URL || 'https://oauth2.googleapis.com';
    let info: Record<string, string> | null = null;
    try {
      const res = await fetch(`${base}/tokeninfo?access_token=${encodeURIComponent(accessToken)}`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) info = (await res.json()) as Record<string, string>;
    } catch { info = null; }
    if (!info || !info.sub) throw new UnauthorizedException('Não foi possível validar a conta Google.');
    if (clientId && info.aud !== clientId && info.azp !== clientId) {
      throw new UnauthorizedException('Conta Google não autorizada para esta aplicação.');
    }
    if (!info.email) throw new UnauthorizedException('Conta Google sem e-mail.');
    if (String(info.email_verified) !== 'true') throw new UnauthorizedException('O e-mail da conta Google não está verificado.');
    let name: string | null = null; let picture: string | null = null;
    try {
      const u = await fetch(process.env.GOOGLE_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8000),
      });
      if (u.ok) { const j = (await u.json()) as { name?: string; picture?: string }; name = j.name ?? null; picture = j.picture ?? null; }
    } catch { /* o nome é opcional */ }
    return { email: info.email.toLowerCase(), emailVerified: true, name, picture, sub: info.sub };
  }
}
