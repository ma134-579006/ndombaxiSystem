import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CommissionReport } from '../api/types';
import { IconChart, IconRefresh } from '../components/Icons';
import { formatKz } from '../format';

function iso(d: Date): string { return d.toISOString().slice(0, 10); }

/** Comissões de vendedores: vendas por operador no período × % configurável. */
export function Commissions() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [rep, setRep] = useState<CommissionReport | null>(null);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.commissions.report(from, to);
      setRep(r);
      setRates(Object.fromEntries(r.rows.map((x) => [x.userId, String(x.rate)])));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar comissões.');
    } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const setPreset = (days: number) => {
    setFrom(iso(new Date(Date.now() - (days - 1) * 86400000)));
    setTo(iso(new Date()));
  };

  const saveRate = async (userId: string, current: number) => {
    const v = Number(rates[userId]);
    if (!Number.isFinite(v) || v < 0 || v > 100 || v === current) return;
    setSavingId(userId);
    try {
      await api.commissions.setRate(userId, v);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível guardar a percentagem.');
    } finally { setSavingId(null); }
  };

  return (
    <div className="profit-page">
      <div className="content-head no-print">
        <h2>Comissões de vendedores</h2>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => void load()}><IconRefresh size={15} /> Atualizar</button>
        <button className="btn sm" onClick={() => window.print()}>🖨 Imprimir</button>
      </div>

      <div className="card no-print">
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0 }}><label>Data inicial</label>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="field" style={{ margin: 0 }}><label>Data final</label>
            <input type="date" value={to} min={from} max={iso(new Date())} onChange={(e) => setTo(e.target.value)} /></div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="chip" onClick={() => setPreset(7)}>7 dias</button>
            <button className="chip" onClick={() => setPreset(30)}>30 dias</button>
            <button className="chip" onClick={() => setPreset(90)}>90 dias</button>
          </div>
        </div>
      </div>

      {error ? <div className="banner danger no-print">{error}</div> : null}

      <div className="print-only print-header"><h2>Comissões</h2>
        <p>Período: {new Date(from).toLocaleDateString('pt-PT')} a {new Date(to).toLocaleDateString('pt-PT')}</p></div>

      <div className="kpi-grid">
        <div className="kpi-card primary"><div className="kpi-ic"><IconChart size={20} /></div>
          <div className="kpi-label">Vendas (período)</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{formatKz(rep?.totalSales ?? 0)}</div>
          <div className="kpi-sub">{rep?.rows.length ?? 0} vendedor(es)</div>
        </div>
        <div className="kpi-card success"><div className="kpi-ic"><IconChart size={20} /></div>
          <div className="kpi-label">Total de comissões</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{formatKz(rep?.totalCommission ?? 0)}</div>
          <div className="kpi-sub">a pagar no período</div>
        </div>
      </div>

      <div className="card">
        <h3>Por vendedor</h3>
        {loading ? <div className="loading">A carregar…</div>
          : (rep?.rows.length ?? 0) === 0 ? <p className="muted">Sem vendas com vendedor no período.</p> : (
            <table className="ptable stack">
              <thead>
                <tr><th>Vendedor</th><th>Vendas</th><th>Nº</th><th>% comissão</th><th>Comissão</th></tr>
              </thead>
              <tbody>
                {rep!.rows.map((r) => (
                  <tr key={r.userId}>
                    <td data-label="Vendedor">{r.name}</td>
                    <td data-label="Vendas">{formatKz(r.sales)}</td>
                    <td data-label="Nº">{r.salesCount}</td>
                    <td data-label="% comissão" className="no-print" style={{ width: 110 }}>
                      <input
                        style={{ width: 70, textAlign: 'right' }}
                        value={rates[r.userId] ?? String(r.rate)}
                        inputMode="decimal"
                        disabled={savingId === r.userId}
                        onChange={(e) => setRates((m) => ({ ...m, [r.userId]: e.target.value }))}
                        onBlur={() => saveRate(r.userId, r.rate)}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      /> %
                    </td>
                    <td data-label="% comissão" className="print-only">{r.rate}%</td>
                    <td data-label="Comissão" style={{ fontWeight: 700, color: 'var(--success)' }}>{formatKz(r.commission)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td>Total</td><td>{formatKz(rep!.totalSales)}</td><td /><td className="no-print" /><td style={{ fontWeight: 800 }}>{formatKz(rep!.totalCommission)}</td></tr>
              </tfoot>
            </table>
          )}
        <p className="muted" style={{ fontSize: 12 }}>Escreva a % e prima Enter (ou saia do campo) para guardar. Comissão = vendas × % no período.</p>
      </div>
    </div>
  );
}
