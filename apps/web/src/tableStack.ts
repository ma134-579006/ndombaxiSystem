/**
 * Tabelas no telemóvel SEM scroll horizontal (regra: 0 scroll horizontal, nada
 * cortado). Cada célula recebe o nome da sua coluna (`data-label`, a partir do
 * <th> do cabeçalho) e a tabela ganha a classe `auto-stack`; o CSS (vendus.css)
 * mostra então cada linha como um cartão «Coluna: valor» em ecrãs estreitos.
 * Vale para TODAS as tabelas do painel, mesmo as que já existiam, sem mexer em
 * cada página. As tabelas que já empilham por si (.ptable.stack) ficam como estão.
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

export function initTableStack(): void {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return;
  let queued = false;
  const run = () => {
    queued = false;
    document.querySelectorAll<HTMLTableElement>('.admin .content table:not(.stack)').forEach(label);
  };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
}
