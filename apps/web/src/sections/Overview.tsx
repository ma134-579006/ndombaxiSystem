import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { DashLowStock, DashSalesSeries, DashStoreSales, DashTopProduct, ManagerStore, OpsAlert, ProfitProduct, ProfitSummary } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AreaChart, type AreaPoint } from '../components/AreaChart';
import { ColumnChart, type ColumnPoint } from '../components/ColumnChart';
import { IconBars, IconCalendar, IconCart, IconCube, IconStar, IconTrendUp } from '../components/Icons';
import { formatKz } from '../format';
import { PendingPosSales } from '../components/PendingPosSales';
import { pollEvery, stopPoll } from '../poll';

/* Dashboard no padrão do backoffice de referência:
   1) cartão com Faturação Hoje / Mensal / Anual (+ variação face ao período
      anterior equivalente) e o gráfico de área dos últimos 30 dias;
   2) Mais Vendidos · Mais Rentáveis (hoje) · Últimos 6 meses;
   3) Stock e alertas; vendas por loja quando há várias.
   As cores vêm do tema (barra lateral e paleta do LPS Vendas mantidas). */

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Períodos: hoje vs ontem; mês até hoje vs o mesmo intervalo do mês anterior;
 *  ano até hoje vs o mesmo intervalo do ano anterior. */
function periods(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = today.getDate();
  const pmStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const pmLast = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
  return {
    day: [iso(today), iso(today)], dayPrev: [iso(addDays(today, -1)), iso(addDays(today, -1))],
    month: [iso(new Date(today.getFullYear(), today.getMonth(), 1)), iso(today)],
    monthPrev: [iso(pmStart), iso(new Date(pmStart.getFullYear(), pmStart.getMonth(), Math.min(d, pmLast)))],
    year: [iso(new Date(today.getFullYear(), 0, 1)), iso(today)],
    yearPrev: [iso(new Date(today.getFullYear() - 1, 0, 1)), iso(new Date(today.getFullYear() - 1, today.getMonth(), d))],
  } as const;
}

