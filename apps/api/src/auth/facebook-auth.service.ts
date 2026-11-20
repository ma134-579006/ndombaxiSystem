import { Injectable, UnauthorizedException } from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service';

export interface FacebookProfile {
  email: string;
  name: string | null;
  sub: string; // id Facebook (por app)
}

/** Base da Graph API (substituível em QA por um servidor local que a simula). */
export const facebookGraphUrl = (): string => process.env.FACEBOOK_GRAPH_URL || 'https://graph.facebook.com/v19.0';

/**
 * "Entrar com Facebook": o browser obtém um access token com o SDK do Facebook
 * (App ID público, configurado em Super Admin → Integrações → Facebook Login);
 * aqui confirmamos com a Graph API que o token é válido e é da NOSSA app
 * (debug_token com o app token = App ID|App Secret) e lemos o e-mail.
 */
@Injectable()
export class FacebookAuthService {
  constructor(private readonly integrations: IntegrationsService) {}

  /** App ID público (null = integração desligada). */
  async publicAppId(): Promise<string | null> {
    const cfg = await this.integrations.getActive('FACEBOOK_LOGIN').catch(() => null);
    const id = String(cfg?.settings?.appId ?? '').trim();
    return cfg && id && cfg.secret ? id : null;
  }

  async verify(accessToken: string): Promise<FacebookProfile> {
    if (!accessToken) throw new UnauthorizedException('Token do Facebook em falta.');
    const cfg = await this.integrations.getActive('FACEBOOK_LOGIN');
    const appId = String(cfg?.settings?.appId ?? '').trim();
    if (!cfg || !appId || !cfg.secret) throw new UnauthorizedException('Entrar com Facebook não está configurado.');
    const g = facebookGraphUrl();
    type Debug = { data?: { is_valid?: boolean; app_id?: string; user_id?: string } };
    const debug = await fetch(`${g}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${appId}|${cfg.secret}`)}`, { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? (r.json() as Promise<Debug>) : null)).catch(() => null);
    if (!debug?.data?.is_valid) throw new UnauthorizedException('Não foi possível validar a conta Facebook.');
    if (String(debug.data.app_id) !== appId) throw new UnauthorizedException('Conta Facebook não autorizada para esta aplicação.');
    type Me = { id?: string; name?: string; email?: string };
    const me = await fetch(`${g}/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`, { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : null)).catch(() => null);
    if (!me?.id) throw new UnauthorizedException('Não foi possível ler a conta Facebook.');
    if (!me.email) throw new UnauthorizedException('A conta Facebook não partilhou o e-mail. Autorize o e-mail ou use outro método.');
    return { email: me.email.toLowerCase(), name: me.name ?? null, sub: me.id };
  }
}
