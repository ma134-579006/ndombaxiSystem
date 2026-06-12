/**
 * SCROLL-REVEAL global — nível enterprise, ZERO dependências.
 *
 * Os blocos de conteúdo (cartões, KPIs, tabelas, secções) MATERIALIZAM-SE
 * suavemente quando entram no ecrã ao rolar para baixo ("como se nunca tivessem
 * lá") e recuam ao sair (rolar para cima). Efeito aplicado a TODO o sistema sem
 * tocar em cada componente: um único observador marca os alvos com [data-reveal]
 * e alterna "in"/"out" conforme a visibilidade. Um MutationObserver apanha o
 * conteúdo que a SPA injeta ao trocar de página/secção. Respeita
 * prefers-reduced-motion (não anima) e nunca esconde nada se o JS não correr
 * (o CSS só atua sob .reveal-ready).
 */

// Blocos que valem a pena revelar. Evita elementos estruturais (sidebar/topbar)
// e contextos onde a animação atrapalha (login, modais — têm a sua própria).
const SELECTOR =
  '.card, .kpi-card, .pcard, .ptable, .minilist, .content-head, .chart-card, .bar-card, ' +
  '.lp-section, .lp-trust, .lp-feat, .lp-plan, section';
const SKIP = '.login, .modal-bg, .modal, .sidebar, .topbar, .shadow-bar';

let io: IntersectionObserver | null = null;

function track(el: Element): void {
  const h = el as HTMLElement;
  if (h.dataset.reveal) return; // já observado
  if (h.closest(SKIP)) return; // contexto excluído
  h.dataset.reveal = 'out';
  io?.observe(el);
}

function scan(root: ParentNode): void {
  root.querySelectorAll?.(SELECTOR).forEach(track);
}

export function initScrollReveal(): void {
  if (typeof window === 'undefined' || io) return;
  // Acessibilidade: quem prefere menos movimento não recebe a animação.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          // Revela UMA vez e deixa de observar — nunca volta a esconder ao
          // rolar para cima (evita o efeito de "aparecer/desaparecer").
          (e.target as HTMLElement).dataset.reveal = 'in';
          io?.unobserve(e.target);
        }
      }
    },
    { threshold: 0.04, rootMargin: '0px 0px -4% 0px' },
  );

  // O CSS só esconde os alvos quando esta classe existe → sem flash se algo falhar.
  document.documentElement.classList.add('reveal-ready');
  scan(document);

  // Conteúdo novo (troca de secção/página numa SPA).
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
