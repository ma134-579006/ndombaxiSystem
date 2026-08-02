export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

/** Base da loja online (apps/store). O link partilhável de cada empresa é
 *  `${STORE_URL}/${companyCode}`. Configurável no build via VITE_STORE_URL. */
export const STORE_URL = ((import.meta.env.VITE_STORE_URL as string | undefined) ?? 'https://loja.ndombaxisystem.com').replace(
  /\/$/,
  '',
);

/** Terminal de venda (Caixa / POS, apps/pos). Configurável no build via
 *  VITE_CAIXA_URL. Abre-se com `${CAIXA_URL}/?empresa=<codigo>`. */
export const CAIXA_URL = ((import.meta.env.VITE_CAIXA_URL as string | undefined) ?? 'https://caixa.ndombaxisystem.com').replace(
  /\/$/,
  '',
);

/** Google Sign-In Client ID (público). Configurável via VITE_GOOGLE_CLIENT_ID. */
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)
  ?? '522636462932-m67fvuutei11ug355aion1sh00h1k2br.apps.googleusercontent.com';

/** App instalada (Android/iOS via Capacitor OU desktop via Electron)? No site
 *  (navegador) devolve sempre false. Fonte única para não repetir a heurística. */
export function isNativeApp(): boolean {
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

/** True quando corre no DESKTOP (Electron), não no móvel (Capacitor). */
function isDesktopApp(): boolean {
  const w = window as unknown as { ndombaxi?: unknown };
  return window.location.protocol === 'ndombaxi:' || typeof w.ndombaxi !== 'undefined';
}

/**
 * Abre o terminal de venda (Caixa). No SITE abre `${CAIXA_URL}` num separador do
 * navegador (como sempre). Na APP a Caixa é OUTRO módulo desta mesma app — troca
 * de módulo em vez de mandar para o website, levando os mesmos parâmetros
 * (empresa/funcionário) para que só peça o PIN do operador.
 *  - Desktop (Electron): `ndombaxi://caixa/index.html?...`
 *  - Móvel (Capacitor):  `../caixa/index.html?...` (mesma origem, pasta ao lado)
 */
export function openCaixaTerminal(params: Record<string, string | undefined> = {}): void {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const query = qs.toString();
  if (isNativeApp()) {
    const base = isDesktopApp() ? 'ndombaxi://caixa/index.html' : '../caixa/index.html';
    window.location.assign(query ? `${base}?${query}` : base);
    return;
  }
  window.open(`${CAIXA_URL}/${query ? `?${query}` : ''}`, '_blank', 'noopener');
}