function variation(cur: number, prev: number): number | null {
  if (!prev) return cur ? null : 0;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function bucketLabel(isoStr: string, gran: DashSalesSeries['granularity']): string {
  const d = new Date(isoStr);
  if (gran === 'month') return d.toLocaleDateString('pt-PT', { month: 'short', year: '2-digit' });
  if (gran === 'hour') return `${String(d.getHours()).padStart(2, '0')}h`;
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

type Sums = Record<'day' | 'dayPrev' | 'month' | 'monthPrev' | 'year' | 'yearPrev', ProfitSummary | null>;

export function Overview() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'COMPANY_ADMIN';
  const [stores, setStores] = useState<ManagerStore[]>([]);
  const [storeId, setStoreId] = useState('');
  const sid = storeId || undefined;
  const [withVat, setWithVat] = useState(true);
  const [sums, setSums] = useState<Sums | null>(null);
  const [series30, setSeries30] = useState<DashSalesSeries | null>(null);
  const [series6, setSeries6] = useState<DashSalesSeries | null>(null);
  const [top, setTop] = useState<DashTopProduct[]>([]);
  const [rent, setRent] = useState<ProfitProduct[]>([]);
  const [low, setLow] = useState<DashLowStock[]>([]);
  const [byStore, setByStore] = useState<DashStoreSales[]>([]);
  const [alerts, setAlerts] = useState<OpsAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Alertas dispensados (limpar notificações), guardados por dispositivo.
  const ALERTS_LS = 'ndombaxi.alerts.dismissed';
  const alertKey = (a: OpsAlert) => `${a.category}|${a.title}|${a.detail}`;
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(ALERTS_LS) || '[]') as string[]); } catch { return new Set(); }
  });
  const persistDismissed = (s: Set<string>) => { try { localStorage.setItem(ALERTS_LS, JSON.stringify([...s])); } catch { /* */ } };
  const dismissAlert = (a: OpsAlert) => setDismissed((p) => { const n = new Set(p); n.add(alertKey(a)); persistDismissed(n); return n; });
  const clearAllAlerts = () => setDismissed((p) => { const n = new Set(p); for (const a of alerts) n.add(alertKey(a)); persistDismissed(n); return n; });

  const load = useCallback(async () => {
    setError(null);
    const p = periods();
    const keys = Object.keys(p) as (keyof Sums)[];
    try {
      const [sumArr, s30, s6, t, r, l, a, bs] = await Promise.all([
        Promise.all(keys.map((k) => api.profit.summary(p[k][0], p[k][1], sid).catch(() => null))),
        api.dashboard.series('1m', sid).catch(() => null),
        api.dashboard.series('6m', sid).catch(() => null),
        api.dashboard.topProducts(5, sid).catch(() => [] as DashTopProduct[]),
        api.profit.byProduct(p.day[0], p.day[1], sid).catch(() => [] as ProfitProduct[]),
        api.dashboard.lowStock(sid).catch(() => [] as DashLowStock[]),
        api.alerts().catch(() => [] as OpsAlert[]),
        api.dashboard.salesByStore(1).catch(() => [] as DashStoreSales[]),
      ]);
      setSums(Object.fromEntries(keys.map((k, i) => [k, sumArr[i]])) as Sums);
      setSeries30(s30); setSeries6(s6); setTop(t);
      setRent([...r].filter((x) => x.profit > 0).sort((x, y) => y.profit - x.profit).slice(0, 5));
      setLow(l); setAlerts(a); setByStore(bs);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar o dashboard.');
    } finally { setLoading(false); }
  }, [sid]);

  useEffect(() => { if (isAdmin) api.staff.listStores().then(setStores).catch(() => undefined); }, [isAdmin]);
  useEffect(() => {
    void load();
    const t = pollEvery(() => void load(), 30_000);
    return () => stopPoll(t);
  }, [load]);

  const val = (s: ProfitSummary | null | undefined) => (s ? (withVat ? s.salesGross : s.salesNet) : 0);
  // O gráfico vem em valores c/ IVA; s/ IVA aplica a proporção líquida/bruta do período.
  const netRatio = sums?.month && sums.month.salesGross > 0 ? sums.month.salesNet / sums.month.salesGross : 1;
  const k = withVat ? 1 : netRatio;
  const chart30: AreaPoint[] = (series30?.points ?? []).map((pt) => ({ label: bucketLabel(pt.bucket, series30!.granularity), value: pt.grossTotal * k }));
  const chart6: ColumnPoint[] = (series6?.points ?? []).map((pt) => ({ label: bucketLabel(pt.bucket, series6!.granularity), value: pt.grossTotal * k }));
  const visibleAlerts = alerts.filter((a) => !dismissed.has(alertKey(a)));
  const lowOut = low.filter((s) => s.quantity <= 0);

  const Kpi = ({ icon, period, cur, prev }: { icon: React.ReactNode; period: string; cur: ProfitSummary | null | undefined; prev: ProfitSummary | null | undefined }) => {
    const v = variation(val(cur), val(prev));
    return (
      <div className="vd-kpi">
        <span className="vd-kpi-ic">{icon}</span>
        <div className="vd-kpi-tx">
          <div className="vd-kpi-lb">Faturação <b>{period}</b></div>
          <div className="vd-kpi-vl">{formatKz(val(cur))}</div>
          <div className="vd-kpi-cmp">
            {v === null ? <span className="vd-var up">novo</span>
              : <span className={`vd-var ${v > 0 ? 'up' : v < 0 ? 'down' : ''}`}>{v > 0 ? '+' : ''}{v.toFixed(2).replace('.', ',')}%</span>}
            <span>Anterior: {formatKz(val(prev))}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="vd-page vd-dash">
      <PendingPosSales />
      <div className="vd-head">
        <label className="vd-toggle">
          <span>Valores c/IVA</span>
          <button type="button" role="switch" aria-checked={withVat} className={`vd-sw${withVat ? ' on' : ''}`} onClick={() => setWithVat((v) => !v)}><span /></button>
        </label>
        <span className="spacer" />
        {isAdmin && stores.length > 1 ? (
          <select className="vd-in" style={{ width: 'auto', minWidth: 180 }} value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Loja">
            <option value="">Todas as lojas</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        ) : null}
      </div>

      {error ? <div className="vd-err" role="alert">{error}</div> : null}

      <div className="vd-card vd-dash-main">
        <div className="vd-kpis">
          <Kpi icon={<IconCart size={30} />} period="Hoje" cur={sums?.day} prev={sums?.dayPrev} />
          <Kpi icon={<IconCalendar size={30} />} period="Mensal" cur={sums?.month} prev={sums?.monthPrev} />
          <Kpi icon={<IconBars size={30} />} period="Anual" cur={sums?.year} prev={sums?.yearPrev} />
        </div>
        <div className="vd-dash-chart">
          {loading && !series30 ? <div className="vd-empty">A carregar…</div>
            : <AreaChart points={chart30} color="var(--primary)" format={formatKz} height={230} />}
        </div>
      </div>

      <div className="vd-dash-row">
        <div className="vd-card vd-panel">
          <h3 className="vd-panel-h"><IconTrendUp size={20} /> Mais <b>Vendidos</b></h3>
          {top.length === 0 ? <div className="vd-panel-empty"><IconCube size={34} /><span>Sem vendas</span></div> : (
            <ol className="vd-rank">
              {top.map((p, i) => (
                <li key={p.productCode} style={{ animationDelay: `${i * 40}ms` }}>
                  <span className="pos">{i + 1}</span>
                  <span className="nm" title={p.description}>{p.description}</span>
                  <span className="qt">{p.quantity.toLocaleString('pt-PT')} un.</span>
                  <span className="vl">{formatKz(p.grossTotal * k)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="vd-card vd-panel">
          <h3 className="vd-panel-h"><IconStar size={20} /> Mais <b>Rentáveis</b> <small>| Hoje</small></h3>
          {rent.length === 0 ? <div className="vd-panel-empty"><IconCube size={34} /><span>Sem vendas hoje</span></div> : (
            <ol className="vd-rank">
              {rent.map((p, i) => (
                <li key={p.productCode} style={{ animationDelay: `${i * 40}ms` }}>
                  <span className="pos">{i + 1}</span>
                  <span className="nm" title={p.description}>{p.description}</span>
                  <span className="qt">{p.marginPct.toFixed(0)}%</span>
                  <span className="vl">{formatKz(p.profit)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="vd-card vd-panel">
          <h3 className="vd-panel-h"><IconBars size={20} /> Últimos <b>6 meses</b></h3>
          {chart6.length === 0 ? <div className="vd-panel-empty"><IconBars size={34} /><span>Sem dados</span></div>
            : <ColumnChart data={chart6} color="var(--primary)" format={formatKz} />}
        </div>
      </div>

      <div className="vd-dash-row two">
        <div className="vd-card vd-panel">
          <h3 className="vd-panel-h"><IconCube size={20} /> <b>Stock</b>
            <span className="vd-panel-badges">
              <span className="vd-badge warn" title="Abaixo do mínimo">{low.length - lowOut.length}</span>
              <span className="vd-badge bad" title="Sem stock">{lowOut.length}</span>
            </span>
          </h3>
          {low.length === 0 ? <div className="vd-panel-empty"><IconCube size={34} /><span>Tudo acima do mínimo</span></div> : (
            <table className="vd-table">
              <thead><tr><th>Produto</th><th>Loja</th><th className="ctr">Stock</th><th className="ctr">Mínimo</th></tr></thead>
              <tbody>
                {low.slice(0, 8).map((s) => (
                  <tr key={`${s.productCode}-${s.warehouseCode}`}>
                    <td>{s.productName}<span className="sub">{s.productCode}</span></td>
                    <td>{s.warehouseCode}</td>
                    <td className="ctr"><span className={`vd-badge${s.quantity <= 0 ? ' bad' : ' warn'}`}>{s.quantity}</span></td>
                    <td className="ctr">{s.minQty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="vd-card vd-panel">
          <h3 className="vd-panel-h"><b>Alertas</b>
            {visibleAlerts.length > 0 ? <button className="vd-clear" style={{ marginLeft: 'auto' }} onClick={clearAllAlerts}>✕ Limpar tudo</button> : null}
          </h3>
          {visibleAlerts.length === 0 ? <div className="vd-panel-empty"><span>Sem alertas</span></div> : (
            <ul className="vd-alerts">
              {visibleAlerts.map((a, i) => (
                <li key={i} className={`l-${a.level}`}>
                  <div><b>{a.title}</b><span>{a.detail}</span></div>
                  <span className={`vd-tag ${a.level === 'danger' ? 'bad' : 'warn'}`}>{a.category}</span>
                  <button className="vd-clear" title="Limpar" aria-label="Limpar alerta" onClick={() => dismissAlert(a)}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {byStore.length > 1 ? (
        <div className="vd-card vd-panel">
          <h3 className="vd-panel-h"><b>Vendas por loja</b> <small>| Hoje</small></h3>
          <ColumnChart format={formatKz}
            data={byStore.map((s): ColumnPoint => ({ label: `${s.storeName}${s.isDefault ? ' · principal' : ''}`, value: s.grossTotal, hint: `${s.invoiceCount} venda(s)` }))} />
        </div>
      ) : null}
    </div>
  );
}
