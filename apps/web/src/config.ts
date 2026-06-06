export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

/** Base da loja online (apps/store). O link partilhável de cada empresa é
 *  `${STORE_URL}/${companyCode}`. Configurável no build via VITE_STORE_URL. */
export const STORE_URL = ((import.meta.env.VITE_STORE_URL as string | undefined) ?? 'https://ndombaxi-loja.pages.dev').replace(
  /\/$/,
  '',
);

/** Terminal de venda (Caixa / POS, apps/pos). Configurável no build via
 *  VITE_CAIXA_URL. Abre-se com `${CAIXA_URL}/?empresa=<codigo>`. */
export const CAIXA_URL = ((import.meta.env.VITE_CAIXA_URL as string | undefined) ?? 'https://ndombaxi-caixa.pages.dev').replace(
  /\/$/,
  '',
);

/** Google Sign-In Client ID (público). Configurável via VITE_GOOGLE_CLIENT_ID. */
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)
  ?? '585772503915-1jp1is4d5pfndnc28vu69bp83k7o515b.apps.googleusercontent.com';
