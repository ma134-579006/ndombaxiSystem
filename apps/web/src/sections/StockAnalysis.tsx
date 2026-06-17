import React, { useEffect, useRef, useState } from 'react';
import { printSectionReport } from "../pdf/printDoc";
import { api, ApiError } from '../api/client';
import type { StockAnalysis as StockAnalysisData, WarehouseRow } from '../api/types';
import { IconSearch, IconCube } from '../components/Icons';
import { formatKz } from '../format';

const PERIODS: Array<{ label: string; days: number }> = [
  { label: 'Últimos 7 dias', days: 7 },
  { label: 'Últimos 30 dias', days: 30 },
  { label: 'Últimos 90 dias', days: 90 },
];
const STATES: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'positive', label: 'Com stock (positivo)' },
  { value: 'zero', label: 'Esgotados (zero)' },
  { value: 'negative', label: 'Negativo (a acertar)' },
  { value: 'low', label: 'Abaixo do mínimo' },
];

const isoMinusDays = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const todayISO = () => new Date().toISOString().slice(0, 10);

/** Análise de stock: valor, vendas e previsão por produto/loja, com filtros. */
export function StockAnalysis() {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [from, setFrom] = useState(isoMinusDays(30));
  const [to, setTo] = useState(todayISO());
  const [warehouseId, setWarehouseId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [state, setState] = useState('all');
  const [data, setData] = useState<StockAnalysisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.inventory.warehouses().then(setWarehouses).catch(() => undefined);
    api.inventory.categories().then(setCategories).catch(() => undefined);
  }, []);
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const setPeriod = (days: number) => { setFrom(isoMinusDays(days)); setTo(todayISO()); };

  const generate = async () => {
    setLoading(true); setError(null); setProgress(8);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setProgress((p) => (p < 90 ? p + Math.max(1, (90 - p) * 0.15) : p)), 120);
    try {
      const r = await api.inventory.analysis({
        from, to,
        warehouseId: warehouseId || undefined,
        categoryId: categoryId || undefined,
        state: state !== 'all' ? state : undefined,
      });
      setData(r);
      setProgress(100);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao gerar o relatório.');
    } finally {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setTimeout(() => setProgress(0), 400);
      setLoading(false);
    }
  };

  const s = data?.summary;

  return (
    <>
      <div className="content-head">
        <h2>Análise de stock</h2>
        <span className="spacer" />
        {data ? <button className="btn ghost sm no-print" onClick={() => void printSectionReport()}>Imprimir</button> : null}
      </div>

      {error ? <div className="banner danger" style={{ marginBottom: 12 }}>{error}</div> : null}

      <div className="card no-print" style={{ marginBottom: 12 }}>
        <div className="chip-row" style={{ marginBottom: 10 }}>
          {PERIODS.map((p) => (
            <button key={p.days} className="btn ghost sm" onClick={() => setPeriod(p.days)}>{p.label}</button>
          ))}
        </div>
        <div className="grid-2">
          <div className="field"><label>Data inicial</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="field"><label>Data final</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        <div className="grid-2">
          <div className="field"><label>Loja</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Todas</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></div>
          <div className="field"><label>Categoria</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Todas</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
        </div>
        <div className="field"><label>Estado do stock</label>
          <select value={state} onChange={(e) => setState(e.target.value)}>
            {STATES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select></div>
        <button className="btn" onClick={() => void generate()} disabled={loading}>
          <IconSearch size={16} /> {loading ? 'A gerar…' : 'Gerar relatório'}
        </button>
        {progress > 0 ? (
          <div className="progress" style={{ marginTop: 10, height: 8, background: 'var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)', transition: 'width .12s linear' }} />
          </div>
        ) : null}
      </div>

      {data && s ? (
        <>
          <div className="kpi-grid" style={{ marginBottom: 12 }}>
            <div className="kpi-card">
              <div className="kpi-label">Valor em stock</div>
              <div className="kpi-value">{formatKz(s.stockValue)}</div>
              <div className="kpi-sub">a preço de custo</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Previsão de venda</div>
              <div className="kpi-value">{formatKz(s.forecastValue)}</div>
              <div className="kpi-sub">próximos {data.period.days} dias</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Produtos</div>
              <div className="kpi-value">{s.products}</div>
              <div className="kpi-sub">{s.positive} com stock positivo</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Unidades vendidas</div>
              <div className="kpi-value">{s.unitsSold}</div>
              <div className="kpi-sub">no período seleccionado</div>
            </div>
          </div>

          <div className="card">
            {data.rows.length === 0 ? (
              <div className="empty"><IconCube size={36} /><p>Sem produtos para os filtros escolhidos.</p></div>
            ) : (
              <table className="ptable stack">
                <thead><tr>
                  <th>Produto</th><th>Loja</th><th>Custo unit.</th><th>Stock</th>
                  <th>Valor</th><th>Venda/dia</th><th>Vendidas</th><th>Entradas</th><th>Dias rest.</th>
                </tr></thead>
                <tbody>
                  {data.rows.map((r, i) => {
                    const qty = Number(r.quantity);
                    return (
                      <tr key={i}>
                        <td data-label="Produto">{r.product_name} <span className="muted">({r.product_code})</span></td>
                        <td data-label="Loja">{r.store_name}</td>
                        <td data-label="Custo unit.">{formatKz(Number(r.cost_price))}</td>
                        <td data-label="Stock"><span className={qty < 0 ? 'pill off' : qty === 0 ? 'pill' : 'pill on'}>{qty}</span></td>
                        <td data-label="Valor">{formatKz(Number(r.stock_value))}</td>
                        <td data-label="Venda/dia">{r.sales_per_day}</td>
                        <td data-label="Vendidas">{r.units_sold}</td>
                        <td data-label="Entradas">{r.units_in}</td>
                        <td data-label="Dias rest.">{r.days_left != null ? `${r.days_left} d` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <div className="card"><div className="empty"><IconCube size={36} /><p>Escolha os filtros e clique <strong>Gerar relatório</strong>.</p></div></div>
      )}
    </>
  );
}
