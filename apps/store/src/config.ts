// URL base da API e código da loja. O código pode vir de (por ordem):
//   • caminho directo  /minha-loja   (LINK PARTILHÁVEL gerado no painel admin)
//   • query string     ?loja=codigo  (retro-compatível)
//   • variável         VITE_STORE_CODE (build dedicado por loja)
// Se faltar, a app pede o código ao utilizador.
const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

const PROD_API_URL = 'https://ndombaxi-api-bwwr.onrender.com';
/**
 * Endereços de API ANTIGOS (serviços do Render já apagados). O Cloudflare Pages
 * ainda pode injetar um destes em VITE_API_URL — por exemplo nos builds de
 * PREVIEW, cuja variável ficou com o serviço antigo quando a API mudou de
 * serviço no Render. Sem acesso ao painel do Cloudflare, é o código que se
 * adapta: um endereço retirado é trocado pela API atual.
 */
const RETIRED_API_HOSTS = ['ndombaxi-api-3nmz.onrender.com'];
function envApiUrl(): string | undefined {
  const v = import.meta.env.VITE_API_URL as string | undefined;
  if (!v) return undefined;
  return RETIRED_API_HOSTS.some((h) => v.includes(h)) ? PROD_API_URL : v;
}
// `import.meta.env.DEV` é CONSTANTE no build: o minificador elimina o ramo de
// desenvolvimento e o literal `localhost:3000` não chega ao bundle (a barreira
// dos builds das apps — prepare-web — procura-o e recusava o build).
export const API_URL = (envApiUrl() ?? (import.meta.env.DEV ? 'http://localhost:3000' : PROD_API_URL)).replace(
  /\/$/,
  '',
);

/**
 * Lê o código da loja do 1.º segmento do caminho (ex.: /minha-loja → "minha-loja").
 * Só aceita segmentos que pareçam um código válido (a–z, 0–9, hífen) — assim
 * ignora recursos (com extensão) e caminhos que não sejam de loja.
 */
function codeFromPath(): string {
  if (typeof location === 'undefined') return '';
  const seg = decodeURIComponent(location.pathname.split('/').filter(Boolean)[0] ?? '');
  if (!/^[a-z0-9-]{2,40}$/i.test(seg)) return '';
  return seg.trim().toLowerCase();
}

export const INITIAL_STORE_CODE =
  (params.get('loja')?.trim().toLowerCase() || '') ||
  codeFromPath() ||
  ((import.meta.env.VITE_STORE_CODE as string | undefined)?.trim().toLowerCase() || '') ||
  '';

/** Google OAuth Client ID (login do cliente). É PÚBLICO (vai no frontend), por
 *  isso o valor por omissão está aqui; pode ser sobreposto por VITE_GOOGLE_CLIENT_ID.
 *  Tem de terminar em `.apps.googleusercontent.com` para o botão aparecer. */
export const GOOGLE_CLIENT_ID = ((import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)
  ?? '522636462932-m67fvuutei11ug355aion1sh00h1k2br.apps.googleusercontent.com').trim();

/** Endereço público da loja (ligações partilhadas). Nas apps a página corre em file:// ou https://localhost. */
export const PUBLIC_ORIGIN: string = ((import.meta.env.VITE_PUBLIC_ORIGIN as string | undefined)?.replace(/\/$/, ''))
  || (typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname) ? location.origin : 'https://loja.ndombaxisystem.com');

/** App LPS Kwanza: a app Android (build próprio) ou a janela Windows (?app=kwanza&appOs=windows&appVersion=x.y.z). */
const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const KWANZA_APP: { os: 'android' | 'windows'; version: string } | null =
  import.meta.env.VITE_KWANZA_APP === '1'
    ? { os: 'android', version: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '' }
    : Q.get('app') === 'kwanza' && /^(windows|android)$/.test(Q.get('appOs') ?? '') && /^\d+\.\d+\.\d+$/.test(Q.get('appVersion') ?? '')
      ? { os: Q.get('appOs') as 'android' | 'windows', version: Q.get('appVersion') as string }
      : null;
