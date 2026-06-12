/**
 * SCROLL-REVEAL global da loja — nível enterprise, ZERO dependências.
 *
 * Os blocos (cartões, produtos do catálogo, secções) materializam-se ao entrar
 * no ecrã quando o cliente rola para baixo e recuam ao sair — dando à montra um
 * efeito premium de catálogo. Aplica-se sem tocar nos componentes: um único
 * observador marca os alvos com [data-reveal] e alterna "in"/"out"; um
 * MutationObserver apanha conteúdo novo (mudar de vista/loja). Respeita
 * prefers-reduced-motion e nada esconde se o JS não correr (CSS sob .reveal-ready).
 */

// NB: os .product já têm a sua micro-animação de entrada (prod-in) — aqui
// revelamos a GRELHA (.products) e os blocos maiores, sem conflito.
const SELECTOR = '.card, .products, .hero, .store-info, section';
const SKIP = '.modal-bg, .modal, .header, .drawer, .cart-drawer';

let io: IntersectionObserver | null = null;

function track(el: Element): void {
  const h = el as HTMLElement;
  if (h.dataset.reveal) return;
  if (h.closest(SKIP)) return;
  h.dataset.reveal = 'out';
  io?.observe(el);
}

function scan(root: ParentNode): void {
  root.querySelectorAll?.(SELECTOR).forEach(track);
}

export function initScrollReveal(): void {
  if (typeof window === 'undefined' || io) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        (e.target as HTMLElement).dataset.reveal = e.isIntersecting ? 'in' : 'out';
      }
    },
    { threshold: 0.06, rootMargin: '-4% 0px -6% 0px' },
  );

  document.documentElement.classList.add('reveal-ready');
  scan(document);

  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        const el = n as Element;
        if (el.matches?.(SELECTOR)) track(el);
        scan(el);
      });
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
}
