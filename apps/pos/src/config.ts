// URL base da API NEXUS. Configurável por VITE_API_URL (substituído no build).
const fromEnv = import.meta.env.VITE_API_URL as string | undefined;

export const API_URL = (fromEnv ?? 'http://localhost:3000').replace(/\/$/, '');

/** Google Sign-In Client ID (público — o mesmo do painel de gestão).
 *  Configurável no build via VITE_GOOGLE_CLIENT_ID. */
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)
  ?? '585772503915-1jp1is4d5pfndnc28vu69bp83k7o515b.apps.googleusercontent.com';
