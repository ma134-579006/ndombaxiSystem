import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type {
  ProfitPoint, ProfitProduct, ReportCategoryRow, ReportPaymentRow, ReportTaxRow, ReportUserRow,
} from '../api/types';
import { IconChart } from '../components/Icons';
import { formatKz } from '../format';

type Tab = 'product' | 'user' | 'category' | 'evolution' | 'tax' | 'payments';
const TABS: { key: Tab; label: string }[] = [
  { key: 'product', label: 'Por produto' },
  { key: 'user', label: 'Por utilizador' },
  { key: 'category', label: 'Por categoria' },
  { key: 'evolution', label: 'Evolução temporal' },
  { key: 'tax', label: 'Mapa de IVA' },
  { key: 'payments', label: 'Métodos de pagamento' },
];
const todayISO = (d = new Date()) => d.toISOString().slice(0, 10);
const PAY_LABEL: Record<string, string> = {
  CASH: 'Dinheiro', CARD: 'Multibanco/Cartão', TRANSFER: 'Transferência',
  REFERENCE: 'Referência', EXPRESS: 'Express', CREDIT: 'A crédito', OUTRO: 'Outro',
};

/** Centro de Relatórios (estilo Vendus): performance comercial, fiscal e caixa. */
export function Reports() {
  const [tab, setTab] = useState<Tab>('product');
  const [from, setFrom] = useState(todayISO(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(todayISO());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [byProduct, setByProduct] = useState<ProfitProduct[]>([]);
  const [byUser, setByUser] = useState<ReportUserRow[]>([]);
  const [byCategory, setByCategory] = useState<ReportCategoryRow[]>([]);
  const [series, setSeries] = useState<ProfitPoint[]>([]);
  const [tax, setTax] = useState<ReportTaxRow[]>([]);
  const [payments, setPayments] = useState<ReportPaymentRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (tab === 'product') setByProduct(await api.profit.byProduct(from, to));
      else if (tab === 'user') setByUser(await api.reports.salesByUser(from, to));
      else if (tab === 'category') setByCategory(await api.reports.salesByCategory(from, to));
      else if (tab === 'evolution') setSeries(await api.profit.series(from, to));
      else if (tab === 'tax') setTax(await api.reports.taxMap(from, to));
      else if (tab === 'payments') setPayments(await api.reports.paymentMethods(from, to));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar o relatório.');
    } finally { setLoading(false); }
  }, [tab, from, to]);

  useEffect(() => { void load(); }, [load]);

  const csvExport = () => {
    let headers: string[] = []; let rows: (string | number)[][] = [];
    if (tab === 'product') { headers = ['Produto', 'Qt', 'Vendas', 'Custo', 'Lucro', 'Margem%']; rows = byProduct.map((p) => [p.description, p.qty, p.salesNet, p.cost, p.profit, p.marginPct]); }
    else if (tab === 'user') { headers = ['Utilizador', 'Vendas', 'Líquido', 'Total']; rows = byUser.map((r) => [r.name, r.sales, r.net, r.gross]); }
    else if (tab === 'category') { headers = ['Categoria', 'Qt', 'Líquido', 'Total']; rows = byCategory.map((r) => [r.name, r.qty, r.net, r.gross]); }
    else if (tab === 'evolution') { headers = ['Data', 'Vendas', 'Custo', 'Lucro']; rows = series.map((p) => [p.bucket, p.salesNet, p.cost, p.profit]); }
    else if (tab === 'tax') { headers = ['Taxa IVA%', 'Base', 'IVA', 'Total']; rows = tax.map((r) => [r.rate, r.net, r.iva, r.gross]); }
    else if (tab === 'payments') { headers = ['Método', 'Nº', 'Total']; rows = payments.map((r) => [PAY_LABEL[r.method] ?? r.method, r.count, r.total]); }
    const csv = [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `relatorio-${tab}-${from}-a-${to}.csv`;
    a.click();
  };

  return (
    <div className="reports-page">
      <div className="content-head no-print">
        <h2>Relatórios</h2>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={csvExport}>⬇ CSV/Excel</button>
        <button className="btn sm ghost" onClick={() => window.print()}>🖨 Imprimir/PDF</button>
      </div>

      <div className="card no-print" style={{ marginBottom: 12 }}>
        <div className="chip-row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {TABS.map((t) => (
            <button key={t.key} className={`chip${tab === t.key ? ' on' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0 }}><label>Data inicial</label>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="field" style={{ margin: 0 }}><label>Data final</label>
            <input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} /></div>
          <button className="btn sm" onClick={() => void load()} disabled={loading}>{loading ? 'A carregar…' : 'Atualizar'}</button>
        </div>
      </div>

      {error ? <div className="banner danger no-print">{error}</div> : null}

      <div className="print-only print-header">
        <h2>Relatório — {TABS.find((t) => t.key === tab)?.label}</h2>
        <p>Período: {new Date(from).toLocaleDateString('pt-PT')} a {new Date(to).toLocaleDateString('pt-PT')}</p>
      </div>

      <div className="card">
        {loading ? <div className="loading">A carregar…</div> : (
          <>
            {tab === 'product' ? (
              <Table head={['Produto', 'Qt', 'Vendas', 'Custo', 'Lucro', 'Margem']}
                rows={byProduct.map((p) => [p.description, String(p.qty), formatKz(p.salesNet), formatKz(p.cost), formatKz(p.profit), `${p.marginPct}%`])} />
            ) : null}
            {tab === 'user' ? (
              <Table head={['Utilizador', 'Nº vendas', 'Líquido', 'Total faturado']}
                rows={byUser.map((r) => [r.name, String(r.sales), formatKz(r.net), formatKz(r.gross)])} />
            ) : null}
            {tab === 'category' ? (
              <Table head={['Categoria', 'Quantidade', 'Líquido', 'Total']}
                rows={byCategory.map((r) => [r.name, String(r.qty), formatKz(r.net), formatKz(r.gross)])} />
            ) : null}
            {tab === 'evolution' ? (
              <Table head={['Data', 'Vendas', 'Custo', 'Lucro']}
                rows={series.map((p) => [p.bucket, formatKz(p.salesNet), formatKz(p.cost), formatKz(p.profit)])} />
            ) : null}
            {tab === 'tax' ? (
              <Table head={['Taxa IVA', 'Base tributável', 'IVA', 'Total']}
                rows={tax.map((r) => [`${r.rate}%`, formatKz(r.net), formatKz(r.iva), formatKz(r.gross)])}
                foot={['Total', formatKz(sum(tax, 'net')), formatKz(sum(tax, 'iva')), formatKz(sum(tax, 'gross'))]} />
            ) : null}
            {tab === 'payments' ? (
              <Table head={['Método de pagamento', 'Nº', 'Total']}
                rows={payments.map((r) => [PAY_LABEL[r.method] ?? r.method, String(r.count), formatKz(r.total)])}
                foot={['Total', String(payments.reduce((s, r) => s + r.count, 0)), formatKz(payments.reduce((s, r) => s + r.total, 0))]} />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function sum(rows: ReportTaxRow[], k: 'net' | 'iva' | 'gross'): number {
  return rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
}

function Table({ head, rows, foot }: { head: string[]; rows: string[][]; foot?: string[] }) {
  if (rows.length === 0) return <div className="empty"><IconChart size={36} /><p>Sem dados no período.</p></div>;
  return (
    <table className="ptable">
      <thead><tr>{head.map((h, i) => <th key={i} style={i > 0 ? { textAlign: 'right' } : undefined}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j} style={j > 0 ? { textAlign: 'right' } : undefined}>{c}</td>)}</tr>
        ))}
      </tbody>
      {foot ? <tfoot><tr>{foot.map((c, j) => <th key={j} style={j > 0 ? { textAlign: 'right' } : undefined}>{c}</th>)}</tr></tfoot> : null}
    </table>
  );
}
