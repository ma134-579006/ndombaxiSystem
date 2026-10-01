import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { PharmacyBatch } from '../api/types';

const fmtDate = (s: string) => { try { return new Date(s + 'T00:00:00').toLocaleDateString('pt-PT'); } catch { return s; } };

/** Farmácia — controlo de validade: medicamentos a expirar e expirados (lotes). */
export function Pharmacy() {
  const [kpi, setKpi] = useState<{ expiring: number; expired: number; prescription: number; lowStock: number } | null>(null);
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<PharmacyBatch[]>([]);

  const load = useCallback(async () => {
    try { setRows(await api.pharmacy.expiring(days)); } catch { /* */ }
  }, [days]);
  useEffect(() => { api.pharmacy.metrics().then(setKpi).catch(() => undefined); }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <div className="content-head"><h2>Farmácia — validade & lotes</h2></div>

      {kpi ? (
        <div className="kpi-grid ph-kpis">
          {[
            { label: 'A expirar (≤30 dias)', value: kpi.expiring, tone: 'warn', hint: 'lotes a vencer' },
            { label: 'Expirados', value: kpi.expired, tone: kpi.expired ? 'bad' : '', hint: 'retirar da venda' },
            { label: 'Exigem receita', value: kpi.prescription, tone: 'info', hint: 'dispensa controlada' },
            { label: 'Stock baixo', value: kpi.lowStock, tone: kpi.lowStock ? 'warn' : '', hint: 'repor em breve' },
          ].map((k) => (
            <div key={k.label} className={`ui-tile ${k.tone}`}>
              <div className="ui-tile-l">{k.label}</div>
              <div className="ui-tile-v">{k.value}</div>
              <div className="ui-tile-h">{k.hint}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="card toolbar-sticky" style={{ display: 'flex', gap: 6, padding: '8px 10px', alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 13 }}>Mostrar a expirar em:</span>
        {[15, 30, 60, 90].map((d) => (
          <button key={d} className={`chip${days === d ? ' active' : ''}`} onClick={() => setDays(d)}>{d} dias</button>
        ))}
      </div>

      {rows.length === 0 ? <div className="card empty" style={{ padding: 24 }}><p>Sem lotes a expirar neste período.</p></div> : (
        <div className="ph-list">
          {rows.map((b) => {
            const expired = b.days_left < 0;
            const soon = b.days_left >= 0 && b.days_left <= 7;
            const lvl = expired ? 'bad' : soon ? 'warn' : 'ok';
            const pct = expired ? 100 : Math.max(6, Math.min(100, 100 - (b.days_left / Math.max(days, 1)) * 100));
            return (
              <div key={b.id} className={`ph-row ${lvl}`}>
                <div className="ph-main">
                  <strong>{b.product_name}</strong>
                  <div className="muted">
                    {b.product_code}{b.active_ingredient ? ` · ${b.active_ingredient}` : ''}{b.batch_code ? ` · lote ${b.batch_code}` : ''}
                  </div>
                  <div className="ph-bar"><i style={{ width: `${pct}%` }} /></div>
                </div>
                <div className="ph-qty"><b>{Number(b.quantity)}</b><span>un.</span></div>
                <div className="ph-exp">
                  <span className="ph-badge">{expired ? 'Expirado' : b.days_left === 0 ? 'Expira hoje' : `${b.days_left} dia(s)`}</span>
                  <small>{fmtDate(b.expiry_date)}</small>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
