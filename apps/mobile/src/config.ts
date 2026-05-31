import Constants from 'expo-constants';

// `process.env.EXPO_PUBLIC_*` é substituído estaticamente pelo bundler do Expo.
// Declaração local para tipagem (evita depender de @types/node).
declare const process: { env: Record<string, string | undefined> };

/**
 * URL base da API NEXUS. Configurável por:
 *   • variável de ambiente EXPO_PUBLIC_API_URL (recomendado em CI/produção)
 *   • campo `extra.apiUrl` do app.json (default de desenvolvimento)
 */
const fromEnv = process.env.EXPO_PUBLIC_API_URL;
const fromExtra = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;

export const API_URL = (fromEnv ?? fromExtra ?? 'http://localhost:3000').replace(/\/$/, '');

/** Namespace WebSocket do tempo real (ver RealtimeGateway no backend). */
export const REALTIME_NAMESPACE = '/realtime';
