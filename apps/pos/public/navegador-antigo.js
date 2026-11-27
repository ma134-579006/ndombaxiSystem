/*
 * Navegadores abaixo do alvo do build (Safari < 12 / iOS 9–11, Chrome < 64, navegador de
 * fábrica do Android 4): o código da Caixa (módulo ES2019) não corre e o ecrã ficava preso
 * em «A carregar…». Este ficheiro é ES5 e clássico (corre em todos): se faltar o essencial,
 * troca o ecrã de arranque por um aviso (missão QA, QA-033). Externo por causa da CSP.
 */
(function () {
  var s = document.createElement('script');
  var ok = ('noModule' in s) && typeof Array.prototype.flat === 'function' && typeof Object.fromEntries === 'function' && typeof Promise !== 'undefined';
  if (ok) return;
  function aviso() {
    var root = document.getElementById('root');
    if (!root) return;
    root.innerHTML = '<div style="position:fixed;top:0;left:0;right:0;bottom:0;display:table;width:100%;height:100%;background:#0b1020;color:#fff;font:16px Arial,sans-serif;text-align:center">'
      + '<div style="display:table-cell;vertical-align:middle;padding:24px">'
      + '<img src="/logo.png" alt="" style="width:96px;height:auto;margin-bottom:16px">'
      + '<div style="font-size:18px;font-weight:bold;margin-bottom:8px">Navegador desatualizado</div>'
      + '<div>Atualize o sistema do aparelho ou instale o Google Chrome.</div>'
      + '</div></div>';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', aviso); else aviso();
})();
