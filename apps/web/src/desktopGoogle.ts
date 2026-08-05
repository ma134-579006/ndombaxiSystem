/**
 * Entrar com Google na app WINDOWS.
 *
 * O irmão do `nativeGoogle.ts` (Android). A diferença é onde o Google abre: no
 * Android é o plugin dos Google Play Services; no Windows é o **navegador do
 * sistema**, porque o Google recusa o seu ecrã de início de sessão dentro de
 * WebViews — e a janela do Electron é uma.
 *
 * Todo o trabalho está do lado do processo principal (`google-auth.ts`), onde há
 * um servidor local de vida curta a receber a resposta. Daqui só se chama e se
 * recebe o `id_token`, que segue depois o mesmo `loginGoogle(idToken)` de sempre.
 */
interface DesktopGoogle {
  google?: { signIn?(): Promise<{ idToken: string | null; error?: string }> };
}

function host(): DesktopGoogle | null {
  const w = window as unknown as { ndombaxi?: DesktopGoogle };
  return w.ndombaxi ?? null;
}

/** Esta é a app Windows com a entrada por Google disponível? */
export function desktopGoogleAvailable(): boolean {
  return typeof host()?.google?.signIn === 'function';
}

/**
 * Abre o Google no navegador do sistema e devolve o `id_token`.
 * `null` = o utilizador desistiu (não é erro). Um problema real é lançado com a
 * mensagem que o processo principal preparou — inclui o que fazer quando falta
 * autorizar o endereço no Google Cloud.
 */
export async function desktopGoogleSignIn(): Promise<string | null> {
  const g = host()?.google?.signIn;
  if (!g) return null;
  const r = await g();
  if (r.error) throw new Error(r.error);
  return r.idToken;
}
