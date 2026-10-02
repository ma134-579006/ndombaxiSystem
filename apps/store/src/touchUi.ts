/**
 * UI TÁTIL — computadores com ecrã tátil (all-in-one, portáteis 2-em-1, quiosques)
 * comportam-se como o TELEMÓVEL:
 *  · html.touch-ui  → menu lateral em gaveta (☰) em vez do "rail" por rato;
 *  · teclado no ecrã → o campo em edição sobe SEMPRE para a zona visível (nunca
 *    fica tapado), o conteúdo ganha espaço por baixo e as janelas encolhem para
 *    caber acima do teclado (variáveis --vvh e --kb, classe html.kb-open).
 */
export function initTouchUi(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const root = document.documentElement;
  const touch = () => (navigator.maxTouchPoints || 0) > 0 || window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches;
  const apply = () => root.classList.toggle('touch-ui', touch());
  apply();
  window.matchMedia('(pointer: coarse)').addEventListener?.('change', apply);
  window.matchMedia('(hover: none)').addEventListener?.('change', apply);

  // Altura realmente visível (descontado o teclado no ecrã, quando o navegador a reporta).
  const vv = window.visualViewport;
  const setVars = () => {
    const h = vv ? vv.height : window.innerHeight;
    const kb = Math.max(0, Math.round(window.innerHeight - (vv ? vv.height + vv.offsetTop : window.innerHeight)));
    root.style.setProperty('--vvh', `${Math.round(h)}px`);
    root.style.setProperty('--kb', `${kb}px`);
    root.classList.toggle('kb-open', kb > 120);
  };
  vv?.addEventListener('resize', setVars);
  vv?.addEventListener('scroll', setVars);
  window.addEventListener('resize', setVars);
  setVars();

  const isField = (el: Element | null): el is HTMLElement =>
    !!el && el.matches?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
    && !el.matches('input[type=checkbox], input[type=radio], input[type=file], input[type=range], input[type=button], input[type=submit], input[type=color]');
  const scrollParent = (el: HTMLElement): HTMLElement | null => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowY;
      if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 4) return p;
    }
    return null;
  };
  // Põe o campo no TERÇO SUPERIOR da zona visível — bem acima do teclado.
  const reveal = (el: HTMLElement) => {
    if (!document.contains(el)) return;
    const vh = vv ? vv.height : window.innerHeight;
    const r = el.getBoundingClientRect();
    if (r.top > vh * 0.12 && r.bottom < vh * 0.5) return; // já está numa zona segura
    const delta = r.top - vh * 0.22;
    const sp = scrollParent(el);
    if (sp) sp.scrollBy({ top: delta, behavior: 'smooth' }); else window.scrollBy({ top: delta, behavior: 'smooth' });
  };
  document.addEventListener('focusin', (e) => {
    const t = e.target as Element | null;
    if (!isField(t)) return;
    root.classList.add('input-focus');
    // O teclado demora a abrir e a redimensionar: repete para apanhar o estado final.
    [120, 350, 750].forEach((ms) => window.setTimeout(() => { if (document.activeElement === t) reveal(t); }, ms));
  });
  document.addEventListener('focusout', () => {
    window.setTimeout(() => { if (!isField(document.activeElement)) root.classList.remove('input-focus'); }, 120);
  });
}
