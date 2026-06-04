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
