import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type {
  DashLowStock,
  DashSalesSeries,
  DashStoreSales,
  DashTopProduct,
  ManagerStore,
  OpsAlert,
  ProfitSummary,
  SalesRange,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
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
  const { user } = useAuth();
  // Só o ADMIN DA EMPRESA (gestor principal) vê todas as lojas e o seletor.
  const isAdmin = user?.role === 'COMPANY_ADMIN';
  const [stores, setStores] = useState<ManagerStore[]>([]);
  const [storeId, setStoreId] = useState('');
  const sid = storeId || undefined;
  const [range, setRange] = useState<SalesRange>('7d');
  const [sum, setSum] = useState<ProfitSummary | null>(null);
  const [series, setSeries] = useState<DashSalesSeries | null>(null);
  const [top, setTop] = useState<DashTopProduct[]>([]);
  const [low, setLow] = useState<DashLowStock[]>([]);
  const [byStore, setByStore] = useState<DashStoreSales[]>([]);
  const [storeDays, setStoreDays] = useState(1); // 1=hoje, 7, 30
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
        api.profit.summary(from, to, sid),
        api.dashboard.series(range, sid),
        api.dashboard.topProducts(8, sid),
        api.dashboard.lowStock(sid),
        api.alerts(),
        api.dashboard.salesByStore(storeDays).catch(() => [] as DashStoreSales[]),
      ]);
      setSum(s); setSeries(ser); setTop(t); setLow(l); setAlerts(a); setByStore(bs);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar a visão geral.');
    } finally { setLoading(false); }
  }, [range, sid, storeDays]);

  useEffect(() => { if (isAdmin) api.staff.listStores().then(setStores).catch(() => undefined); }, [isAdmin]);

  useEffect(() => {
    void load();
    timer.current = window.setInterval(() => void load(), 20_000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [load]);

  const chartPoints: AreaPoint[] = (series?.points ?? []).map((p) => ({
    label: bucketLabel(p.bucket, series!.granularity),
    value: p.grossTotal,
    sub: p.cancelledTotal,
    sub2: p.expenseTotal ?? 0,
  }));
  const hasCancel = (series?.points ?? []).some((p) => p.cancelledTotal > 0);
  const hasExpense = (series?.points ?? []).some((p) => (p.expenseTotal ?? 0) > 0);
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

      {/* Selector de intervalo (+ loja, para o admin que vê todas) */}
      <div className="card" style={{ padding: '10px 14px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {RANGES.map((r) => (
            <button key={r.key} className={`chip ${range === r.key ? 'active' : ''}`} onClick={() => setRange(r.key)}>{r.label}</button>
          ))}
        </div>
        {isAdmin && stores.length > 1 ? (
          <>
            <span className="spacer" />
            <select className="seg-select" value={storeId} onChange={(e) => setStoreId(e.target.value)}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px', color: 'var(--text)' }}>
              <option value="">Todas as lojas</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </>
        ) : null}
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
            {hasExpense ? <span><span className="dot" style={{ background: 'var(--warning)' }} /> Gastos</span> : null}
          </div>
        </div>
        {loading && !series ? <div className="loading">A carregar…</div> : (
          <AreaChart points={chartPoints} color="var(--primary)"
            subColor={hasCancel ? 'var(--danger)' : undefined}
            sub2Color={hasExpense ? 'var(--warning)' : undefined}
            subLabel="Anulado" sub2Label="Gastos" format={formatKz} />
        )}
      </div>

      {/* Vendas por loja (multi-loja, tempo real) — período selecionável */}
      {byStore.length > 1 ? (
        <div className="card">
          <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}><span className="live-dot" /> Lojas ao vivo</h3>
            <span className="spacer" />
            <div style={{ display: 'flex', gap: 6 }}>
              {[{ d: 1, l: 'Hoje' }, { d: 7, l: '7 dias' }, { d: 30, l: '30 dias' }].map((o) => (
                <button key={o.d} className={`chip ${storeDays === o.d ? 'active' : ''}`} onClick={() => setStoreDays(o.d)}>{o.l}</button>
              ))}
            </div>
            <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
              Total {formatKz(byStore.reduce((t, s) => t + s.grossTotal, 0))}
            </span>
          </div>
          {(() => {
            const max = Math.max(1, ...byStore.map((s) => s.grossTotal));
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
                {byStore.map((s) => (
                  <div key={s.storeId}>
                    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                      <span style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <IconBuilding size={15} /> {s.storeName}{s.isDefault ? ' · principal' : ''}
                      </span>
                      <span style={{ fontWeight: 800 }}>{formatKz(s.grossTotal)} <span className="muted" style={{ fontWeight: 500 }}>· {s.invoiceCount} venda(s)</span></span>
                    </div>
                    <div style={{ height: 10, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(2, (s.grossTotal / max) * 100)}%`, height: '100%', borderRadius: 999,
                        background: s.isDefault ? 'var(--grad-primary)' : 'var(--primary)', transition: 'width .5s ease' }} />
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
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
