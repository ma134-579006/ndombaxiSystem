/**
 * Atualização periódica que PARA quando o separador/app está em 2.º plano.
 *
 * Cada página atualiza os seus dados de X em X segundos. Sem esta pausa, cada
 * separador esquecido aberto continuava a bater na API — com vários separadores e
 * vários utilizadores, o servidor ficava ocupado a responder a ecrãs que ninguém
 * vê e o sistema inteiro ficava lento. Ao voltar ao separador, atualiza logo.
 */
export function pollEvery(fn: () => unknown, ms: number): number {
  let missed = false;
  const run = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { missed = true; return; }
    missed = false;
    void fn();
  };
  const onVisible = () => { if (document.visibilityState === 'visible' && missed) run(); };
  document.addEventListener('visibilitychange', onVisible);
  const id = window.setInterval(run, ms);
  cleanups.set(id, () => document.removeEventListener('visibilitychange', onVisible));
  return id;
}

const cleanups = new Map<number, () => void>();

/** Par de `pollEvery` (também aceita ids de setInterval normais). */
export function stopPoll(id: number | null | undefined): void {
  if (id == null) return;
  window.clearInterval(id);
  cleanups.get(id)?.();
  cleanups.delete(id);
}
