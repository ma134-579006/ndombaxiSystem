// URL base da API NEXUS. Configurável por VITE_API_URL (substituído no build).
/** API de produção — último recurso quando o build não injeta a URL. */
const PROD_API_URL = 'https://ndombaxi-api-img.onrender.com';

/** App instalada (Electron `ndombaxi://` ou Capacitor)? No navegador → false. */
function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false; // fora do navegador (teste/SSR)
  const w = window as unknown as {
    ndombaxi?: unknown; __NDOMBAXI_NATIVE__?: boolean;
    Capacitor?: { isNativePlatform?: () => boolean; isNative?: boolean };
  };
  return window.location.protocol === 'ndombaxi:'
    || typeof w.ndombaxi !== 'undefined'
    || w.__NDOMBAXI_NATIVE__ === true
    || (!!w.Capacitor && (typeof w.Capacitor.isNativePlatform === 'function'
      ? w.Capacitor.isNativePlatform()
      : !!w.Capacitor.isNative));
}

// CAUSA-RAIZ de "Sem ligação ao servidor": um bundle compilado sem VITE_API_URL
// caía em `localhost:3000` — inalcançável no cliente. Uma app instalada nunca
// deve falar com localhost nesta fase (não há servidor local ainda): cai na
// produção. Defensivo — imuniza a app a um erro de build. No site mantém-se
// localhost (desenvolvimento). Igual ao web/src/config.ts.
// `||` (não `??`): env indefinido OU vazio → cai no ramo nativo/localhost. Sem
// chamadas de método na esquerda, para o minificador dobrar a constante do build.
/** SERVIDOR LOCAL primeiro, se existir (ver web/src/config.ts — mesma regra). */
function hostApiUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { ndombaxi?: { apiUrl?: string | null } };
  return w.ndombaxi?.apiUrl ?? null;
}

export const API_URL = (hostApiUrl()
  || (import.meta.env.VITE_API_URL as string | undefined)
  || (isNativeApp() ? PROD_API_URL : 'http://localhost:3000')).replace(/\/$/, '');

/** Google Sign-In Client ID (público — o mesmo do painel de gestão).
 *  Configurável no build via VITE_GOOGLE_CLIENT_ID. */
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)
  ?? '522636462932-m67fvuutei11ug355aion1sh00h1k2br.apps.googleusercontent.com';
