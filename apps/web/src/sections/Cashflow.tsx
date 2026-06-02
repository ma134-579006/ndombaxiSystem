import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CashflowForecast, CashflowPoint, CashflowSummary } from '../api/types';
import { AreaChart, type AreaPoint } from '../components/AreaChart';
import { IconCard, IconChart, IconRefresh } from '../components/Icons';
import { formatKz } from '../format';

function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function ddmm(s: string): string { const d = new Date(s); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; }

/** Fluxo de caixa do gestor: entradas vs saídas, saldo do período, gráfico e
 *  previsão para os próximos 30 dias. Filtro por datas e impressão. */
export function Cashflow() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [sum, setSum] = useState<CashflowSummary | null>(null);
  const [series, setSeries] = useState<CashflowPoint[]>([]);
  const [fc, setFc] = useState<CashflowForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, ser, f] = await Promise.all([
        api.cashflow.summary(from, to),
        api.cashflow.series(from, to),
        api.cashflow.forecast(),
      ]);
      setSum(s); setSeries(ser); setFc(f); setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar o fluxo de caixa.');
    } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => {
    void load();
    timer.current = window.setInterval(() => void load(), 30_000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [load]);

  const setPreset = (days: number) => {
    setFrom(iso(new Date(Date.now() - (days - 1) * 86400000)));
    setTo(iso(new Date()));
  };

  const chartPoints: AreaPoint[] = series.map((p) => ({ label: ddmm(p.day), value: p.inflow, sub: p.outflow }));

  return (
    <div className="profit-page">
      <div className="content-head no-print">
        <h2>Fluxo de caixa</h2>
        <span className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
          <span className="live-dot" /> Ao vivo{updatedAt ? ` · ${updatedAt.toLocaleTimeString('pt-PT')}` : ''}
        </span>
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

      <div className="print-only print-header"><h2>Fluxo de Caixa</h2>
        <p>Período: {new Date(from).toLocaleDateString('pt-PT')} a {new Date(to).toLocaleDateString('pt-PT')}</p></div>

      {/* KPIs */}
      <div className="kpi-grid">
        <Kpi tone="success" label="Entradas" value={formatKz(sum?.inflows ?? 0)} sub={`Vendas líq. ${formatKz(sum?.immediateSales ?? 0)} + cobrança ${formatKz(sum?.debtCollected ?? 0)}`} />
        <Kpi tone="danger" label="Saídas" value={formatKz(sum?.outflows ?? 0)} sub="gastos/despesas do período" />
        <Kpi tone={(sum?.net ?? 0) >= 0 ? 'primary' : 'danger'} label="Saldo do período" value={formatKz(sum?.net ?? 0)} sub="entradas − saídas" />
        <Kpi tone={(fc?.projectedNet30 ?? 0) >= 0 ? 'violet' : 'danger'} label="Previsão 30 dias" value={formatKz(fc?.projectedNet30 ?? 0)} sub={`+ a receber ${formatKz(fc?.receivablesDueSoon ?? 0)}`} />
      </div>

      {/* Gráfico entradas vs saídas */}
      <div className="card">
        <div className="row" style={{ alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Entradas vs saídas</h3>
          <span className="spacer" />
          <div className="legend-row" style={{ margin: 0 }}>
            <span><span className="dot" style={{ background: 'var(--success)' }} /> Entradas</span>
            <span><span className="dot" style={{ background: 'var(--danger)' }} /> Saídas</span>
          </div>
        </div>
        {loading && series.length === 0 ? <div className="loading">A carregar…</div>
          : <AreaChart points={chartPoints} color="var(--success)" subColor="var(--danger)" format={formatKz} />}
      </div>

      <div className="cols-2">
        {/* Composição do período */}
        <div className="card">
          <h3>Composição do período</h3>
          <table className="ptable">
            <tbody>
              <tr><td>Vendas (c/ IVA)</td><td>{formatKz(sum?.salesTotal ?? 0)}</td></tr>
              <tr><td>− Vendas a crédito (não entraram)</td><td>{formatKz(-(sum?.creditCreated ?? 0))}</td></tr>
              <tr><td>= Vendas liquidadas</td><td>{formatKz(sum?.immediateSales ?? 0)}</td></tr>
              <tr><td>+ Cobrança de dívidas</td><td>{formatKz(sum?.debtCollected ?? 0)}</td></tr>
              <tr><td style={{ fontWeight: 700 }}>= Entradas</td><td style={{ fontWeight: 700, color: 'var(--success)' }}>{formatKz(sum?.inflows ?? 0)}</td></tr>
              <tr><td>− Saídas (gastos)</td><td>{formatKz(-(sum?.outflows ?? 0))}</td></tr>
            </tbody>
            <tfoot>
              <tr><td style={{ fontWeight: 800 }}>Saldo</td><td style={{ fontWeight: 800, color: (sum?.net ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatKz(sum?.net ?? 0)}</td></tr>
            </tfoot>
          </table>
        </div>

        {/* Previsão 30 dias */}
        <div className="card">
          <h3>Previsão — próximos 30 dias</h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Baseada na média diária dos últimos {fc?.basisDays ?? 30} dias e nas dívidas a vencer.</p>
          <table className="ptable">
            <tbody>
              <tr><td>Entrada média/dia</td><td>{formatKz(fc?.avgDailyInflow ?? 0)}</td></tr>
              <tr><td>Saída média/dia</td><td>{formatKz(fc?.avgDailyOutflow ?? 0)}</td></tr>
              <tr><td>Entradas projectadas (×30)</td><td style={{ color: 'var(--success)' }}>{formatKz(fc?.projectedInflow30 ?? 0)}</td></tr>
              <tr><td>+ Contas a receber a vencer</td><td style={{ color: 'var(--success)' }}>{formatKz(fc?.receivablesDueSoon ?? 0)}</td></tr>
              <tr><td>− Saídas projectadas (×30)</td><td style={{ color: 'var(--danger)' }}>{formatKz(-(fc?.projectedOutflow30 ?? 0))}</td></tr>
            </tbody>
            <tfoot>
              <tr><td style={{ fontWeight: 800 }}>Saldo previsto</td><td style={{ fontWeight: 800, color: (fc?.projectedNet30 ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatKz(fc?.projectedNet30 ?? 0)}</td></tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ tone, label, value, sub }: { tone: string; label: string; value: string; sub: string }) {
  return (
    <div className={`kpi-card ${tone}`}>
      <div className="kpi-ic">{tone === 'success' || tone === 'violet' ? <IconChart size={20} /> : <IconCard size={20} />}</div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ fontSize: 22 }}>{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}
