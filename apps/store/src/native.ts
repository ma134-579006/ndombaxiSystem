/**
 * Integração com a app Android "LPS Loja" (Capacitor). No site, tudo isto é
 * inerte: `isNativeApp` é falso e nenhum listener é registado.
 *
 *  - Ligações diretas: https://loja.ndombaxisystem.com/<loja>, lpsloja://<loja>
 *    ou ?loja=<loja> abrem essa loja na app (também no arranque a frio).
 *  - Botão VOLTAR do Android: fecha o que estiver aberto (carrinho, conta,
 *    produto…) em vez de sair da app; na página inicial, minimiza-a.
 *
 * Usa o plugin App pelo objeto global do Capacitor (injetado pela app nativa),
 * por isso a montra não precisa de depender de @capacitor/*.
 */
import { useEffect, useRef } from 'react';

interface CapAppPlugin {
  addListener(event: string, cb: (e: { url?: string; canGoBack?: boolean }) => void): unknown;
  getLaunchUrl?(): Promise<{ url?: string } | undefined>;
  exitApp(): void;
  minimizeApp?(): Promise<void>;
}
interface CapGlobal { isNativePlatform?(): boolean; Plugins?: { App?: CapAppPlugin } }

const cap = (): CapGlobal | undefined => (window as unknown as { Capacitor?: CapGlobal }).Capacitor;
export const isNativeApp: boolean = typeof window !== 'undefined' && !!cap()?.isNativePlatform?.();

/** Evento para abrir uma loja (o StoreProvider ouve-o). */
export const OPEN_STORE_EVENT = 'lps:open-store';

let pendingCode = '';
/** Loja pedida por um link antes de a montra estar pronta (lida uma vez). */
export function takePendingStoreCode(): string {
  const c = pendingCode;
  pendingCode = '';
  return c;
}

/**
 * Extrai o código da loja de um link partilhado, de um QR ou de texto escrito:
 * "https://loja.ndombaxisystem.com/kero", "lpsloja://kero", "…?loja=kero", "kero".
 */
export function storeCodeFrom(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  const valid = (s: string) => (/^[a-z0-9-]{2,40}$/i.test(s) ? s.toLowerCase() : '');
  if (valid(text)) return text.toLowerCase();
  try {
    const url = new URL(text);
    const q = url.searchParams.get('loja') || url.searchParams.get('code');
    if (q && valid(q)) return q.toLowerCase();
    // lpsloja://kero → host "kero"; https://dominio/kero → 1.º segmento do caminho
    if (url.protocol === 'lpsloja:') return valid(url.hostname || url.pathname.replace(/^\/+/, '').split('/')[0] || '');
    return valid(decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] ?? ''));
  } catch {
    return '';
  }
}

// Pilha de "o que fecha com o VOLTAR" — o último registado é o primeiro a tentar.
const backHandlers: Array<{ fn: () => boolean }> = [];

/** Regista um tratador do botão voltar; devolve true quando consumiu o toque. */
export function useNativeBack(fn: () => boolean): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!isNativeApp) return;
    const entry = { fn: () => ref.current() };
    backHandlers.push(entry);
    return () => {
      const i = backHandlers.indexOf(entry);
      if (i >= 0) backHandlers.splice(i, 1);
    };
  }, []);
}

export function initNativeApp(): void {
  if (!isNativeApp) return;
  document.documentElement.classList.add('native-app');
  const app = cap()?.Plugins?.App;
  if (!app) return;
  const open = (url?: string) => {
    const code = url ? storeCodeFrom(url) : '';
    if (!code) return;
    pendingCode = code; // arranque a frio: a loja pode ainda não estar montada
    window.dispatchEvent(new CustomEvent(OPEN_STORE_EVENT, { detail: code }));
  };
  void app.getLaunchUrl?.().then((r) => open(r?.url)).catch(() => undefined);
  app.addListener('appUrlOpen', (e) => open(e.url));
  app.addListener('backButton', () => {
    // Um diálogo nativo do browser (foto, partilha) fecha-se sozinho; aqui tratamos a UI.
    for (let i = backHandlers.length - 1; i >= 0; i--) {
      if (backHandlers[i].fn()) return;
    }
    if (app.minimizeApp) void app.minimizeApp().catch(() => app.exitApp());
    else app.exitApp();
  });
}
