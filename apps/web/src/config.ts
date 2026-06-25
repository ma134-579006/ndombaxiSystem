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
