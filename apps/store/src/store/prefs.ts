import { useEffect, useState } from 'react';

/** Favoritos e "vistos recentemente" do cliente, por loja, guardados neste
 *  navegador (conveniência pessoal — não vão para a loja). */
const favKey = (code: string) => `ndombaxi.store.fav.${code}`;
const seenKey = (code: string) => `ndombaxi.store.seen.${code}`;
const EVT = 'ndombaxi:prefs';
const SEEN_MAX = 24;

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function write(key: string, list: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* armazenamento indisponível */ }
  window.dispatchEvent(new Event(EVT));
}

export function toggleFavorite(code: string, productCode: string): boolean {
  const list = read(favKey(code));
  const on = !list.includes(productCode);
  write(favKey(code), on ? [productCode, ...list] : list.filter((c) => c !== productCode));
  return on;
}

export function markSeen(code: string, productCode: string): void {
  const list = read(seenKey(code)).filter((c) => c !== productCode);
  write(seenKey(code), [productCode, ...list].slice(0, SEEN_MAX));
}

export function clearSeen(code: string): void { write(seenKey(code), []); }

/** Hook reativo: favoritos e vistos (códigos de produto, mais recente primeiro). */
export function usePrefs(code: string): { favorites: string[]; seen: string[] } {
  const [st, setSt] = useState(() => ({ favorites: read(favKey(code)), seen: read(seenKey(code)) }));
  useEffect(() => {
    const on = () => setSt({ favorites: read(favKey(code)), seen: read(seenKey(code)) });
    on();
    window.addEventListener(EVT, on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener(EVT, on); window.removeEventListener('storage', on); };
  }, [code]);
  return st;
}
