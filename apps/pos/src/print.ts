/**
 * Largura do papel da impressora térmica (por DISPOSITIVO — a impressora é
 * física, por isso a escolha fica no localStorage deste aparelho).
 *
 * O tamanho da página de impressão (`@page { size }`) não aceita variáveis CSS,
 * por isso injectamos dinamicamente uma regra `@page` no <head>; as larguras do
 * conteúdo usam a variável CSS `--paper-mm`.
 */
export type PaperWidth = '80' | '58';
export const PAPER_WIDTHS: { id: PaperWidth; label: string }[] = [
  { id: '80', label: '80 mm' },
  { id: '58', label: '58 mm' },
];

const LS_KEY = 'ndombaxi.pos.paper';
const STYLE_ID = 'ndbx-print-paper';

export function getPaper(): PaperWidth {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v === '58' ? '58' : '80';
  } catch { return '80'; }
}

export function applyPaper(width: PaperWidth): void {
  // Largura do conteúdo (usada no @media print via var).
  document.documentElement.style.setProperty('--paper-mm', `${width}mm`);
  // Regra @page dinâmica (sobrepõe a do CSS, pois é injectada depois).
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = `@media print { @page { size: ${width}mm auto; margin: 0; } }`;
}

export function setPaper(width: PaperWidth): void {
  try { localStorage.setItem(LS_KEY, width); } catch { /* ignora */ }
  applyPaper(width);
}

export function initPaper(): void { applyPaper(getPaper()); }
