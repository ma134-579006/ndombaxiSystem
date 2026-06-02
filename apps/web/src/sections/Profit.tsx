import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { ProfitPoint, ProfitProduct, ProfitSummary } from '../api/types';
import { IconChart, IconRefresh } from '../components/Icons';

function kz(n: number): string {
  return (n ?? 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Kz';
}
function kzShort(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toLocaleString('pt-PT', { maximumFractionDigits: 1 }) + 'M';
  if (Math.abs(n) >= 1_000) return (n / 1_000).toLocaleString('pt-PT', { maximumFractionDigits: 0 }) + 'k';
  return String(Math.round(n));
}
function todayISO(d = new Date()): string { return d.toISOString().slice(0, 10); }

/** Página de Lucros do gestor: vendas, custo, lucro bruto/líquido, gráficos,
 *  filtro por datas e impressão dos dados filtrados. Atualiza em tempo real. */
export function Profit() {
  const [from, setFrom] = useState(todayISO(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(todayISO());
  const [sum, setSum] = useState<ProfitSummary | null>(null);
  const [series, setSeries] = useState<ProfitPoint[]>([]);
  const [products, setProducts] = useState<ProfitProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, ts, pr] = await Promise.all([
        api.profit.summary(from, to),
        api.profit.series(from, to),
        api.profit.byProduct(from, to),
      ]);
      setSum(s); setSeries(ts); setProducts(pr); setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar lucros.');
    } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => {
    void load();
    // Tempo real: refresca a cada 30s.
    timer.current = window.setInterval(() => void load(), 30_000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [load]);

  const maxBar = Math.max(1, ...series.map((p) => Math.max(p.salesNet, p.cost)));

  const print = () => window.print();

  const setPreset = (days: number) => {
    setFrom(todayISO(new Date(Date.now() - (days - 1) * 86400000)));
    setTo(todayISO());
  };

  return (
    <div className="profit-page">
      <div className="content-head no-print">
        <h2>Lucros da empresa</h2>
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="live-dot" /> Ao vivo{updatedAt ? ` · ${updatedAt.toLocaleTimeString('pt-PT')}` : ''}
        </span>
      </div>

      {/* Filtros (não imprimem) */}
      <div className="card no-print">
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Data inicial</label>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Data final</label>
            <input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="wrapcols" style={{ display: 'flex', gap: 6 }}>
            <button className="chip" onClick={() => setPreset(1)}>Hoje</button>
            <button className="chip" onClick={() => setPreset(7)}>7 dias</button>
            <button className="chip" onClick={() => setPreset(30)}>30 dias</button>
            <button className="chip" onClick={() => setPreset(90)}>90 dias</button>
          </div>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => void load()}><IconRefresh size={15} /> Atualizar</button>
          <button className="btn sm" onClick={print}>🖨 Imprimir</button>
        </div>
      </div>

      {error ? <div className="banner danger no-print">{error}</div> : null}

      {/* Cabeçalho de impressão */}
      <div className="print-only print-header">
        <h2>Relatório de Lucros</h2>
        <p>Período: {new Date(from).toLocaleDateString('pt-PT')} a {new Date(to).toLocaleDateString('pt-PT')}</p>
      </div>

      {/* KPIs */}
      {sum ? (
        <div className="kpi-grid">
          <KpiCard label="Vendas (c/ IVA)" value={kz(sum.salesGross)} sub={`${sum.salesCount} vendas · média ${kz(sum.ticketAvg)}`} tone="primary" />
          <KpiCard label="Custo das mercadorias" value={kz(sum.costTotal)} sub={`Base tributável ${kz(sum.salesNet)}`} tone="warning" />
          <KpiCard label="Lucro bruto" value={kz(sum.grossProfit)} sub={`Margem ${sum.marginPct}%`} tone="success" />
          <KpiCard label="Lucro líquido" value={kz(sum.netProfit)} sub={`Despesas ${kz(sum.otherExpenses)}`} tone={sum.netProfit >= 0 ? 'success' : 'danger'} />
          <KpiCard label="Cancelamentos" value={kz(sum.cancelledAmount)} sub={`${sum.cancelledCount} venda(s) anulada(s)`} tone="danger" />
        </div>
      ) : loading ? <div className="card"><div className="loading">A carregar…</div></div> : null}

      {/* Gráfico vendas vs custo vs lucro */}
      <div className="card">
        <h3>Evolução (vendas · custo · lucro)</h3>
        {series.length === 0 ? <p className="muted">Sem vendas no período.</p> : (
          <>
            <div className="bar-chart" style={{ height: 200 }}>
              {series.map((p) => (
                <div className="bar-col" key={p.bucket} title={`${p.bucket}\nVendas ${kz(p.salesNet)}\nCusto ${kz(p.cost)}\nLucro ${kz(p.profit)}`}>
                  <div className="profit-bars">
                    <div className="pb sales" style={{ height: `${(p.salesNet / maxBar) * 100}%` }} />
                    <div className="pb cost" style={{ height: `${(p.cost / maxBar) * 100}%` }} />
                    <div className="pb profit" style={{ height: `${(Math.max(p.profit, 0) / maxBar) * 100}%` }} />
                  </div>
                  <span className="bar-x">{p.bucket.slice(5)}</span>
                </div>
              ))}
            </div>
            <div className="legend-row">
              <span><span className="dot" style={{ background: 'var(--primary)' }} /> Vendas</span>
              <span><span className="dot" style={{ background: 'var(--warning)' }} /> Custo</span>
              <span><span className="dot" style={{ background: 'var(--success)' }} /> Lucro</span>
            </div>
          </>
        )}
      </div>

      {/* Lucro por produto */}
      <div className="card">
        <h3>Lucro por produto</h3>
        {products.length === 0 ? <p className="muted">Sem dados.</p> : (
          <table className="ptable">
            <thead>
              <tr><th>Produto</th><th>Qt</th><th>Vendas</th><th>Custo</th><th>Lucro</th><th>Margem</th></tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.productCode}>
                  <td>{p.description}</td>
                  <td>{p.qty}</td>
                  <td>{kz(p.salesNet)}</td>
                  <td>{kz(p.cost)}</td>
                  <td style={{ color: p.profit >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>{kz(p.profit)}</td>
                  <td>{p.marginPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className={`kpi-card ${tone}`}>
      <div className="kpi-ic"><IconChart size={20} /></div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ fontSize: 22 }}>{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}
