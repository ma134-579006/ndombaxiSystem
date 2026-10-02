import React, { useEffect, useState } from 'react';
import { API_URL } from '../config';


/** Há ligação REAL ao servidor? (navigator.onLine mente nas apps — confirma com /health.) */
export function useNetwork(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { if (alive) setOnline(false); return; }
      try {
        const ctrl = new AbortController();
        const t = window.setTimeout(() => ctrl.abort(), 4500);
        const r = await fetch(`${API_URL}/health`, { signal: ctrl.signal, cache: 'no-store' });
        window.clearTimeout(t);
        if (alive) setOnline(r.ok);
      } catch { if (alive) setOnline(false); }
    };
    void check();
    const id = window.setInterval(check, 15000);
    const on = () => void check();
    window.addEventListener('online', on); window.addEventListener('offline', () => alive && setOnline(false));
    return () => { alive = false; window.clearInterval(id); window.removeEventListener('online', on); };
  }, []);
  return online;
}

/** Aviso das funcionalidades que EXIGEM rede (chat, notificações, assistente…). */
export function NeedsNetwork({ what }: { what: string }) {
  return (
    <div className="nn-card" role="status">
      <span className="nn-ic" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01M3 3l18 18" /></svg>
      </span>
      <h4>Sem ligação à rede</h4>
      <p>{what} precisa de internet. Ligue o aparelho à rede e tente de novo — o resto do sistema continua a funcionar no aparelho.</p>
    </div>
  );
}
