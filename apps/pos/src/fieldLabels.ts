/* Garantia global de acessibilidade (missão QA F5): cada rótulo visível de um
   campo (`.field > label`, padrão usado em ~460 formulários) fica LIGADO ao seu
   campo (também `.vd-row > .vd-lbl`, formulários de página como Produtos). Sem isto o leitor de ecrã lia só «campo de texto» e tocar no rótulo
   não fazia nada.
   - Liga por `aria-labelledby` (dá um id ao RÓTULO, nunca ao campo: o id do campo
     é a chave dos rascunhos automáticos — ver workspace.ts).
   - Tocar no rótulo põe o foco no campo (o que `for` faria).
   - Só toca em campos sem nome acessível próprio e em rótulos sem `for`. */
const CAMPO = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), select, textarea';
let seq = 0;

/** Padrões de formulário: [contentor, rótulo dentro dele]. */
const PADROES: [string, string][] = [['.field', ':scope > label'], ['.vd-row', ':scope > .vd-lbl']];

function ligar(field: Element, rotulo: string): void {
  const label = field.querySelector(rotulo);
  if (!label || label.hasAttribute('for') || (label as HTMLElement).dataset.nxLigado) return;
  if (label.querySelector(CAMPO)) return; // rótulo que já envolve o campo
  // Linha com vários controlos (ex.: categoria + «Nova categoria»): todos os que
  // não têm nome próprio ficam ligados ao rótulo da linha; o toque foca o 1.º.
  const campos = [...field.querySelectorAll(CAMPO)] as HTMLElement[];
  const semNome = campos.filter((c) => !c.hasAttribute('aria-label') && !c.hasAttribute('aria-labelledby'));
  if (semNome.length === 0) return;
  if (!label.id) label.id = `nx-rot-${++seq}`;
  for (const c of semNome) c.setAttribute('aria-labelledby', label.id);
  (label as HTMLElement).dataset.nxLigado = '1';
  const c = semNome[0];
  label.addEventListener('click', () => { if (document.contains(c)) c.focus(); });
}

export function installFieldLabels(): void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  let pendente = false;
  const varrer = () => { pendente = false; for (const [c, r] of PADROES) document.querySelectorAll(c).forEach((el) => ligar(el, r)); };
  // setTimeout (não requestAnimationFrame, que pára com a janela em segundo plano).
  new MutationObserver(() => { if (!pendente) { pendente = true; setTimeout(varrer, 0); } })
    .observe(document.body, { childList: true, subtree: true });
  varrer();
}
