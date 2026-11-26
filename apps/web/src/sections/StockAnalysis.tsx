import React, { useEffect, useRef, useState } from 'react';
import { printSectionReport } from '../pdf/printDoc';
import { api, ApiError } from '../api/client';
import type { StockAnalysis as StockAnalysisData, StockAnalysisRow, WarehouseRow } from '../api/types';
import { runDownload } from '../components/feedback';
import { IconAlertCircle, IconSearch } from '../components/Icons';
import { formatKz, localIso } from '../format';

/** «Período de Comparação» do Vendus: base para as vendas/dia e a previsão. */
const PERIODS: Array<{ label: string; days: number }> = [
  { label: '7 Dias', days: 7 }, { label: '21 Dias', days: 21 }, { label: '1 Mês', days: 30 },
  { label: '2 Meses', days: 60 }, { label: '3 Meses', days: 90 }, { label: '6 Meses', days: 180 }, { label: '1 Ano', days: 365 },
];
const STATES = [
  { value: 'positive', label: 'Positivo' },
  { value: 'nonpositive', label: 'Negativo ou Nulo' },
  { value: 'low', label: 'Menor que Alerta' },
];
/** Colunas explicadas no quadro «Sobre a Análise de Stock» (como no Vendus). */
const ABOUT: Array<[string, string]> = [
  ['P. Custo', 'Preço de custo do produto.'],
  ['Stock Valor', 'Valorização do stock com base nas unidades em stock e respetivo preço de custo.'],
  ['Stock Previsão', 'Dias que o stock dura ao ritmo das vendas do período de comparação. Se for inferior a 7 dias aparece com um sinal de alerta.'],
  ['Vendas/Dia', 'Média de unidades vendidas por dia no período de comparação.'],
  ['Uni. Vendidas', 'Número total de unidades vendidas no período de comparação.'],
  ['U. Preço Compra', 'Último preço de compra ao fornecedor (e a diferença para o preço de custo atual).'],
  ['U. Encomenda', 'Última encomenda ao fornecedor e respetivas unidades.'],
  ['U. Entrada Stock', 'Última entrada em stock e respetivas unidades.'],
];

const isoMinusDays = (d: number) => localIso(new Date(Date.now() - (d - 1) * 86400000));
const n = (v: unknown) => Number(v) || 0;
const q = (v: unknown) => String(Math.round(n(v) * 1000) / 1000).replace('.', ',');
const dt = (s?: string | null) => (s ? new Date(s).toLocaleDateString('pt-PT') : '—');
const PAGE = 100;

/** Produtos › Análise de Stock, no formato do Vendus: «Criar Relatório» (período de
 *  comparação, lojas, categorias, marcas, estado do stock) → tabela por produto. */
