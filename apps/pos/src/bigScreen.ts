/* Ecrãs enormes (4K, 8K, TV de 100–200"): a interface é ampliada em proporção à
   largura, para o texto e os botões manterem o tamanho legível à distância em vez
   de ficarem minúsculos. Até 2200px nada muda. --uz alimenta os cálculos de altura. */
const BASE = 1920;
const START = 2200;
const MAX = 4;

function apply(): void {
  const w = window.innerWidth;
  const s = w < START ? 1 : Math.min(MAX, Math.round((w / BASE) * 100) / 100);
  const el = document.documentElement;
  el.style.zoom = s === 1 ? '' : String(s);
  el.style.setProperty('--uz', String(s));
}

export function installBigScreen(): void {
  if (typeof window === 'undefined') return;
  apply();
  let t = 0;
  window.addEventListener('resize', () => { window.clearTimeout(t); t = window.setTimeout(apply, 120); });
}
