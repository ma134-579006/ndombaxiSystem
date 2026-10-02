/**
 * Empilha o cabeçalho da página (título + botões) e a barra de pesquisa: ambos
 * ficam FIXOS no topo ao rolar, um por baixo do outro. A altura do cabeçalho é
 * medida aqui e exposta ao CSS em --ch-h (a pesquisa fixa-se logo abaixo dele).
 */
export function initStickyStack(): void {
  if (typeof window === 'undefined') return;
  let raf = 0;
  const measure = () => {
    raf = 0;
    const c = document.querySelector('.content') as HTMLElement | null;
    if (!c) return;
    const h = c.querySelector('.content-head') as HTMLElement | null;
    const v = h ? `${Math.ceil(h.getBoundingClientRect().height)}px` : '0px';
    if (c.style.getPropertyValue('--ch-h') !== v) c.style.setProperty('--ch-h', v);
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  schedule();
}
