/**
 * MOTION da LANDING — nível enterprise (Apple/Stripe/Linear), zero dependências.
 *
 * Coreografia POR SECÇÃO (cada bloco tem personalidade própria):
 *  · Títulos/leads  → blur-reveal cinemático (fade + rise + blur 6→0)
 *  · Módulos        → cascata (stagger) de cartões a materializar
 *  · Passos         → slide alternado esquerda/direita (ritmo de narrativa)
 *  · Porquê/FAQ/Stats → rise suave escalonado
 *  · Planos/CTA     → scale 0.96→1 + fade (presença, sem espalhafato)
 *  · Mockup do hero → parallax discreto (±14px, transform-only, rAF)
 *
 * Comportamento CONTÍNUO: os blocos recuam ao sair do ecrã e reaparecem ao
 * voltar (subir ou descer) — IntersectionObserver bidirecional. O delay do
 * stagger aplica-se SÓ na entrada (saída é imediata, sem "cauda").
 *
 * Performance: só opacity/transform (+blur apenas em títulos pequenos),
 * will-change, sem mudanças de layout (zero CLS), listeners passivos.
 * Acessibilidade: prefers-reduced-motion → nada anima; sem JS → tudo visível
 * (os estados escondidos só existem sob html.fxr-on).
 */

type FxKind = 'up' | 'left' | 'right' | 'scale' | 'title';

// O HERO (copy/carrossel/typing) fica de fora — é o LCP e já tem vida própria.
const CHOREOGRAPHY: [selector: string, fx: FxKind, staggerMs: number][] = [
  ['.lp-section .wrap > h2', 'title', 0],
  ['.lp-section .wrap > .lead', 'title', 120],
  ['.lp-modules .lp-mod', 'up', 90],
  ['.lp-why .lp-whyi', 'up', 95],
  ['.lp-faq details', 'up', 70],
  ['.lp-stats > div', 'up', 100],
  ['.lp-plans .lp-plan', 'scale', 110],
  ['.lp-cta-band', 'scale', 0],
  // Comentários da comunidade: cada cartão de utilizador entra em cascata.
  ['.fb-list .fb-item', 'up', 90],
  // Página inicial nova (estrutura da referência): cada bloco entra ao descer
  // e recua ao sair, nos dois sentidos do scroll.
  ['.lv-h2', 'title', 0],
  ['.lv-lead', 'title', 120],
  ['.lv-tabs', 'up', 0],
  ['.lv-sol-media', 'left', 0],
  ['.lv-sol-txt', 'right', 120],
  ['.lv-stats-txt', 'left', 0],
  ['.lv-stats-nums > div', 'up', 120],
  ['.lv-why-card', 'scale', 0],
  ['.lv-plan', 'scale', 110],
  ['.lv-note', 'up', 0],
  ['.lv-testi-h', 'up', 0],
  ['.lv-testi .fb-form', 'up', 0],
  ['.lv-faq-list .lv-h3', 'title', 0],
  ['.lv-qa', 'up', 70],
  ['.lv-faq-aside', 'right', 0],
  ['.lv-peek-stage', 'scale', 0],
  ['.lv-band .lv-wrap > *', 'up', 110],
  ['.dl-section .dl-trust', 'up', 0],
  ['.dl-card', 'up', 100],
  ['.lv-about', 'up', 0],
  ['.lv-fcols > div', 'up', 90],
  ['.lv-fbar', 'up', 0],
];

let io: IntersectionObserver | null = null;
let mo: MutationObserver | null = null;
let parallaxRaf = 0;
let onScroll: (() => void) | null = null;

/** Atribui a coreografia (idempotente — dataset.fx marca o que já está). */
function applyChoreography(): void {
  for (const [sel, fx, stagger] of CHOREOGRAPHY) {
    document.querySelectorAll<HTMLElement>(sel).forEach((el, i) => {
      // Já marcado (ex.: o efeito voltou a montar): basta voltar a observar.
      if (el.dataset.fx) { io?.observe(el); return; }
      el.dataset.fx = fx;
      if (stagger) el.style.setProperty('--fxd', `${Math.min(i, 6) * stagger}ms`);
      io?.observe(el);
    });
  }
  document.querySelectorAll<HTMLElement>('.lp-steps .lp-step').forEach((el, i) => {
    if (el.dataset.fx) { io?.observe(el); return; }
    el.dataset.fx = i % 2 === 0 ? 'left' : 'right';
    el.style.setProperty('--fxd', `${Math.min(i, 6) * 110}ms`);
    io?.observe(el);
  });
}

export function initLandingReveal(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => undefined;
  if (io) return teardown; // já ativo (StrictMode monta 2×)

  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        (e.target as HTMLElement).classList.toggle('fx-in', e.isIntersecting);
      }
    },
    { threshold: 0.06, rootMargin: '-4% 0px -6% 0px' },
  );

  applyChoreography();

  // Conteúdo ASYNC (ex.: comentários da comunidade chegam por fetch): um
  // MutationObserver re-aplica a coreografia a nós novos (idempotente).
  mo = new MutationObserver(() => applyChoreography());
  mo.observe(document.body, { childList: true, subtree: true });

  // Parallax DISCRETO do mockup do hero (decorativo, aria-hidden): ±14px.
  const mock = document.querySelector<HTMLElement>('.lp-mockup');
  if (mock) {
    onScroll = () => {
      if (parallaxRaf) return;
      parallaxRaf = requestAnimationFrame(() => {
        parallaxRaf = 0;
        const y = Math.max(-14, Math.min(14, window.scrollY * -0.035));
        mock.style.transform = `translateY(${y}px)`;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  document.documentElement.classList.add('fxr-on');
  return teardown;
}

function teardown(): void {
  io?.disconnect();
  io = null;
  mo?.disconnect();
  mo = null;
  if (onScroll) window.removeEventListener('scroll', onScroll);
  onScroll = null;
  if (parallaxRaf) cancelAnimationFrame(parallaxRaf);
  parallaxRaf = 0;
  document.documentElement.classList.remove('fxr-on');
}
