import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type {
  DashLowStock,
  DashSalesSeries,
  DashSalesSummary,
  DashTopProduct,
  ExpenseSummary,
  OpsAlert,
  ProfitSummary,
  SalesRange,
} from '../api/types';
import { IconCard, IconChart, IconCube, IconReceipt, IconRefresh, IconStar } from '../components/Icons';
import { formatKz } from '../format';

const RANGES: { key: SalesRange; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: 'yesterday', label: 'Ontem' },
  { key: '7d', label: '7 dias' },
  { key: '1m', label: '1 mês' },
  { key: '3m', label: '3 meses' },
  { key: '6m', label: '6 meses' },
  { key: '1y', label: '1 ano' },
];

function todayISO(d = new Date()): string { return d.toISOString().slice(0, 10); }
function monthStartISO(): string { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }

function bucketLabel(iso: string, gran: DashSalesSeries['granularity']): string {
  const d = new Date(iso);
  if (gran === 'hour') return `${String(d.getHours()).padStart(2, '0')}h`;
  if (gran === 'month') return d.toLocaleDateString('pt-PT', { month: 'short' });
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Visão geral do gestor: cockpit em tempo real (vendas, lucro, despesas,
 *  gráfico por intervalo, top produtos, stock baixo e alertas). */
export function Overview() {
  const [range, setRange] = useState<SalesRange>('7d');
  const [today, setToday] = useState<DashSalesSummary | null>(null);
  const [profit, setProfit] = useState<ProfitSummary | null>(null);
  const [expMonth, setExpMonth] = useState<ExpenseSummary | null>(null);
  const [series, setSeries] = useState<DashSalesSeries | null>(null);
  const [top, setTop] = useState<DashTopProduct[]>([]);
  const [low, setLow] = useState<DashLowStock[]>([]);
  const [alerts, setAlerts] = useState<OpsAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const t = todayISO();
    try {
      const [sToday, sProfit, sExp, sSeries, sTop, sLow, sAlerts] = await Promise.all([
        api.dashboard.salesToday(),
        api.profit.summary(t, t),
        api.expenses.summary(monthStartISO(), t),
        api.dashboard.series(range),
        api.dashboard.topProducts(8),
        api.dashboard.lowStock(),
        api.alerts(),
      ]);
      setToday(sToday); setProfit(sProfit); setExpMonth(sExp);
      setSeries(sSeries); setTop(sTop); setLow(sLow); setAlerts(sAlerts);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar a visão geral.');
    } finally { setLoading(false); }
  }, [range]);

  useEffect(() => {
    void load();
    timer.current = window.setInterval(() => void load(), 20_000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [load]);

  const points = series?.points ?? [];
  const maxBar = Math.max(1, ...points.map((p) => p.grossTotal));

  return (
    <div className="profit-page">
      <div className="content-head">
        <h2>Visão geral</h2>
        <span className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
          <span className="live-dot" /> Ao vivo{updatedAt ? ` · ${updatedAt.toLocaleTimeString('pt-PT')}` : ''}
        </span>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => void load()}><IconRefresh size={15} /> Atualizar</button>
      </div>

      {error ? <div className="banner danger">{error}</div> : null}

      {/* KPIs principais */}
      <div className="kpi-grid">
        <KpiCard tone="primary" icon={<IconCard size={20} />} label="Vendas hoje"
          value={formatKz(today?.grossTotal ?? 0)} sub={`${today?.invoiceCount ?? 0} venda(s)`} />
        <KpiCard tone="success" icon={<IconChart size={20} />} label="Lucro bruto hoje"
          value={formatKz(profit?.grossProfit ?? 0)} sub={`Margem ${profit?.marginPct ?? 0}%`} />
        <KpiCard tone="danger" icon={<IconReceipt size={20} />} label="Despesas (mês)"
          value={formatKz(expMonth?.total ?? 0)} sub="desde o início do mês" />
        <KpiCard tone="violet" icon={<IconStar size={20} />} label="Ticket médio hoje"
          value={formatKz(today?.averageTicket ?? 0)} sub="por venda" />
      </div>

      {/* Gráfico de vendas por intervalo */}
      <div className="card">
        <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Vendas</h3>
          <span className="spacer" />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {RANGES.map((r) => (
              <button key={r.key} className={`chip ${range === r.key ? 'active' : ''}`} onClick={() => setRange(r.key)}>{r.label}</button>
            ))}
          </div>
        </div>
        <div className="muted" style={{ fontSize: 13, margin: '6px 0 4px' }}>
          Total do período: <strong style={{ color: 'var(--text)' }}>{formatKz(series?.summary.grossTotal ?? 0)}</strong>
          {' · '}{series?.summary.invoiceCount ?? 0} venda(s)
        </div>
        {loading && !series ? <div className="loading">A carregar…</div>
          : points.length === 0 ? <p className="muted">Sem vendas neste período.</p> : (
            <div className="bar-chart">
              {points.map((p) => (
                <div className="bar-col" key={p.bucket} title={`${bucketLabel(p.bucket, series!.granularity)}\n${formatKz(p.grossTotal)}\n${p.invoiceCount} venda(s)`}>
                  <div className="bar-stack" style={{ height: `${(p.grossTotal / maxBar) * 100}%` }}>
                    <div className="bar-seg comp" style={{ height: '100%' }} />
                  </div>
                  <span className="bar-x">{bucketLabel(p.bucket, series!.granularity)}</span>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* Top produtos + Stock baixo */}
      <div className="cols-2">
        <div className="card">
          <h3>Produtos mais vendidos</h3>
          {top.length === 0 ? <p className="muted">Ainda sem vendas.</p> : (
            <table className="ptable">
              <thead><tr><th>Produto</th><th>Qt</th><th>Total</th></tr></thead>
              <tbody>
                {top.map((p) => (
                  <tr key={p.productCode}><td>{p.description}</td><td>{p.quantity}</td><td>{formatKz(p.grossTotal)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3>Stock baixo {low.length > 0 ? <span className="pill off">{low.length}</span> : null}</h3>
          {low.length === 0 ? <p className="muted">Tudo acima do mínimo ✓</p> : (
            <div className="minilist">
              {low.slice(0, 12).map((s) => (
                <div className="minirow l-warning" key={`${s.productCode}-${s.warehouseCode}`}>
                  <IconCube size={18} />
                  <div className="mr-main">
                    <div className="mr-title">{s.productName}</div>
                    <div className="mr-sub">{s.productCode} · {s.warehouseCode}</div>
                  </div>
                  <div className="mr-val" style={{ color: s.quantity <= 0 ? 'var(--danger)' : 'var(--warning)' }}>
                    {s.quantity} / mín {s.minQty}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Alertas operacionais */}
      <div className="card">
        <h3>Alertas operacionais</h3>
        {alerts.length === 0 ? <p className="muted">Sem alertas. Tudo em ordem ✓</p> : (
          <div className="minilist">
            {alerts.map((a, i) => (
              <div className={`minirow l-${a.level}`} key={i}>
                <div className="mr-main">
                  <div className="mr-title">{a.title}</div>
                  <div className="mr-sub">{a.detail}</div>
                </div>
                <span className={`pill ${a.level === 'danger' ? 'off' : 'on'}`}>{a.category}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({ tone, icon, label, value, sub }: { tone: string; icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className={`kpi-card ${tone}`}>
      <div className="kpi-ic">{icon}</div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ fontSize: 22 }}>{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}
