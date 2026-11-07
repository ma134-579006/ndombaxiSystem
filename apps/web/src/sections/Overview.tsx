import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { DashLowStock, DashSalesSeries, DashTopProduct, ManagerStore, OpsAlert, ProfitProduct, ProfitSummary, ReportCategoryRow, ReportUserRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { VdArea, VdBars, VdDonut, VdEmpty, VdMiniBars, VdSpark, type VdPoint } from '../components/VdCharts';
import { IconBars, IconCalendar, IconCart, IconLayers, IconStar, IconStore, IconTrendUp, IconUserGroup } from '../components/Icons';
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
  if (gran === 'month') { const m = d.toLocaleDateString('pt-PT', { month: 'short' }).replace('.', ''); return m.charAt(0).toUpperCase() + m.slice(1); }
  if (gran === 'hour') return `${String(d.getHours()).padStart(2, '0')}h`;
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}


type Sums = Record<'day' | 'dayPrev' | 'month' | 'monthPrev' | 'year' | 'yearPrev', ProfitSummary | null>;
const SUM_KEYS: (keyof Sums)[] = ['day', 'dayPrev', 'month', 'monthPrev', 'year', 'yearPrev'];

/** Resumo de uma loja (linha por loja, como na referência). */
interface StoreRow {
  store: ManagerStore;
  day: ProfitSummary | null; dayPrev: ProfitSummary | null;
  month: ProfitSummary | null; monthPrev: ProfitSummary | null;
  spark: number[]; bars: number[];
}

async function loadSums(sid?: string): Promise<Sums> {
  const p = periods();
  const arr = await Promise.all(SUM_KEYS.map((k) => api.profit.summary(p[k][0], p[k][1], sid).catch(() => null)));
  return Object.fromEntries(SUM_KEYS.map((k, i) => [k, arr[i]])) as Sums;
}

