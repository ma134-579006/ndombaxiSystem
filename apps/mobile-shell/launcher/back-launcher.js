/**
 * Seta de VOLTAR ao lançador — só nas apps móveis. O prepare-web.mjs copia este
 * ficheiro para dentro de cada módulo (www/gestao, www/caixa) e injeta um
 * <script src="./back-launcher.js"> no index.html deles. Vive no SHELL, não nos
 * frontends (o site continua sem este botão).
 *
 * Externo (não inline) por causa da CSP `script-src 'self'` dos frontends.
 *
 * COMPORTAMENTO (pedido do utilizador): a seta serve para TROCAR de módulo ANTES
 * de entrar. DEPOIS do login já não é precisa (há "Terminar sessão" no Caixa e
 * no Gestor), por isso esconde-se automaticamente quando há sessão ativa e volta
 * a aparecer no ecrã de login. Deteta a sessão pelos tokens que cada frontend
 * guarda no sessionStorage.
 */
(function () {
  // Sessão ativa → esconder a seta. Gestor: ndombaxi.web.access · Caixa: nexus.pos.access.
  var AUTH_KEYS = ['ndombaxi.web.access', 'nexus.pos.access'];
  function loggedIn() {
    try {
      for (var i = 0; i < AUTH_KEYS.length; i++) {
        if (sessionStorage.getItem(AUTH_KEYS[i]) || localStorage.getItem(AUTH_KEYS[i])) return true;
      }
    } catch (e) { /* storage indisponível */ }
    return false;
  }

  var btn = null;
  function ensure() {
    if (btn) return btn;
    if (document.getElementById('ndx-back-launcher')) { btn = document.getElementById('ndx-back-launcher'); return btn; }
    btn = document.createElement('button');
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
    return btn;
  }

  function update() {
    var b = ensure();
    b.style.display = loggedIn() ? 'none' : 'grid';
  }

  function start() {
    update();
    // A entrada é feita numa SPA (sem recarregar a página), por isso reavaliamos
    // periodicamente e nos eventos de foco/armazenamento — a seta desaparece
    // assim que a sessão é criada e reaparece no logout.
    setInterval(update, 800);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('storage', update);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
