import { useEffect, useState } from 'react';
import { api } from './api/client';

/**
 * "Permitir vender produtos sem stock" (Configurações → Stock no painel, como no
 * Vendus). Vem da identidade da empresa e fica guardado no aparelho, para a Caixa
 * respeitar a escolha do gestor também SEM REDE.
 */
const KEY = 'lps.sellNoStock';
let cached = ((): boolean => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();
const subs = new Set<(v: boolean) => void>();

export function refreshStockPolicy(): Promise<boolean> {
  return api.documentIdentity()
    .then((d) => {
      const v = d.sellWithoutStock === true;
      cached = v;
      try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* sem armazenamento */ }
      subs.forEach((f) => f(v));
      return v;
    })
    .catch(() => cached);
}

export function sellWithoutStockNow(): boolean { return cached; }

/** A Caixa pode vender sem stock? Atualiza ao abrir, ao voltar à janela e a cada 2 min. */
export function useSellWithoutStock(): boolean {
  const [v, setV] = useState(cached);
  useEffect(() => {
    subs.add(setV);
    void refreshStockPolicy();
    const t = window.setInterval(() => void refreshStockPolicy(), 120_000);
    const onFocus = () => void refreshStockPolicy();
    window.addEventListener('focus', onFocus);
    return () => { subs.delete(setV); window.clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, []);
  return v;
}