export function Overview() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'COMPANY_ADMIN';
  const [stores, setStores] = useState<ManagerStore[]>([]);
  const [withVat, setWithVat] = useState(false);
  const [sums, setSums] = useState<Sums | null>(null);
  const [series30, setSeries30] = useState<DashSalesSeries | null>(null);
  const [series6, setSeries6] = useState<DashSalesSeries | null>(null);
  const [top, setTop] = useState<DashTopProduct[]>([]);
  const [rent, setRent] = useState<ProfitProduct[]>([]);
  const [low, setLow] = useState<DashLowStock[]>([]);
  const [storeRows, setStoreRows] = useState<StoreRow[]>([]);
  const [byCat, setByCat] = useState<ReportCategoryRow[]>([]);
  const [byBrand, setByBrand] = useState<ReportCategoryRow[]>([]);
  const [topCust, setTopCust] = useState<ReportUserRow[]>([]);
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

  useEffect(() => { if (isAdmin) api.staff.listStores().then((s) => setStores(s.filter((x) => x.is_active))).catch(() => undefined); }, [isAdmin]);

  const load = useCallback(async () => {
    setError(null);
    const p = periods();
    const d30 = iso(addDays(new Date(), -29));
    try {
      const [s, s30, s6, t, r, l, a, cat, brand, cust] = await Promise.all([
        loadSums(),
        api.dashboard.series('1m').catch(() => null),
        api.dashboard.series('6m').catch(() => null),
        api.dashboard.topProducts(5).catch(() => [] as DashTopProduct[]),
        api.profit.byProduct(p.day[0], p.day[1]).catch(() => [] as ProfitProduct[]),
        api.dashboard.lowStock().catch(() => [] as DashLowStock[]),
        api.alerts().catch(() => [] as OpsAlert[]),
        api.reports.salesByCategory(d30, p.day[1]).catch(() => [] as ReportCategoryRow[]),
        api.reports.salesByBrand(d30, p.day[1]).catch(() => [] as ReportCategoryRow[]),
        api.reports.salesByCustomer(d30, p.day[1]).catch(() => [] as ReportUserRow[]),
      ]);
      setSums(s); setSeries30(s30); setSeries6(s6); setTop(t);
      setRent([...r].filter((x) => x.profit > 0).sort((x, y) => y.profit - x.profit).slice(0, 5));
      setLow(l); setAlerts(a); setByCat(cat); setByBrand(brand);
      setTopCust([...cust].sort((x, y) => y.gross - x.gross).slice(0, 10));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar o dashboard.');
    } finally { setLoading(false); }
  }, []);

  // Linhas por loja: só com 2+ lojas (o admin vê todas).
  const loadStores = useCallback(async () => {
    if (stores.length < 2) { setStoreRows([]); return; }
    const rows = await Promise.all(stores.map(async (store): Promise<StoreRow> => {
      const [s, m1, m6] = await Promise.all([
        loadSums(store.id),
        api.dashboard.series('1m', store.id).catch(() => null),
        api.dashboard.series('6m', store.id).catch(() => null),
      ]);
      return {
        store, day: s.day, dayPrev: s.dayPrev, month: s.month, monthPrev: s.monthPrev,
        spark: (m1?.points ?? []).map((x) => x.grossTotal), bars: (m6?.points ?? []).map((x) => x.grossTotal),
      };
    }));
    setStoreRows(rows);
  }, [stores]);

  useEffect(() => {
    void load(); void loadStores();
    const t = pollEvery(() => { void load(); void loadStores(); }, 30_000);
    return () => stopPoll(t);
  }, [load, loadStores]);

  const val = (s: ProfitSummary | null | undefined) => (s ? (withVat ? s.salesGross : s.salesNet) : 0);
  // Séries vêm c/ IVA; s/ IVA aplica a proporção líquida/bruta do mês.
  const k = withVat ? 1 : (sums?.month && sums.month.salesGross > 0 ? sums.month.salesNet / sums.month.salesGross : 1);
  const chart30: VdPoint[] = (series30?.points ?? []).map((pt) => ({ label: bucketLabel(pt.bucket, series30!.granularity), value: pt.grossTotal * k }));
  const chart6: VdPoint[] = (series6?.points ?? []).map((pt) => ({ label: bucketLabel(pt.bucket, series6!.granularity), value: pt.grossTotal * k }));
  const visibleAlerts = alerts.filter((a) => !dismissed.has(alertKey(a)));
  const catData: VdPoint[] = byCat.filter((c) => c.gross > 0).slice(0, 8).map((c) => ({ label: c.name || 'Não definido', value: withVat ? c.gross : c.net }));
  const brandData: VdPoint[] = byBrand.filter((c) => c.gross > 0).slice(0, 8).map((c) => ({ label: c.name || 'Não definido', value: withVat ? c.gross : c.net }));

  // Stocks por loja (armazém): mínimo, sem stock, negativo.
  const stockByWh = new Map<string, { min: number; zero: number; neg: number }>();
  for (const s of low) {
    const r = stockByWh.get(s.warehouseCode) ?? { min: 0, zero: 0, neg: 0 };
    if (s.quantity < 0) r.neg++; else if (s.quantity === 0) r.zero++; else r.min++;
    stockByWh.set(s.warehouseCode, r);
  }
  const whName = (code: string) => stores.find((s) => s.code === code)?.name ?? code;

  const Var = ({ cur, prev, label }: { cur: number; prev: number; label: string }) => {
    const v = variation(cur, prev);
    return (
      <div className="vd-kpi-cmp">
        {v === null ? <span className="vd-var up">novo</span>
          : <span className={`vd-var ${v > 0 ? 'up' : v < 0 ? 'down' : ''}`}>{v > 0 ? '+' : ''}{v.toFixed(2).replace('.', ',')} %</span>}
        <span><b>{label}:</b> {formatKz(prev)}</span>
      </div>
    );
  };
  const Kpi = ({ icon, period, cur, prev, prevLabel }: { icon: React.ReactNode; period: string; cur: ProfitSummary | null | undefined; prev: ProfitSummary | null | undefined; prevLabel: string }) => (
    <div className="vd-kpi">
      <span className="vd-kpi-ic">{icon}</span>
      <div className="vd-kpi-tx">
        <div className="vd-kpi-lb">Faturação <b>{period}</b></div>
        <div className="vd-kpi-vl">{formatKz(val(cur))}</div>
        <Var cur={val(cur)} prev={val(prev)} label={prevLabel} />
      </div>
    </div>
  );

  return (
    <div className="vd-page vd-dash">
      <PendingPosSales />
      <div className="vd-head">
        <label className="vd-toggle">
          <span>Valores c/IVA</span>
          <button type="button" role="switch" aria-checked={withVat} className={`vd-sw${withVat ? ' on' : ''}`} onClick={() => setWithVat((v) => !v)}><span /></button>
        </label>
      </div>

      {error ? <div className="vd-err" role="alert">{error}</div> : null}

      <div className="vd-card vd-dash-main">
        <div className="vd-kpis">
          <Kpi icon={<IconCart size={30} />} period="Hoje" cur={sums?.day} prev={sums?.dayPrev} prevLabel="Ontem" />
          <Kpi icon={<IconCalendar size={30} />} period="Mensal" cur={sums?.month} prev={sums?.monthPrev} prevLabel="Anterior" />
          <Kpi icon={<IconBars size={30} />} period="Anual" cur={sums?.year} prev={sums?.yearPrev} prevLabel="Anterior" />
        </div>
        <div className="vd-dash-chart">
          {loading && !series30 ? <div className="vd-empty">A carregar…</div> : <VdArea points={chart30} format={formatKz} />}
        </div>
      </div>

      <div className="vd-dash-row">
        <div className="vd-card vd-panel">
          <h3 className="vd-panel-h"><IconTrendUp size={20} /> Mais <b>Vendidos</b></h3>
          {top.length === 0 ? <VdEmpty /> : (
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
          {rent.length === 0 ? <VdEmpty /> : (
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
          <h3 className="vd-panel-h"><IconTrendUp size={20} /> Últimos <b>6 meses</b></h3>
          {chart6.length === 0 ? <VdEmpty /> : <VdBars points={chart6} format={formatKz} />}
        </div>
      </div>

      {storeRows.map((r) => (
        <div className="vd-card vd-storerow" key={r.store.id}>
          <IconStore size={24} />
          <div className="vd-sr-name">{r.store.name}</div>
          <div className="vd-sr-lbl">Hoje</div>
          <div className="vd-sr-kpi">
            <div className="vd-sr-vl">{formatKz(val(r.day))}</div>
            <Var cur={val(r.day)} prev={val(r.dayPrev)} label="Ontem" />
          </div>
          <div className="vd-sr-chart">{r.spark.some((x) => x > 0) ? <VdSpark values={r.spark} /> : <span className="vd-sr-none">Sem vendas<br />este mês</span>}</div>
          <span className="vd-sr-div" />
          <div className="vd-sr-lbl">Mensal</div>
          <div className="vd-sr-kpi">
            <div className="vd-sr-vl">{formatKz(val(r.month))}</div>
            <Var cur={val(r.month)} prev={val(r.monthPrev)} label="Anterior" />
          </div>
          <div className="vd-sr-chart"><VdMiniBars values={r.bars} /></div>
        </div>
      ))}

      <div className="vd-card vd-panel">
        <h3 className="vd-panel-h"><IconLayers size={22} /> <b>Lojas - Stocks</b></h3>
        <div className="vd-tablewrap">
          <table className="vd-table vd-plain">
            <thead><tr><th>Loja</th><th className="num">Stock Mínimo</th><th className="num">Sem Stock</th><th className="num">Stock Negativo</th></tr></thead>
            <tbody>
              {stockByWh.size === 0 ? <tr><td colSpan={4} className="vd-empty">Sem produtos abaixo do mínimo</td></tr>
                : [...stockByWh.entries()].map(([code, s]) => (
                  <tr key={code}><td><b>{whName(code)}</b></td><td className="num">{s.min}</td><td className="num">{s.zero}</td><td className="num">{s.neg}</td></tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="vd-dash-row two">
        <div className="vd-card vd-panel">
          <h3 className="vd-panel-h"><IconCart size={22} /> <b>Vendas por Categoria</b></h3>
          {catData.length === 0 ? <VdEmpty /> : <VdDonut data={catData} format={formatKz} />}
        </div>
        <div className="vd-card vd-panel">
          <h3 className="vd-panel-h"><IconCart size={22} /> <b>Vendas por Marca</b></h3>
          {brandData.length === 0 ? <VdEmpty /> : <VdDonut data={brandData} format={formatKz} />}
        </div>
      </div>

      <div className="vd-card vd-panel">
        <h3 className="vd-panel-h"><IconUserGroup size={22} /> <b>Top Clientes - Últimos 30 Dias</b></h3>
        <div className="vd-tablewrap">
          <table className="vd-table vd-plain">
            <thead><tr><th>Cliente</th><th className="num">Valor</th><th className="num">Compras</th></tr></thead>
            <tbody>
              {topCust.length === 0 ? <tr><td colSpan={3} className="vd-empty">Sem informação disponível</td></tr>
                : topCust.map((c, i) => (
                  <tr key={`${c.name}-${i}`}><td><span className="vd-link">{c.name || 'Consumidor Final'}</span></td><td className="num">{formatKz(withVat ? c.gross : c.net)}</td><td className="num">{c.sales}</td></tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {visibleAlerts.length > 0 ? (
        <div className="vd-card vd-panel">
          <h3 className="vd-panel-h"><b>Alertas</b>
            <button className="vd-clear" style={{ marginLeft: 'auto' }} onClick={clearAllAlerts}>✕ Limpar tudo</button>
          </h3>
          <ul className="vd-alerts">
            {visibleAlerts.map((a, i) => (
              <li key={i} className={`l-${a.level}`}>
                <div><b>{a.title}</b><span>{a.detail}</span></div>
                <span className={`vd-tag ${a.level === 'danger' ? 'bad' : 'warn'}`}>{a.category}</span>
                <button className="vd-clear" title="Limpar" aria-label="Limpar alerta" onClick={() => dismissAlert(a)}>✕</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
