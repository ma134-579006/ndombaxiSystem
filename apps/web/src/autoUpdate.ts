/**
 * Auto-atualização: deteta quando foi publicada uma nova versão (o nome do
 * bundle muda a cada build) e recarrega a app automaticamente — assim o
 * utilizador nunca fica preso a uma versão antiga em cache. O index.html é
 * servido com `no-store`, por isso a verificação traz sempre o mais recente.
 *
 * Postura defensiva no REGRESSO DO SEGUNDO PLANO (a origem do "volta congelada /
 * nunca mais abre" que os utilizadores relatavam):
 *   • a sonda tem timeout — uma rede lenta pós-resume não deixa um fetch preso;
 *   • nunca se recarrega OFFLINE — com o rádio ainda a reconectar, um reload sem
 *     servidor deixa o ecrã em branco;
 *   • trava anti-ciclo — um deploy inconsistente (o servidor anuncia um bundle
 *     que, ao recarregar, não passa a ser o corrente) faria a app recarregar para
 *     sempre; limitamos as recargas por minuto.
 */
const CHECK_TIMEOUT_MS = 8_000;
const RELOAD_GUARD_KEY = 'ndombaxi.autoupdate.reloads';
const RELOAD_GUARD_MAX = 3;      // recargas...
const RELOAD_GUARD_WINDOW = 60_000; // ...por esta janela (ms)

function currentBundleHash(): string | null {
  const scripts = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[];
  for (const s of scripts) {
    const m = s.src.match(/assets\/index-([\w-]+)\.js/);
    if (m) return m[1];
  }
  return null;
}

/** Trava anti-ciclo: no máximo N recargas por janela de tempo, por sessão. */
function reloadAllowedByLoopGuard(): boolean {
  try {
    const now = Date.now();
    const raw = sessionStorage.getItem(RELOAD_GUARD_KEY);
    const hits = (raw ? JSON.parse(raw) as number[] : []).filter((t) => now - t < RELOAD_GUARD_WINDOW);
    if (hits.length >= RELOAD_GUARD_MAX) return false;
    hits.push(now);
    sessionStorage.setItem(RELOAD_GUARD_KEY, JSON.stringify(hits));
    return true;
  } catch {
    return true; // sem sessionStorage: não bloqueamos a funcionalidade
  }
}

/**
 * Guarda por omissão (usada quando quem chama não passa `canReload`): não
 * recarregar por baixo de trabalho em curso — o utilizador a escrever, ou um
 * diálogo/modal aberto.
 */
function defaultCanReload(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return false;
  if (document.querySelector('[role="dialog"], dialog[open], .modal-open')) return false;
  return true;
}

export function initAutoUpdate(opts?: { canReload?: () => boolean }) {
  const current = currentBundleHash();
  if (!current) return;
  let reloading = false;
  let pending = false;

  const canReload = () => (opts?.canReload ? opts.canReload() : defaultCanReload());
  const doReload = () => {
    if (reloading) return;
    // Nunca recarregar offline: no regresso do segundo plano a rede ainda está a
    // reconectar e um reload sem servidor deixa o ecrã em branco.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (!reloadAllowedByLoopGuard()) return;
    reloading = true;
    // Cache-bust definitivo: recarrega ignorando a cache do browser.
    location.reload();
  };

  const check = async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
      let html: string;
      try {
        html = await fetch('/?_v=' + Date.now(), { cache: 'no-store', signal: ctrl.signal }).then((r) => r.text());
      } finally {
        clearTimeout(t);
      }
      const m = html.match(/assets\/index-([\w-]+)\.js/);
      const latest = m ? m[1] : null;
      if (latest && latest !== current) {
        pending = true;
        if (canReload()) doReload();
      }
    } catch { /* offline / sem rede / timeout — tenta depois */ }
  };

  setTimeout(check, 5000);             // logo após arrancar
  setInterval(check, 60000);           // de minuto a minuto
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (pending && canReload()) doReload(); else void check();
  });
  window.addEventListener('focus', () => { if (pending && canReload()) doReload(); });
  // Chunk antigo já não existe no servidor após deploy → recarrega.
  window.addEventListener('vite:preloadError', () => doReload());
}
