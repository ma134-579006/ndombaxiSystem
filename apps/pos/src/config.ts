// URL base da API NEXUS. Configurável por VITE_API_URL (substituído no build).
const fromEnv = import.meta.env.VITE_API_URL as string | undefined;

export const API_URL = (fromEnv ?? 'http://localhost:3000').replace(/\/$/, '');
