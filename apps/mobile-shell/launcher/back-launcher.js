/**
 * Seta de VOLTAR ao lançador — nas apps móveis. O prepare-web.mjs copia este
 * ficheiro para dentro de cada módulo (www/gestao, www/caixa) e injeta um
 * <script src="./back-launcher.js"> no index.html deles. É o equivalente móvel
 * da injeção que o preload do Electron faz no desktop: vive no SHELL, não nos
 * frontends (o site continua sem este botão).
 *
 * Externo (não inline) por causa da CSP `script-src 'self'` dos frontends.
 */
(function () {
  function inject() {
    if (document.getElementById('ndx-back-launcher')) return;
    var btn = document.createElement('button');
    btn.id = 'ndx-back-launcher';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Voltar ao início');
    btn.setAttribute('title', 'Voltar ao início (trocar de módulo)');
    btn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M19 12H5M11 18l-6-6 6-6"/></svg>';
    var s = btn.style;
    s.position = 'fixed';
    s.top = 'calc(env(safe-area-inset-top, 0px) + 8px)';
    s.left = '8px';
    s.zIndex = '2147483647';
    s.width = '38px';
    s.height = '38px';
    s.display = 'grid';
    s.placeItems = 'center';
    s.padding = '0';
    s.borderRadius = '11px';
    s.border = '1px solid rgba(148,163,184,.32)';
    s.background = 'rgba(15,23,42,.82)';
    s.color = '#e2e8f0';
    s.cursor = 'pointer';
    s.boxShadow = '0 4px 14px rgba(0,0,0,.3)';
    s.webkitBackdropFilter = 'blur(6px)';
    s.backdropFilter = 'blur(6px)';
    btn.addEventListener('click', function () {
      // O lançador está uma pasta acima do módulo (www/index.html).
      window.location.href = '../index.html';
    });
    document.body.appendChild(btn);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
