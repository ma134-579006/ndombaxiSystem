/**
 * Auto-atualização: deteta quando foi publicada uma nova versão (o nome do
 * bundle muda a cada build) e recarrega a app automaticamente — assim o
 * utilizador nunca fica preso a uma versão antiga em cache. O index.html é
 * servido com `no-store`, por isso a verificação traz sempre o mais recente.
 */
function currentBundleHash(): string | null {
  const scripts = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[];
  for (const s of scripts) {
    const m = s.src.match(/assets\/index-([\w-]+)\.js/);
    if (m) return m[1];
  }
  return null;
}

export function initAutoUpdate(opts?: { canReload?: () => boolean }) {
  const current = currentBundleHash();
  if (!current) return;
  let reloading = false;
  let pending = false;

  const canReload = () => !opts?.canReload || opts.canReload();
  const doReload = () => {
    if (reloading) return;
    reloading = true;
    // Cache-bust definitivo: recarrega ignorando a cache do browser.
    location.reload();
  };

  const check = async () => {
    try {
      const html = await fetch('/?_v=' + Date.now(), { cache: 'no-store' }).then((r) => r.text());
      const m = html.match(/assets\/index-([\w-]+)\.js/);
      const latest = m ? m[1] : null;
      if (latest && latest !== current) {
        pending = true;
        if (canReload()) doReload();
      }
    } catch { /* offline / sem rede — tenta depois */ }
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
