// URL base da API e código da loja. O código pode vir de:
//   • query string ?loja=codigo (subdomínio/links partilháveis)
//   • variável VITE_STORE_CODE (build dedicado por loja)
// Se faltar, a app pede o código ao utilizador.
const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

export const INITIAL_STORE_CODE =
  params.get('loja')?.trim().toLowerCase() ??
  (import.meta.env.VITE_STORE_CODE as string | undefined)?.trim().toLowerCase() ??
  '';