export function StockAnalysis({ onGo }: { onGo?: (s: string) => void } = {}) {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [days, setDays] = useState(7);
  const [whs, setWhs] = useState<string[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [brs, setBrs] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [data, setData] = useState<StockAnalysisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const resultRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    api.inventory.warehouses().then(setWarehouses).catch(() => undefined);
    api.inventory.categories().then(setCategories).catch(() => undefined);
    api.inventory.brands().then(setBrands).catch(() => undefined);
  }, []);

  const generate = async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.inventory.analysis({ from: isoMinusDays(days), to: localIso(), warehouseIds: whs, categoryIds: cats, brands: brs, states });
      setData(r); setPage(0);
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao gerar o relatório.');
    } finally { setLoading(false); }
  };

  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const slice = rows.slice(page * PAGE, page * PAGE + PAGE);
  const exportCsv = () => {
    const head = ['Produto', 'Referência', 'Loja', 'Stock', 'P. Custo', 'Stock Valor', 'Stock Previsão (dias)', 'Vendas/Dia', 'Uni. Vendidas', 'U. Preço Compra', 'U. Encomenda', 'U. Encomenda Qtd', 'U. Entrada Stock', 'U. Entrada Qtd'];
    const cell = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const body = rows.map((r) => [r.product_name, r.product_code, r.store_name, String(n(r.quantity)), String(n(r.cost_price)), String(n(r.stock_value)), r.days_left == null ? '' : String(r.days_left), String(r.sales_per_day), String(r.units_sold), r.last_buy_price == null ? '' : String(n(r.last_buy_price)), dt(r.last_order_at), r.last_order_qty == null ? '' : String(n(r.last_order_qty)), dt(r.last_in_at), r.last_in_qty == null ? '' : String(n(r.last_in_qty))].map(cell).join(';'));
    const csv = [head.join(';'), ...body].join('\r\n');
    void runDownload({ title: 'A exportar a análise de stock', fileName: `analise-stock-${localIso()}.csv`, make: async () => new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }) });
  };

  return (
    <div className="vd-page sa-page">
      <div className="vd-head no-print">
        <p className="vd-crumb"><span style={{ color: 'var(--primary)' }}>Produtos</span><span className="sep">/</span><span>Análise de Stock</span></p>
        <span className="spacer" />
        {onGo ? <button className="vd-btn ok" onClick={() => onGo('inventory')}>Atualizar Stock</button> : null}
      </div>
      {error ? <div className="vd-err no-print" role="alert">{error}</div> : null}

      <section className="vd-card acc-box no-print">
        <h3 className="acc-hd">Criar Relatório</h3>
        <form className="sa-form" onSubmit={(e) => { e.preventDefault(); void generate(); }}>
          <div className="sa-row"><label htmlFor="sa-days">Período de Comparação:</label>
            <div><select id="sa-days" className="vd-in" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
            </select><p className="sa-help">O período de comparação permite calcular a previsão de stock com base nas vendas.</p></div></div>
          <div className="sa-row"><span className="sa-lbl">Lojas/Armazéns:</span>
            <div><MultiPick all="Todas as Lojas/Armazéns" options={warehouses.map((w) => ({ value: w.id, label: w.name }))} value={whs} onChange={setWhs} />
              <p className="sa-help">Indique as lojas/armazéns em que pretende fazer a análise. Se não indicar nenhuma, entram todas.</p></div></div>
          <div className="sa-row"><span className="sa-lbl">Categorias:</span>
            <div><MultiPick all="Todas as Categorias" options={categories.map((c) => ({ value: c.id, label: c.name }))} value={cats} onChange={setCats} /></div></div>
          <div className="sa-row"><span className="sa-lbl">Marcas:</span>
            <div><MultiPick all="Todas as Marcas" options={brands.map((b) => ({ value: b, label: b }))} value={brs} onChange={setBrs} /></div></div>
          <div className="sa-row"><span className="sa-lbl">Estado do Stock:</span>
            <div><MultiPick all="Todos os tipos de stock" options={STATES} value={states} onChange={setStates} />
              <p className="sa-help">Filtre o estado do stock do produto. Caso não escolha, entram todos.</p></div></div>
          <div className="sa-row"><span /><div><button type="submit" className="vd-btn big sa-go" disabled={loading}><IconSearch size={16} /> {loading ? 'A gerar…' : 'Gerar Relatório'}</button></div></div>
        </form>
      </section>

      <div ref={resultRef} />
      {data ? (
        <section className="vd-card acc-box">
          <h3 className="acc-hd sa-res-hd">
            <span>Análise de Stock · últimos {data.period.days} dias</span>
            <span className="sa-res-act no-print">
              <button type="button" className="vd-btn outline sm" onClick={() => void printSectionReport({ title: 'Análise de Stock', subtitle: `Últimos ${data.period.days} dias` })}>Imprimir</button>
              <button type="button" className="vd-btn outline sm" onClick={exportCsv}>Exportar CSV</button>
            </span>
          </h3>
          <p className="sa-sum">Valor em stock <strong>{formatKz(data.summary.stockValue)}</strong> · {data.summary.products} produto(s) · {data.summary.positive} com stock positivo · {q(data.summary.unitsSold)} unidades vendidas</p>
          {rows.length === 0 ? <div className="vd-empty">Não existem produtos para os filtros escolhidos.</div> : (
            <>
              <table className="ptable acc-table sa-table">
                <thead><tr>
                  <th>Produto</th><th className="num">Stock</th><th className="num">Stock Valor<span className="acc-sub">P. Custo</span></th><th className="num">Stock Previsão</th>
                  <th className="num">Vendas/<wbr />Dia</th><th className="num">Uni. Vendidas</th><th className="num">U. Preço Compra</th><th>U. Encomenda</th><th>U. Entrada Stock</th>
                </tr></thead>
                <tbody>{slice.map((r, i) => <Row key={`${r.product_id}-${r.store_id}-${i}`} r={r} />)}</tbody>
              </table>
              {pages > 1 ? (
                <nav className="acc-pager" aria-label="Páginas">
                  <button type="button" className="vd-btn plain sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>Anterior</button>
                  <span>Página {page + 1} de {pages} · {rows.length} registos</span>
                  <button type="button" className="vd-btn plain sm" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>Seguinte</button>
                </nav>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      <section className="vd-card acc-box no-print">
        <h3 className="acc-hd">Sobre a Análise de Stock</h3>
        <p className="sa-help sa-about-p">A Análise de Stock dá-lhe a valorização, a previsão (com base nas vendas) e o histórico de compras de cada produto.</p>
        <table className="ptable acc-table sa-about">
          <thead><tr><th>Coluna</th><th>Descrição</th></tr></thead>
          <tbody>{ABOUT.map(([k, v]) => <tr key={k}><td className="nw"><strong>{k}</strong></td><td>{v}</td></tr>)}</tbody>
        </table>
      </section>
    </div>
  );
}

function Row({ r }: { r: StockAnalysisRow }) {
  const qty = n(r.quantity);
  const cost = n(r.cost_price);
  const buy = r.last_buy_price == null ? null : n(r.last_buy_price);
  const alert = r.days_left != null && r.days_left < 7;
  return (
    <tr>
      <td className="wrap">{r.product_name}<span className="acc-sub">{r.product_code} · {r.store_name}</span></td>
      <td className={`num${qty <= 0 ? ' sa-neg' : ''}`}>{q(qty)}</td>
      <td className="num">{formatKz(n(r.stock_value))}<span className="acc-sub">{formatKz(cost)}</span></td>
      <td className="num">{r.days_left == null ? '—' : <span className={alert ? 'sa-alert' : undefined}>{alert ? <span role="img" aria-label="Menos de 7 dias"><IconAlertCircle size={14} /></span> : null} {r.days_left} dias</span>}</td>
      <td className="num">{String(r.sales_per_day).replace('.', ',')}</td>
      <td className="num">{q(r.units_sold)}</td>
      <td className="num">{buy == null ? '—' : <>{formatKz(buy)}{buy !== cost ? <span className="acc-sub">VS {buy > cost ? '+' : ''}{formatKz(buy - cost)}</span> : null}</>}</td>
      <td className="nw">{r.last_order_at ? <>{dt(r.last_order_at)}<span className="acc-sub">{q(r.last_order_qty)} un.</span></> : '—'}</td>
      <td className="nw">{r.last_in_at ? <>{dt(r.last_in_at)}<span className="acc-sub">{q(r.last_in_qty)} un.</span></> : '—'}</td>
    </tr>
  );
}

/** Lista com caixas (como os seletores múltiplos do Vendus); vazio = todos. */
function MultiPick({ all, options, value, onChange }: { all: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const label = value.length === 0 ? all : value.length === 1 ? options.find((o) => o.value === value[0])?.label ?? '1 selecionado' : `${value.length} selecionados`;
  return (
    <details ref={ref} className="acc-types sa-pick">
      <summary>{label}</summary>
      <div className="acc-types-list">
        {value.length ? <button type="button" onClick={() => onChange([])}>Limpar (todos)</button> : null}
        {options.length === 0 ? <span className="sa-help">Sem opções.</span> : options.map((o) => (
          <label key={o.value}><input type="checkbox" checked={value.includes(o.value)} onChange={() => onChange(value.includes(o.value) ? value.filter((x) => x !== o.value) : [...value, o.value])} /> {o.label}</label>
        ))}
      </div>
    </details>
  );
}
