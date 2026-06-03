import { useEffect, useState } from 'react';
import type { CustomerSession } from '../api/types';

/** Sessão do cliente guardada por loja (o token está ligado a um tenant). */
const key = (code: string) => `ndombaxi.store.cust.${code}`;
const EVT = 'ndombaxi:customer';

export function getSession(code: string): CustomerSession | null {
  try {
    const raw = localStorage.getItem(key(code));
    return raw ? (JSON.parse(raw) as CustomerSession) : null;
  } catch {
    return null;
  }
}

export function setSession(code: string, session: CustomerSession): void {
  localStorage.setItem(key(code), JSON.stringify(session));
  window.dispatchEvent(new Event(EVT));
}

export function clearSession(code: string): void {
  localStorage.removeItem(key(code));
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
