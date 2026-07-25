/**
 * Lógica do lançador. Vive num ficheiro EXTERNO (não inline) de propósito: o
 * protocolo `ndombaxi://` injeta uma CSP com `script-src 'self'` em todas as
 * páginas, o que BLOQUEIA scripts inline. Um script inline aqui não corria e os
 * cartões ficavam sem ação — foi exatamente o bug em que os cliques em
 * "Painel de Gestão" e "Caixa" não abriam nada. Servido de 'self', é permitido.
 */
(function () {
  function pick(moduleId) {
    // `window.ndombaxi` vem do preload (contextBridge). Se faltar, avisamos em
    // vez de falhar em silêncio — assim um problema de ponte fica visível.
    if (window.ndombaxi && window.ndombaxi.settings && typeof window.ndombaxi.settings.setModule === 'function') {
      window.ndombaxi.settings.setModule(moduleId);
    } else {
      document.body.setAttribute('data-bridge', 'missing');
      alert('Não foi possível abrir o módulo (ponte do sistema indisponível). Feche e volte a abrir a aplicação; se persistir, contacte o suporte.');
    }
  }

  function wire() {
    var cards = document.querySelectorAll('.card');
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        card.addEventListener('click', function () { pick(card.getAttribute('data-module')); });
      })(cards[i]);
    }
    // Marcador: prova que ESTE script correu sob a CSP do protocolo. Se a CSP
    // o bloqueasse (o bug dos módulos que não abriam), o atributo não existiria.
    document.documentElement.setAttribute('data-launcher', 'ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
