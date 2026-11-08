import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

/** "Renovar subscrição" + % do período gasto (igual à Gestão):
 *  até 60% verde, 61–80% laranja, acima de 80% vermelho. */
export function SubscriptionRing() {
  const [info, setInfo] = useState<{ total: number; used: number; left: number; pct: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.subscriptionStatus()
      .then((st) => { if (!alive) return; if (!st.active) { setInfo(null); return; } const total = st.totalDays ?? Math.max(1, st.daysLeft); setInfo({ total, used: st.usedDays ?? total - st.daysLeft, left: st.daysLeft, pct: st.pct }); })
      .catch(() => undefined);
    void load();
    const t = window.setInterval(load, 30 * 60 * 1000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  if (!info) return null;
  const tone = info.pct <= 60 ? 'ok' : info.pct <= 80 ? 'warn' : 'bad';
  const r = 13, c = 2 * Math.PI * r;
  return (
    <span className={`vsub ${tone}`} title={`${info.total} dias de subscrição · consumidos ${info.used} (${info.pct}%) · faltam ${info.left} (${100 - info.pct}%)`}>
      <span className="vsub-tx">Renovar subscrição<small>{info.used} de {info.total} dias · faltam {info.left}</small></span>
      <span className="vsub-ring" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r={r} className="trk" />
          <circle cx="16" cy="16" r={r} className="val" strokeDasharray={c} strokeDashoffset={c * (1 - info.pct / 100)} />
        </svg>
        <b>{info.pct}%</b>
      </span>
    </span>
  );
}
