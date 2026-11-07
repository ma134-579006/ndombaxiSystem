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
export const API_URL = (envApiUrl() ?? 'http://localhost:3000').replace(
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
