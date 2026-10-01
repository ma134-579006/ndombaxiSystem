/**
 * SCROLL-FX global (admin, caixa, loja) — ZERO dependências.
 *
 * Os blocos de conteúdo entram no ecrã com uma animação e, ao saírem, ficam
 * prontos para voltar a entrar — por isso aparecem ao rolar para baixo E para
 * cima. A animação MUDA de cada vez (sobe, desce, entra pela esquerda/direita,
 * zoom, inclinação), escolhida ao sair do ecrã, e os blocos que entram juntos
 * escalonam-se. Nunca se esconde nada que esteja visível (só se prepara o que
 * está totalmente fora do ecrã) e blocos muito altos ficam sempre visíveis.
 * Respeita prefers-reduced-motion e, sem JS, nada fica escondido.
 */
const SELECTOR =
  '.card, .kpi-card, .ui-tile, .fx-stat, .fx-card, .pcard, .pc2, .prod, .ax-card, .ax-sec, .rt-table, .rc-row, .ph-row, .chart-card, .bar-card, ' +
  '.ptable, .minilist, .lp-section, .lp-trust, .lp-feat, .lp-plan, .store-info, .order-card';
const SKIP = '.login, .modal-bg, .modal, .sidebar, .topbar, .header, .ax-header, .drawer, .cart-drawer, .lock, .shadow-bar, .toolbar-sticky, .fx-toolbar, .gate';
const VARIANTS = ['up', 'down', 'left', 'right', 'zoom', 'tilt'];

let io: IntersectionObserver | null = null;
const pick = () => VARIANTS[Math.floor(Math.random() * VARIANTS.length)];

function track(el: Element): void {
  const h = el as HTMLElement;
  if (h.dataset.reveal) return;
  if (h.closest(SKIP)) return;
  h.dataset.reveal = 'out';
  h.dataset.fx = pick();
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
      let n = 0;
      for (const e of entries) {
        const h = e.target as HTMLElement;
        if (e.isIntersecting) {
          // Blocos mais altos que o ecrã nunca se escondem.
          if (e.boundingClientRect.height > window.innerHeight * 0.85) { h.dataset.reveal = 'in'; io?.unobserve(h); continue; }
          h.style.setProperty('--rd', `${Math.min(n++, 8) * 90}ms`);
          h.dataset.reveal = 'in';
        } else if (h.dataset.reveal === 'in') {
          // Saiu totalmente do ecrã: prepara a próxima entrada com outro efeito.
          h.style.setProperty('--rd', '0ms');
          h.dataset.fx = pick();
          h.dataset.reveal = 'out';
        }
      }
    },
    { threshold: 0, rootMargin: '0px 0px -5% 0px' },
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
