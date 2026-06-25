// URL base da API NEXUS. Configurável por VITE_API_URL (substituído no build).
const fromEnv = import.meta.env.VITE_API_URL as string | undefined;

export const API_URL = (fromEnv ?? 'http://localhost:3000').replace(/\/$/, '');

/** Google Sign-In Client ID (público — o mesmo do painel de gestão).
 *  Configurável no build via VITE_GOOGLE_CLIENT_ID. */
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)
  ?? '522636462932-m67fvuutei11ug355aion1sh00h1k2br.apps.googleusercontent.com';
