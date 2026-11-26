/**
 * Tabelas SEM scroll horizontal e sem colunas cortadas, em QUALQUER largura (regra:
 * 0 scroll horizontal, nada cortado). Cada célula recebe o nome da sua coluna
 * (`data-label`, a partir do <th>) e, quando a tabela NÃO CABE no espaço real que
 * tem (telemóvel, tablet, ou computador com o menu fixo aberto), ganha a classe
 * `is-stacked`: o CSS (vendus.css) mostra então cada linha como um cartão
 * «Coluna: valor». Quando volta a caber, volta a ser tabela. Vale para TODAS as
 * tabelas do painel sem mexer em cada página (as .ptable.stack já tratam de si).
 */
function label(table: HTMLTableElement): void {
  const head = table.tHead?.rows[0];
  if (!head) return;
  const names: string[] = [];
  for (const th of Array.from(head.cells)) {
    const t = (th.textContent ?? '').replace(/\s+/g, ' ').trim();
    for (let i = 0; i < Math.max(1, th.colSpan); i++) names.push(t);
  }
  const groups: HTMLTableSectionElement[] = [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])];
  for (const body of groups) {
    for (const row of Array.from(body.rows)) {
      let col = 0;
      for (const td of Array.from(row.cells)) {
        const name = names[col] ?? '';
        if (name && td.getAttribute('data-label') !== name) td.setAttribute('data-label', name);
        col += Math.max(1, td.colSpan);
      }
    }
  }
  if (!table.classList.contains('auto-stack')) table.classList.add('auto-stack');
}

/** Empilha quando a largura natural da tabela passa o espaço disponível. */
function fit(table: HTMLTableElement): void {
  const box = table.parentElement;
  if (!box || !table.tHead) return;
  // Espaço ÚTIL: sem o padding do contentor (antes a tabela podia invadir a margem do quadro).
  const cs = getComputedStyle(box);
  const avail = box.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  if (avail <= 0) return;
  if (!table.classList.contains('is-stacked')) {
    const natural = table.scrollWidth;
    table.dataset.nw = String(natural);
    if (natural > avail + 1) table.classList.add('is-stacked');
  } else {
    const nw = Number(table.dataset.nw || 0);
    // Só volta a tabela quando a largura natural (medida antes de empilhar) cabe.
    if (nw > 0 && nw <= avail) table.classList.remove('is-stacked');
  }
}

export function initTableStack(): void {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return;
  let queued = false;
  const run = () => {
    queued = false;
    document.querySelectorAll<HTMLTableElement>('.admin .content table:not(.stack)').forEach((t) => { label(t); fit(t); });
  };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  // O menu fixo abre/fecha e muda a largura do conteúdo sem «resize» da janela:
  // observa-se a área de conteúdo (e volta-se a ligar se ela for recriada).
  let ro: ResizeObserver | null = null;
  let watched: Element | null = null;
  const watch = () => {
    if (typeof ResizeObserver === 'undefined') return;
    const c = document.querySelector('.admin .content');
    if (c === watched) return;
    ro?.disconnect();
    watched = c;
    // Só a LARGURA interessa: a altura muda a cada linha desenhada (tabelas longas) e
    // reagir a isso refazia a medição de todas as tabelas sem necessidade.
    let lastW = -1;
    if (c) { ro = new ResizeObserver((es) => { const w = Math.round(es[0]?.contentRect.width ?? 0); if (w !== lastW) { lastW = w; schedule(); } }); ro.observe(c); }
  };
  new MutationObserver(watch).observe(document.body, { childList: true, subtree: true });
  watch();
  schedule();
}
