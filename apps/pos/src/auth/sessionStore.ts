/**
 * "Lembrar-me" no login. Por omissão a sessão vive em sessionStorage (morre ao
 * fechar a janela/app). Com "Lembrar-me" marcado, é espelhada em localStorage e
 * sobrevive a fechar e reabrir — até terminar a sessão ou desmarcar a opção.
 */
const FLAG = 'ndx:caixa_remember';
const PFX = 'ndx.pos.rm.';

function remembered(): boolean { try { return localStorage.getItem(FLAG) === '1'; } catch { return false; } }

/** Liga/desliga o "Lembrar-me" (chamado no login, antes de guardar os tokens). */
export function setRememberSession(on: boolean): void {
  try {
    if (on) { localStorage.setItem(FLAG, '1'); return; }
    localStorage.removeItem(FLAG);
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith(PFX)) localStorage.removeItem(k); }
  } catch { /* sem armazenamento */ }
}
export function isRememberSession(): boolean { return remembered(); }

/** Mesmo contrato que sessionStorage (getItem/setItem/removeItem). */
export const sess = {
  getItem(k: string): string | null {
    try { return sessionStorage.getItem(k) ?? (remembered() ? localStorage.getItem(PFX + k) : null); } catch { return null; }
  },
  setItem(k: string, v: string): void {
    try { sessionStorage.setItem(k, v); } catch { /* */ }
    try { if (remembered()) localStorage.setItem(PFX + k, v); } catch { /* */ }
  },
  removeItem(k: string): void {
    try { sessionStorage.removeItem(k); } catch { /* */ }
    try { localStorage.removeItem(PFX + k); } catch { /* */ }
  },
};
