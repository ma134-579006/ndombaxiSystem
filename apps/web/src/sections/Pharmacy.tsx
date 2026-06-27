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
      <div className="content-head"><h2>💊 Farmácia — validade & lotes</h2></div>

      {kpi ? (
        <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
          {[
            { label: 'A expirar (≤30 dias)', value: String(kpi.expiring), tone: 'var(--warning)' },
            { label: 'Expirados', value: String(kpi.expired), tone: 'var(--danger)' },
            { label: 'Exigem receita', value: String(kpi.prescription), tone: 'var(--text)' },
            { label: 'Stock baixo', value: String(kpi.lowStock), tone: kpi.lowStock ? 'var(--warning)' : 'var(--text)' },
          ].map((k) => (
            <div key={k.label} className="card" style={{ padding: '12px 14px' }}>
              <div className="muted" style={{ fontSize: 12.5 }}>{k.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, margin: '2px 0', color: k.tone }}>{k.value}</div>
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

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {rows.length === 0 ? <div className="empty" style={{ padding: 24 }}><p>Sem lotes a expirar neste período. 👍</p></div>
          : rows.map((b) => {
            const expired = b.days_left < 0;
            const soon = b.days_left >= 0 && b.days_left <= 7;
            const tone = expired ? 'var(--danger)' : soon ? 'var(--warning)' : 'var(--muted)';
            return (
              <div key={b.id} className="list-row" style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', borderLeft: `4px solid ${tone}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 13.5 }}>{b.product_name}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {b.product_code}{b.active_ingredient ? ` · ${b.active_ingredient}` : ''}{b.batch_code ? ` · lote ${b.batch_code}` : ''} · {Number(b.quantity)} un.
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: tone }}>{expired ? `Expirou ${fmtDate(b.expiry_date)}` : `${b.days_left} dia(s)`}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>{fmtDate(b.expiry_date)}</div>
                </div>
              </div>
            );
          })}
      </div>
    </>
  );
}
