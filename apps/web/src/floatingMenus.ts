/**
 * Menus "Opções" das tabelas: o contentor da tabela (.vd-tablewrap) tem
 * overflow para deslizar na horizontal, o que CORTAVA os menus que abriam
 * dentro dele (botões sobrepostos e inacessíveis). Aqui cada menu de linha
 * (.vd-opts > .vd-drop) passa a ser desenhado em posição FIXA, junto ao botão,
 * por cima de tudo — abre para cima quando não há espaço por baixo.
 */
function place(drop: HTMLElement): void {
  const host = drop.parentElement;
  const btn = host?.querySelector<HTMLElement>(':scope > button, :scope > .vd-btn');
  if (!host || !btn) return;
  const r = btn.getBoundingClientRect();
  drop.style.position = 'fixed';
  drop.style.zIndex = '1200';
  drop.style.left = 'auto';
  drop.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  drop.style.bottom = 'auto';
  drop.style.top = '0px';
  const h = drop.offsetHeight;
  const below = window.innerHeight - r.bottom;
  const top = below >= h + 12 || r.top < h + 12 ? r.bottom + 4 : r.top - h - 4;
  drop.style.top = `${Math.max(8, Math.min(top, window.innerHeight - h - 8))}px`;
}

function placeAll(): void {
  document.querySelectorAll<HTMLElement>('.vd-opts > .vd-drop').forEach(place);
}

export function initFloatingMenus(): void {
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (!(n instanceof HTMLElement)) continue;
        if (n.matches('.vd-opts > .vd-drop')) place(n);
        n.querySelectorAll?.<HTMLElement>('.vd-opts > .vd-drop').forEach(place);
      }
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('scroll', placeAll, true);
  window.addEventListener('resize', placeAll);
}
