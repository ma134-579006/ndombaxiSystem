/**
 * Lógica do lançador móvel. Externo (não inline) por consistência com o
 * lançador do desktop: se um dia a WebView aplicar uma CSP `script-src 'self'`
 * (ou o Capacitor a apertar), um script inline deixaria de correr e os cartões
 * ficariam sem ação — o mesmo bug que os módulos que não abriam no Windows.
 */
(function () {
  // O LANÇADOR é sempre o primeiro ecrã (escolher Gestão ou Caixa). Já não há
  // auto-redirect: de dentro de cada módulo a seta de voltar regressa aqui para
  // trocar. Igual ao desktop.
  function wire() {
    var cards = document.querySelectorAll('.card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener('click', function () {
        location.href = this.getAttribute('data-go');
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
