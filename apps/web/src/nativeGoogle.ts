/**
 * Google Sign-In NATIVO (Gestor) na app instalada. O Google bloqueia o seu OAuth
 * dentro de WebViews, por isso o botão web (GIS) não funciona na app — aqui
 * usamos o plugin nativo (Google Play Services) pelo bridge do Capacitor.
 * Devolve o ID token, que segue o MESMO fluxo `loginGoogle(idToken)` de sempre
 * (a API verifica-o contra o cliente Web = serverClientId configurado). No site
 * (navegador) isto não existe e usa-se o botão web normal.
 */
interface GAResult {
  authentication?: { idToken?: string | null };
  idToken?: string | null;
}
interface GAPlugin {
  signIn(): Promise<GAResult>;
  initialize?(o?: Record<string, unknown>): Promise<void> | void;
}

function plugin(): GAPlugin | null {
  const w = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { GoogleAuth?: GAPlugin } };
  };
  // Basta o plugin estar acessível. Não exigimos isNativePlatform() (pode ser
  // instável no frontend dentro da app); na WEB o Capacitor não existe, por isso
  // isto devolve null e usa-se o botão web — seguro.
  return w.Capacitor?.Plugins?.GoogleAuth ?? null;
}

/** True quando o Google nativo está disponível (app instalada com o plugin). */
export function nativeGoogleAvailable(): boolean {
  return !!plugin();
}

/** Abre o Google nativo e devolve o ID token (ou null se cancelar/falhar). */
export async function nativeGoogleSignIn(): Promise<string | null> {
  const g = plugin();
  if (!g) return null;
  const res = await g.signIn();
  return res?.authentication?.idToken ?? res?.idToken ?? null;
}
