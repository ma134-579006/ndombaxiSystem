import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

/** "Renovar subscrição" + anel do período gasto, como no backoffice de
 *  referência: só o texto e o anel; os dias que faltam aparecem numa dica
 *  animada ao passar o rato (ou ao focar). Cores do Vendus: azul até 74%,
 *  laranja 75–89%, vermelho a partir de 90%. */
export function SubscriptionRing() {
  const [info, setInfo] = useState<{ total: number; used: number; left: number; pct: number; renewUrl?: string; plan?: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.subscriptionStatus()
      .then((st) => { if (!alive) return; if (!st.active) { setInfo(null); return; } const total = st.totalDays ?? Math.max(1, st.daysLeft); setInfo({ total, used: st.usedDays ?? total - st.daysLeft, left: st.daysLeft, pct: st.pct, ...(st.provider === 'VENDUS' ? { renewUrl: st.renewUrl, plan: st.plan } : {}) }); })
      .catch(() => undefined);
    void load();
    const t = window.setInterval(load, 30 * 60 * 1000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  if (!info) return null;
  const tone = info.pct < 75 ? 'ok' : info.pct < 90 ? 'warn' : 'bad';
  const tip0 = info.left === 0 ? 'A subscrição termina hoje' : info.left === 1 ? 'Falta 1 dia para renovar' : `Faltam ${info.left} dias para renovar`;
  // Motor Cegid Vendus: a subscrição mostrada é a do Vendus e o toque abre a renovação lá.
  const tip = info.renewUrl ? `Cegid Vendus${info.plan ? ` · Plano ${info.plan}` : ''} · ${tip0}` : tip0;
  return (
    <span className={`vsub ${tone}`} tabIndex={0} aria-label={tip} role={info.renewUrl ? 'link' : undefined}
      style={info.renewUrl ? { cursor: 'pointer' } : undefined}
      onClick={info.renewUrl ? () => window.open(info.renewUrl, '_blank', 'noopener') : undefined}
      onKeyDown={info.renewUrl ? (e) => { if (e.key === 'Enter') window.open(info.renewUrl, '_blank', 'noopener'); } : undefined}>
      <span className="vsub-tip" role="tooltip">{tip}</span>
      <span className="vsub-tx">Renovar subscrição</span>
      <span className="vsub-ring" aria-hidden="true" style={{ ['--vs-p' as string]: Math.min(100, Math.max(0, info.pct)) } as React.CSSProperties}>
        <b>{info.pct}<small>%</small></b>
      </span>
    </span>
  );
}
