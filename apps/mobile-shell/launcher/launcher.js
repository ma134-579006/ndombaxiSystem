/**
 * Lógica do lançador móvel. Externo (não inline) por consistência com o
 * lançador do desktop: se um dia a WebView aplicar uma CSP `script-src 'self'`
 * (ou o Capacitor a apertar), um script inline deixaria de correr e os cartões
 * ficariam sem ação — o mesmo bug que os módulos que não abriam no Windows.
 */
(function () {
  var KEY = 'ndombaxi.module';

  // Se já escolheu antes, abre direto — sem obrigar a escolher todos os dias.
  var saved = localStorage.getItem(KEY);
  if (saved === './gestao/' || saved === './caixa/') { location.replace(saved); return; }

  function wire() {
    var cards = document.querySelectorAll('.card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener('click', function () {
        var go = this.getAttribute('data-go');
        localStorage.setItem(KEY, go);
        location.href = go;
      });
    }
    document.documentElement.setAttribute('data-launcher', 'ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
