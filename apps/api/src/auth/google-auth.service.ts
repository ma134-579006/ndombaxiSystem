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
}
