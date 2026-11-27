/**
 * Atualização obrigatória NO LANÇADOR (o primeiro ecrã: escolher Gestão ou Caixa).
 *
 * Bug corrigido (2026-11-27, «o do Android não está a pedir»): a verificação só
 * corria DENTRO da Gestão e da Caixa. A app abre sempre no lançador, que não
 * perguntava nada ao servidor — e no Android a CSP do lançador (`default-src
 * 'self'`) nem deixava falar com a API. Quem ficava no lançador, ou abria um
 * módulo com operações por enviar, nunca via o pedido de atualização.
 *
 * O mesmo ficheiro serve as duas apps:
 *   • Windows (Electron): pergunta ao processo principal (`ndombaxi.update.check`);
 *   • Android (Capacitor): pergunta à API oficial, com a versão gravada no
 *     empacotamento (`native-flag.js`: __NDOMBAXI_APP_VERSION__ e __NDOMBAXI_API_URL__).
 *
 * Regras (iguais a @nexus/update-core): sem resposta do servidor não se tranca;
 * só uma versão MAIOR do canal de produção tranca; o botão só abre páginas https.
 * ES5 de propósito: corre em WebViews antigas.
 */
(function () {
  var OFFICIAL_PAGE = 'https://lpsvendas.com.de/baixar';
  var EVERY_MS = 15 * 60 * 1000;
  var shown = false;

  function cmp(a, b) {
    var pa = String(a).split('.'), pb = String(b).split('.');
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var d = (parseInt(pa[i], 10) || 0) - (parseInt(pb[i], 10) || 0);
      if (d !== 0) return d < 0 ? -1 : 1;
    }
    return 0;
  }
  var VER = /^\d+(\.\d+)*$/;

  function show(installed, version, page, open) {
    if (shown) return;
    shown = true;
    var wrap = document.createElement('div');
    wrap.setAttribute('role', 'alertdialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Atualização obrigatória');
    wrap.id = 'ndx-update';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;'
      + 'padding:20px;background:rgba(6,10,21,.94);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;';
    var card = document.createElement('div');
    card.style.cssText = 'width:100%;max-width:420px;max-height:100%;overflow:auto;background:#0f1630;border:1px solid rgba(255,255,255,.12);'
      + 'border-radius:18px;padding:24px;color:#e2e8f0;box-shadow:0 20px 60px rgba(0,0,0,.5);text-align:center;';
    function el(tag, css, text) { var e = document.createElement(tag); e.style.cssText = css; if (text) e.textContent = text; return e; }
    card.appendChild(el('div', 'font-size:13px;font-weight:700;letter-spacing:.04em;color:#94a3b8;text-transform:uppercase;', 'LPS Vendas'));
    card.appendChild(el('h1', 'font-size:22px;font-weight:700;color:#fff;margin:8px 0 10px;', 'Nova versão disponível'));
    card.appendChild(el('p', 'font-size:15px;line-height:1.5;color:#cbd5e1;margin:0 0 18px;', 'Para continuar é obrigatório atualizar.'));
    var vers = el('div', 'display:flex;gap:10px;margin-bottom:20px;');
    function box(label, value, hi) {
      var b = el('div', 'flex:1;min-width:0;padding:10px;border-radius:12px;background:' + (hi ? 'rgba(67,83,255,.22)' : 'rgba(255,255,255,.06)') + ';');
      b.appendChild(el('div', 'font-size:12px;color:#94a3b8;', label));
      b.appendChild(el('div', 'font-size:17px;font-weight:700;color:#fff;overflow-wrap:anywhere;', value));
      return b;
    }
    vers.appendChild(box('Versão instalada', installed, false));
    vers.appendChild(box('Nova versão', version, true));
    card.appendChild(vers);
    var btn = el('button', 'width:100%;padding:14px;border:0;border-radius:12px;background:#2430e8;color:#fff;font-size:16px;font-weight:700;cursor:pointer;', 'Atualizar Agora');
    btn.type = 'button';
    btn.addEventListener('click', function () { btn.disabled = true; open(page); });
    card.appendChild(btn);
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    document.documentElement.setAttribute('data-update', 'mandatory');
  }

  // ── Windows (Electron): o processo principal já sabe perguntar e abrir a página.
  function desktopCheck(u) {
    u.check().then(function (d) {
      if (!d || d.state !== 'mandatory' || !d.release) return;
      show(d.current || '', d.release.version, d.release.downloadPageUrl, function () { u.openDownloadPage(); });
    }, function () { /* sem resposta: não se tranca */ });
  }

  // ── Android (Capacitor).
  function mobileCheck() {
    var installed = window.__NDOMBAXI_APP_VERSION__, api = window.__NDOMBAXI_API_URL__;
    var platform = window.__NDOMBAXI_APP_PLATFORM__ || 'android';
    if (typeof installed !== 'string' || !VER.test(installed) || typeof api !== 'string' || !/^https:\/\//.test(api)) return;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', api.replace(/\/$/, '') + '/downloads/latest?platform=' + encodeURIComponent(platform) + '&_=' + Date.now());
    xhr.timeout = 10000;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.onload = function () {
      if (xhr.status !== 200) return;
      var r; try { r = JSON.parse(xhr.responseText); } catch (e) { return; }
      if (!r || r.platform !== platform || typeof r.version !== 'string' || !VER.test(r.version)) return;
      if (r.channel && r.channel !== 'production') return;
      if (cmp(installed, r.version) >= 0) return;
      var page = typeof r.downloadPageUrl === 'string' && /^https:\/\/\S+$/i.test(r.downloadPageUrl) ? r.downloadPageUrl : OFFICIAL_PAGE;
      show(installed, r.version, page, function (url) {
        window.open(url, '_blank');
        var cap = window.Capacitor, exit = cap && cap.Plugins && cap.Plugins.App && cap.Plugins.App.exitApp;
        if (exit) setTimeout(function () { exit(); }, 1200);
      });
    };
    xhr.send();
  }

  function run() {
    if (shown) return;
    var u = window.ndombaxi && window.ndombaxi.update;
    if (u && typeof u.check === 'function') desktopCheck(u); else mobileCheck();
  }

  function start() {
    setTimeout(run, 800);
    setInterval(run, EVERY_MS);
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') run(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
