import React, { useEffect, useState } from 'react';
import { IconStore } from './Icons';

/** Ecrã de abertura da loja: marca + barra de progresso com % (avança depressa e abranda até a loja responder). */
export function Splash({ label = 'A abrir a loja' }: { label?: string }) {
  const [pct, setPct] = useState(6);
  useEffect(() => {
    const t = setInterval(() => setPct((p) => (p >= 94 ? p : p + Math.max(0.4, (94 - p) * 0.09))), 120);
    return () => clearInterval(t);
  }, []);
  const v = Math.floor(pct);
  return (
    <div className="gate splash" role="status" aria-live="polite">
      <div className="splash-card">
        <div className="splash-logo"><IconStore size={34} /><i className="splash-ring" /></div>
        <div className="splash-label">{label}…</div>
        <div className="splash-track" aria-hidden="true"><div className="splash-fill" style={{ width: `${pct}%` }} /></div>
        <div className="splash-pct">{v}%</div>
      </div>
    </div>
  );
}
