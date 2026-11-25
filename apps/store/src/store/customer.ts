import { useEffect, useState } from 'react';
import type { CustomerSession } from '../api/types';

/** Sessão do cliente guardada por loja (o token está ligado a um tenant). */
const key = (code: string) => `ndombaxi.store.cust.${code}`;
const EVT = 'ndombaxi:customer';

export function getSession(code: string): CustomerSession | null {
  try {
    const raw = localStorage.getItem(key(code)) ?? sessionStorage.getItem(key(code));
    return raw ? (JSON.parse(raw) as CustomerSession) : null;
  } catch {
    return null;
  }
}

/** `remember` ("Lembrar-me"): guarda a sessão no aparelho; desmarcado, acaba ao fechar. */
export function setSession(code: string, session: CustomerSession, remember = true): void {
  try {
    if (remember) { localStorage.setItem(key(code), JSON.stringify(session)); sessionStorage.removeItem(key(code)); }
    else { sessionStorage.setItem(key(code), JSON.stringify(session)); localStorage.removeItem(key(code)); }
  } catch { /* sem armazenamento */ }
  window.dispatchEvent(new Event(EVT));
}

export function clearSession(code: string): void {
  try { localStorage.removeItem(key(code)); sessionStorage.removeItem(key(code)); } catch { /* sem armazenamento */ }
  window.dispatchEvent(new Event(EVT));
}

/** Hook reativo: re-renderiza quando a sessão do cliente muda. */
export function useCustomer(code: string): CustomerSession | null {
  const [session, setS] = useState<CustomerSession | null>(() => getSession(code));
  useEffect(() => {
    const handler = () => setS(getSession(code));
    handler();
    window.addEventListener(EVT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(EVT, handler);
      window.removeEventListener('storage', handler);
    };
  }, [code]);
  return session;
}

/** Contas rápidas sem email usam um endereço interno (@sem-email.lps) — nunca se mostra. */
export function shownEmail(e?: string | null): string {
  return e && !e.toLowerCase().endsWith('@sem-email.lps') ? e : '';
}
