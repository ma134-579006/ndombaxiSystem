import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

/** "Renovar subscrição" + % do período gasto (igual à Gestão):
 *  até 60% verde, 61–80% laranja, acima de 80% vermelho. */
export function SubscriptionRing() {
  const [info, setInfo] = useState<{ left: number; pct: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.subscriptionStatus()
      .then((st) => { if (alive) setInfo(st.active ? { left: st.daysLeft, pct: st.pct } : null); })
      .catch(() => undefined);
    void load();
    const t = window.setInterval(load, 30 * 60 * 1000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  if (!info) return null;
  const tone = info.pct <= 60 ? 'ok' : info.pct <= 80 ? 'warn' : 'bad';
  const r = 13, c = 2 * Math.PI * r;
  return (
    <span className={`vsub ${tone}`} title={`${info.left} dia(s) até ao fim da subscrição`}>
      <span className="vsub-tx">Renovar subscrição</span>
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
