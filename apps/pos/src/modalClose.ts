/* Garantia global: toda a janela (.modal-bg > .modal) tem um botão de fechar.
   Se a janela já traz o seu (vf-x, vw-x, modal-x, aria-label "Fechar"), não faz
   nada. Só aparece em janelas que se fecham ao clicar no fundo (têm onClick no
   .modal-bg); as obrigatórias (bloqueio, atualização) ficam sem botão. */
const NS = 'http://www.w3.org/2000/svg';

function dismissible(bg: Element): boolean {
  const k = Object.keys(bg).find((x) => x.startsWith('__reactProps'));
  const p = k ? (bg as unknown as Record<string, { onClick?: unknown }>)[k] : undefined;
  return typeof p?.onClick === 'function';
}

function ensure(bg: Element): void {
  const box = bg.querySelector(':scope > .modal');
  if (!box || box.querySelector('.modal-x-auto, .modal-x, .vf-x, .vw-x, button[aria-label="Fechar"], button[aria-label="Close"]')) return;
  if (!dismissible(bg)) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'modal-x-auto';
  b.setAttribute('aria-label', 'Fechar');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2.4'); svg.setAttribute('stroke-linecap', 'round');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M6 6l12 12M18 6L6 18');
  svg.appendChild(path); b.appendChild(svg);
  b.addEventListener('click', (e) => { e.stopPropagation(); (bg as HTMLElement).click(); });
  (box as HTMLElement).style.position = (box as HTMLElement).style.position || 'relative';
  box.appendChild(b);
}

export function installModalClose(): void {
  if (typeof document === 'undefined') return;
  const scan = () => document.querySelectorAll('.modal-bg').forEach(ensure);
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
}
