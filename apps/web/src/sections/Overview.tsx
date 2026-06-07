import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type {
  DashLowStock,
  DashSalesSeries,
  DashStoreSales,
  DashTopProduct,
  OpsAlert,
  ProfitSummary,
  SalesRange,
} from '../api/types';
import { AreaChart, type AreaPoint } from '../components/AreaChart';
import { IconBuilding, IconCard, IconChart, IconCube, IconReceipt, IconRefresh, IconStar } from '../components/Icons';
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
const DAYS: Record<string, number> = { '7d': 7, '1m': 30, '3m': 90, '6m': 180, '1y': 365 };

function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function rangeToDates(r: SalesRange): { from: string; to: string } {
  const today = new Date();
  if (r === 'today') return { from: iso(today), to: iso(today) };
  if (r === 'yesterday') { const y = new Date(Date.now() - 86400000); return { from: iso(y), to: iso(y) }; }
  const d = DAYS[r] ?? 7;
  return { from: iso(new Date(Date.now() - (d - 1) * 86400000)), to: iso(today) };
}
function bucketLabel(isoStr: string, gran: DashSalesSeries['granularity']): string {
  const d = new Date(isoStr);
  if (gran === 'hour') return `${String(d.getHours()).padStart(2, '0')}h`;
  if (gran === 'month') return d.toLocaleDateString('pt-PT', { month: 'short' });
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Visão geral do gestor: cockpit em tempo real, guiado por intervalo
 *  (hoje, ontem, 7d, 1m, 3m, 6m, 1 ano) — vendas, cancelamentos, lucro e gastos,
 *  gráfico moderno, top produtos, stock baixo e alertas. */
export function Overview() {
  const [range, setRange] = useState<SalesRange>('7d');
  const [sum, setSum] = useState<ProfitSummary | null>(null);
  const [series, setSeries] = useState<DashSalesSeries | null>(null);
  const [top, setTop] = useState<DashTopProduct[]>([]);
  const [low, setLow] = useState<DashLowStock[]>([]);
  const [byStore, setByStore] = useState<DashStoreSales[]>([]);
  const [alerts, setAlerts] = useState<OpsAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { from, to } = rangeToDates(range);
    try {
      const [s, ser, t, l, a, bs] = await Promise.all([
        api.profit.summary(from, to),
        api.dashboard.series(range),
        api.dashboard.topProducts(8),
        api.dashboard.lowStock(),
        api.alerts(),
        api.dashboard.salesByStore().catch(() => [] as DashStoreSales[]),
      ]);
      setSum(s); setSeries(ser); setTop(t); setLow(l); setAlerts(a); setByStore(bs);
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

  const chartPoints: AreaPoint[] = (series?.points ?? []).map((p) => ({
    label: bucketLabel(p.bucket, series!.granularity),
    value: p.grossTotal,
    sub: p.cancelledTotal,
  }));
  const hasCancel = (series?.points ?? []).some((p) => p.cancelledTotal > 0);
  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? '';

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

      {/* Selector de intervalo */}
      <div className="card" style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {RANGES.map((r) => (
            <button key={r.key} className={`chip ${range === r.key ? 'active' : ''}`} onClick={() => setRange(r.key)}>{r.label}</button>
          ))}
        </div>
      </div>

      {error ? <div className="banner danger">{error}</div> : null}

      {/* KPIs do intervalo */}
      <div className="kpi-grid">
        <KpiCard tone="primary" icon={<IconCard size={20} />} label={`Vendas · ${rangeLabel}`}
          value={formatKz(sum?.salesGross ?? 0)} sub={`${sum?.salesCount ?? 0} venda(s) · média ${formatKz(sum?.ticketAvg ?? 0)}`} />
        <KpiCard tone="danger" icon={<IconReceipt size={20} />} label="Cancelamentos"
          value={formatKz(sum?.cancelledAmount ?? 0)} sub={`${sum?.cancelledCount ?? 0} venda(s) anulada(s)`} />
        <KpiCard tone="success" icon={<IconChart size={20} />} label="Lucro líquido"
          value={formatKz(sum?.netProfit ?? 0)} sub={`Bruto ${formatKz(sum?.grossProfit ?? 0)} · margem ${sum?.marginPct ?? 0}%`} />
        <KpiCard tone="warning" icon={<IconStar size={20} />} label="Gastos / Despesas"
          value={formatKz(sum?.otherExpenses ?? 0)} sub="saídas registadas no período" />
      </div>

      {/* Gráfico de vendas (+ anulados) */}
      <div className="card">
        <div className="row" style={{ alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Evolução de vendas</h3>
          <span className="spacer" />
          <div className="legend-row" style={{ margin: 0 }}>
            <span><span className="dot" style={{ background: 'var(--primary)' }} /> Vendas</span>
            {hasCancel ? <span><span className="dot" style={{ background: 'var(--danger)' }} /> Anulado</span> : null}
          </div>
        </div>
        {loading && !series ? <div className="loading">A carregar…</div> : (
          <AreaChart points={chartPoints} color="var(--primary)" subColor={hasCancel ? 'var(--danger)' : undefined} format={formatKz} />
        )}
      </div>

      {/* Vendas de HOJE por loja (multi-loja, tempo real) */}
      {byStore.length > 1 ? (
        <div className="card">
          <div className="row" style={{ alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Lojas hoje (ao vivo)</h3>
            <span className="spacer" />
            <span className="muted" style={{ fontSize: 12 }}>
              Total {formatKz(byStore.reduce((t, s) => t + s.grossTotal, 0))}
            </span>
          </div>
          <div className="kpi-grid" style={{ marginTop: 10 }}>
            {byStore.map((s) => (
              <div className={`kpi-card ${s.isDefault ? 'primary' : ''}`} key={s.storeId}>
                <div className="kpi-ic"><IconBuilding size={20} /></div>
                <div className="kpi-label">{s.storeName}{s.isDefault ? ' · principal' : ''}</div>
                <div className="kpi-value" style={{ fontSize: 22 }}>{formatKz(s.grossTotal)}</div>
                <div className="kpi-sub">{s.invoiceCount} venda(s) hoje</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

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
