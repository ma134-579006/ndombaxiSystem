/**
 * Empilha o cabeçalho da página (título + botões) e a barra de pesquisa: ambos
 * ficam FIXOS no topo ao rolar, abaixo da barra do topo. Alturas medidas aqui:
 * --tb-h (barra do topo) e --ch-h (barra + cabeçalho; a pesquisa fixa-se aí).
 */
export function initStickyStack(): void {
  if (typeof window === 'undefined') return;
  let raf = 0;
  const measure = () => {
    raf = 0;
    const c = document.querySelector('.content') as HTMLElement | null;
    if (!c) return;
    const h = c.querySelector('.content-head') as HTMLElement | null;
    const t = document.querySelector('.main > .topbar') as HTMLElement | null;
    const tb = t && getComputedStyle(t).position === 'sticky' ? Math.ceil(t.getBoundingClientRect().height) : 0;
    const hh = h && getComputedStyle(h).position === 'sticky' ? Math.ceil(h.getBoundingClientRect().height) : 0;
    const set = (k: string, v: string) => { if (c.style.getPropertyValue(k) !== v) c.style.setProperty(k, v); };
    set('--tb-h', `${tb}px`);
    set('--ch-h', `${tb + hh}px`);
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  schedule();
}
