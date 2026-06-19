import React, { useCallback, useEffect, useState } from 'react';
import { printSectionReport } from "../pdf/printDoc";
import { api, ApiError } from '../api/client';
import type {
  ManagerStore, ProfitPoint, ProfitProduct, ReportCashSession, ReportCategoryRow,
  ReportDocRow, ReportPaymentRow, ReportTaxRow, ReportUserRow,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { IconChart } from '../components/Icons';
import { AreaChart } from '../components/AreaChart';
import { ColumnChart } from '../components/ColumnChart';
import { DonutChart } from '../components/DonutChart';
import { formatKz } from '../format';

type Tab = 'all' | 'product' | 'user' | 'store' | 'category' | 'brand' | 'evolution' | 'tax' | 'payments' | 'documents' | 'cashbox';
const TABS: { key: Tab; label: string; group: string }[] = [
  { key: 'all', label: 'Tudo (resumo)', group: 'Vendas' },
  { key: 'product', label: 'Por produto', group: 'Vendas' },
  { key: 'user', label: 'Por utilizador', group: 'Vendas' },
  { key: 'store', label: 'Por loja', group: 'Vendas' },
  { key: 'category', label: 'Por categoria', group: 'Vendas' },
  { key: 'brand', label: 'Por marca', group: 'Vendas' },
  { key: 'evolution', label: 'Evolução temporal', group: 'Vendas' },
  { key: 'documents', label: 'Documentos', group: 'Contabilidade' },
  { key: 'tax', label: 'Mapa de IVA', group: 'Contabilidade' },
  { key: 'cashbox', label: 'Fecho de caixa', group: 'Caixa' },
  { key: 'payments', label: 'Métodos de pagamento', group: 'Caixa' },
];
const todayISO = (d = new Date()) => d.toISOString().slice(0, 10);
const fmtDT = (s: string) => { try { return new Date(s).toLocaleString('pt-PT'); } catch { return s; } };
const PAY_LABEL: Record<string, string> = {
  CASH: 'Dinheiro', CARD: 'Multibanco/Cartão', TRANSFER: 'Transferência',
  REFERENCE: 'Referência', EXPRESS: 'Express', CREDIT: 'A crédito', OUTRO: 'Outro',
};
const DOC_LABEL: Record<string, string> = { FT: 'Fatura', FS: 'Fatura simplificada', NC: 'Nota de crédito', FR: 'Fatura-recibo' };

/** Centro de Relatórios (estilo Vendus): performance, contabilidade e caixa. */
export function Reports() {
  const [tab, setTab] = useState<Tab>('product');
  const [from, setFrom] = useState(todayISO(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(todayISO());
  const [docType, setDocType] = useState('');
  const [storeId, setStoreId] = useState('');
  const [stores, setStores] = useState<ManagerStore[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tabs que suportam filtro por loja (multi-loja).
  const STORE_FILTERABLE: Tab[] = ['all', 'user', 'category', 'brand', 'tax', 'documents'];

  const [byProduct, setByProduct] = useState<ProfitProduct[]>([]);
  const [byUser, setByUser] = useState<ReportUserRow[]>([]);
  const [byStore, setByStore] = useState<ReportUserRow[]>([]);
  const [byCategory, setByCategory] = useState<ReportCategoryRow[]>([]);
  const [byBrand, setByBrand] = useState<ReportCategoryRow[]>([]);
  const [series, setSeries] = useState<ProfitPoint[]>([]);
  const [tax, setTax] = useState<ReportTaxRow[]>([]);
  const [payments, setPayments] = useState<ReportPaymentRow[]>([]);
  const [docs, setDocs] = useState<ReportDocRow[]>([]);
  const [sessions, setSessions] = useState<ReportCashSession[]>([]);

  const { user } = useAuth();
  // Só o ADMIN DA EMPRESA (gestor principal) vê todas as lojas e o seletor.
  const isAdmin = user?.role === 'COMPANY_ADMIN';
  useEffect(() => { if (isAdmin) api.staff.listStores().then(setStores).catch(() => undefined); }, [isAdmin]);
  const sid = storeId || undefined;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (tab === 'all') {
        const [p, u, s, c, b, ev, pay] = await Promise.all([
          api.profit.byProduct(from, to),
          api.reports.salesByUser(from, to, sid),
          api.reports.salesByStore(from, to),
          api.reports.salesByCategory(from, to, sid),
          api.reports.salesByBrand(from, to, sid),
          api.profit.series(from, to),
          api.reports.paymentMethods(from, to),
        ]);
        setByProduct(p); setByUser(u); setByStore(s); setByCategory(c); setByBrand(b); setSeries(ev); setPayments(pay);
      }
      else if (tab === 'product') setByProduct(await api.profit.byProduct(from, to));
      else if (tab === 'user') setByUser(await api.reports.salesByUser(from, to, sid));
      else if (tab === 'store') setByStore(await api.reports.salesByStore(from, to));
      else if (tab === 'category') setByCategory(await api.reports.salesByCategory(from, to, sid));
      else if (tab === 'brand') setByBrand(await api.reports.salesByBrand(from, to, sid));
      else if (tab === 'evolution') setSeries(await api.profit.series(from, to));
      else if (tab === 'tax') setTax(await api.reports.taxMap(from, to, sid));
      else if (tab === 'payments') setPayments(await api.reports.paymentMethods(from, to));
      else if (tab === 'documents') setDocs(await api.reports.documents({ from, to, storeId: sid, docType: docType || undefined }));
      else if (tab === 'cashbox') setSessions(await api.reports.cashSessions(from, to));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar o relatório.');
    } finally { setLoading(false); }
  }, [tab, from, to, docType, sid]);

  useEffect(() => { void load(); }, [load]);

  const buildCsv = (): { name: string; csv: string } => {
    let headers: string[] = []; let rows: (string | number)[][] = [];
    if (tab === 'product') { headers = ['Produto', 'Qt', 'Vendas', 'Custo', 'Lucro', 'Margem%']; rows = byProduct.map((p) => [p.description, p.qty, p.salesNet, p.cost, p.profit, p.marginPct]); }
    else if (tab === 'user') { headers = ['Utilizador', 'Vendas', 'Líquido', 'Total']; rows = byUser.map((r) => [r.name, r.sales, r.net, r.gross]); }
    else if (tab === 'store') { headers = ['Loja', 'Vendas', 'Líquido', 'Total']; rows = byStore.map((r) => [r.name, r.sales, r.net, r.gross]); }
    else if (tab === 'category') { headers = ['Categoria', 'Qt', 'Líquido', 'Total']; rows = byCategory.map((r) => [r.name, r.qty, r.net, r.gross]); }
    else if (tab === 'brand') { headers = ['Marca', 'Qt', 'Líquido', 'Total']; rows = byBrand.map((r) => [r.name, r.qty, r.net, r.gross]); }
    else if (tab === 'evolution') { headers = ['Data', 'Vendas', 'Custo', 'Lucro']; rows = series.map((p) => [p.bucket, p.salesNet, p.cost, p.profit]); }
    else if (tab === 'tax') { headers = ['Taxa IVA%', 'Base', 'IVA', 'Total']; rows = tax.map((r) => [r.rate, r.net, r.iva, r.gross]); }
    else if (tab === 'payments') { headers = ['Método', 'Nº', 'Total']; rows = payments.map((r) => [PAY_LABEL[r.method] ?? r.method, r.count, r.total]); }
    else if (tab === 'documents') { headers = ['Documento', 'Tipo', 'Data', 'NIF', 'Loja', 'Operador', 'Base', 'IVA', 'Total', 'Estado']; rows = docs.map((d) => [d.number, d.doc_type, fmtDT(d.system_entry_date), d.customer_tax_id ?? '', d.store_name ?? '', d.cashier_name ?? '', d.net_total, d.iva_total, d.gross_total, d.status === 'A' ? 'Anulada' : 'Válida']); }
    else if (tab === 'cashbox') { headers = ['Fecho', 'Loja', 'Abertura por', 'Fundo', 'Vendas', 'Suprimentos', 'Sangrias', 'Contado', 'Esperado', 'Diferença']; rows = sessions.map((s) => [fmtDT(s.closed_at), s.store_name ?? '', s.opened_by_name ?? '', s.opening_float, s.total_sales, s.total_cash_in, s.total_cash_out, s.counted_cash, s.expected_cash, s.difference]); }
    const csv = [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    return { name: `relatorio-${tab}-${from}-a-${to}.csv`, csv };
  };

  const csvExport = () => {
    const { name, csv } = buildCsv();
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
  };

  const emailExport = async () => {
    const { name, csv } = buildCsv();
    const title = TABS.find((t) => t.key === tab)?.label ?? 'Relatório';
    const subject = `Relatório ${title} (${from} a ${to})`;
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean; share?: (d: unknown) => Promise<void> };
    try {
      const file = new File(['﻿' + csv], name, { type: 'text/csv' });
      if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: subject, text: subject });
        return;
      }
    } catch { /* cai para mailto */ }
    // Fallback: descarrega o CSV e abre o cliente de e-mail (anexar o ficheiro).
    csvExport();
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent('Segue em anexo o relatório (ficheiro descarregado: ' + name + ').')}`;
  };

  const groups = ['Vendas', 'Contabilidade', 'Caixa'];

  // Mini-dashboard por relatório (tempo real): o tipo de gráfico varia conforme
  // os dados — COLUNAS (rankings), ROSCA (composição/quota) e ÁREA (evolução).
  const reportChart: React.ReactNode = (() => {
    if (tab === 'product' && byProduct.length)
      return <ColumnChart data={byProduct.slice(0, 8).map((p) => ({ label: p.description, value: p.salesNet, hint: `${p.qty} un. · lucro ${formatKz(p.profit)}` }))} format={formatKz} />;
    if (tab === 'user' && byUser.length)
      return <ColumnChart data={byUser.slice(0, 8).map((r) => ({ label: r.name, value: r.gross, hint: `${r.sales} venda(s)` }))} color="var(--accent)" format={formatKz} />;
    if (tab === 'store' && byStore.length)
      return <ColumnChart data={byStore.map((r) => ({ label: r.name, value: r.gross, hint: `${r.sales} venda(s)` }))} format={formatKz} />;
    if (tab === 'category' && byCategory.length)
      return <DonutChart data={byCategory.slice(0, 9).map((r) => ({ label: r.name, value: r.gross }))} centerLabel="Total" format={formatKz} />;
    if (tab === 'brand' && byBrand.length)
      return <DonutChart data={byBrand.slice(0, 9).map((r) => ({ label: r.name, value: r.gross }))} centerLabel="Total" format={formatKz} />;
    if (tab === 'evolution' && series.length)
      return <AreaChart points={series.map((p) => ({ label: p.bucket, value: p.salesNet, sub: p.cost }))} subColor="var(--warning)" subLabel="Custo" format={formatKz} />;
    if (tab === 'tax' && tax.length)
      return <DonutChart data={tax.map((r) => ({ label: `IVA ${r.rate}%`, value: r.iva }))} centerLabel="IVA total" format={formatKz} />;
    if (tab === 'payments' && payments.length)
      return <DonutChart data={payments.map((r) => ({ label: PAY_LABEL[r.method] ?? r.method, value: r.total }))} centerLabel="Total" format={formatKz} />;
    return null;
  })();

  return (
    <div className="reports-page">
      <div className="content-head no-print">
        <h2>Relatórios</h2>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={csvExport}>⬇ CSV/Excel</button>
        <button className="btn sm ghost" onClick={() => void emailExport()}>✉ E-mail</button>
        <button className="btn sm ghost" onClick={() => void printSectionReport()}>🖨 Imprimir/PDF</button>
      </div>

      <div className="card no-print" style={{ marginBottom: 12 }}>
        {groups.map((g) => (
          <div key={g} style={{ marginBottom: 8 }}>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', margin: '2px 0 6px' }}>{g}</div>
            <div className="chip-row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {TABS.filter((t) => t.group === g).map((t) => (
                <button key={t.key} className={`chip${tab === t.key ? ' on' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
              ))}
            </div>
          </div>
        ))}
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
          <div className="field" style={{ margin: 0 }}><label>Data inicial</label>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="field" style={{ margin: 0 }}><label>Data final</label>
            <input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} /></div>
          {isAdmin && stores.length > 1 && STORE_FILTERABLE.includes(tab) ? (
            <div className="field" style={{ margin: 0 }}><label>Loja</label>
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                <option value="">Todas as lojas</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
          ) : null}
          {tab === 'documents' ? (
            <div className="field" style={{ margin: 0 }}><label>Tipo de documento</label>
              <select value={docType} onChange={(e) => setDocType(e.target.value)}>
                <option value="">Todos</option>
                <option value="FT">Fatura (FT)</option>
                <option value="FS">Fatura simplificada (FS)</option>
                <option value="NC">Nota de crédito (NC)</option>
              </select></div>
          ) : null}
          <button className="btn sm" onClick={() => void load()} disabled={loading}>{loading ? 'A carregar…' : 'Atualizar'}</button>
        </div>
      </div>

      {error ? <div className="banner danger no-print">{error}</div> : null}

      {/* Título + período (só na impressão — o cabeçalho da empresa vem do Shell) */}
      <div className="print-only doc-print-sub">
        <span className="dph-title">{TABS.find((t) => t.key === tab)?.label}</span>
        <span className="dph-period"> · Período: {new Date(from).toLocaleDateString('pt-PT')} a {new Date(to).toLocaleDateString('pt-PT')}</span>
      </div>

      {!loading && reportChart ? (
        <div className="card no-print" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>
            {TABS.find((t) => t.key === tab)?.label}
            <span className="muted" style={{ fontWeight: 500, fontSize: 13 }}> · vista gráfica</span>
          </h3>
          {reportChart}
        </div>
      ) : null}

      {tab === 'all' ? (
        loading ? <div className="card"><div className="loading">A carregar…</div></div> : (
          <>
            <ReportCard title="Por produto"><Table head={['Produto', 'Qt', 'Vendas', 'Custo', 'Lucro', 'Margem']}
              rows={byProduct.map((p) => [p.description, String(p.qty), formatKz(p.salesNet), formatKz(p.cost), formatKz(p.profit), `${p.marginPct}%`])} /></ReportCard>
            <ReportCard title="Por utilizador"><Table head={['Utilizador', 'Nº vendas', 'Líquido', 'Total faturado']}
              rows={byUser.map((r) => [r.name, String(r.sales), formatKz(r.net), formatKz(r.gross)])} /></ReportCard>
            <ReportCard title="Por loja"><Table head={['Loja', 'Nº vendas', 'Líquido', 'Total faturado']}
              rows={byStore.map((r) => [r.name, String(r.sales), formatKz(r.net), formatKz(r.gross)])} /></ReportCard>
            <ReportCard title="Por categoria"><Table head={['Categoria', 'Quantidade', 'Líquido', 'Total']}
              rows={byCategory.map((r) => [r.name, String(r.qty), formatKz(r.net), formatKz(r.gross)])} /></ReportCard>
            <ReportCard title="Por marca"><Table head={['Marca', 'Quantidade', 'Líquido', 'Total']}
              rows={byBrand.map((r) => [r.name, String(r.qty), formatKz(r.net), formatKz(r.gross)])} /></ReportCard>
            <ReportCard title="Evolução temporal"><Table head={['Data', 'Vendas', 'Custo', 'Lucro']}
              rows={series.map((p) => [p.bucket, formatKz(p.salesNet), formatKz(p.cost), formatKz(p.profit)])} /></ReportCard>
            <ReportCard title="Métodos de pagamento"><Table head={['Método de pagamento', 'Nº', 'Total']}
              rows={payments.map((r) => [PAY_LABEL[r.method] ?? r.method, String(r.count), formatKz(r.total)])} /></ReportCard>
          </>
        )
      ) : (
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
            {tab === 'store' ? (
              <Table head={['Loja', 'Nº vendas', 'Líquido', 'Total faturado']}
                rows={byStore.map((r) => [r.name, String(r.sales), formatKz(r.net), formatKz(r.gross)])} />
            ) : null}
            {tab === 'category' ? (
              <Table head={['Categoria', 'Quantidade', 'Líquido', 'Total']}
                rows={byCategory.map((r) => [r.name, String(r.qty), formatKz(r.net), formatKz(r.gross)])} />
            ) : null}
            {tab === 'brand' ? (
              <Table head={['Marca', 'Quantidade', 'Líquido', 'Total']}
                rows={byBrand.map((r) => [r.name, String(r.qty), formatKz(r.net), formatKz(r.gross)])} />
            ) : null}
            {tab === 'evolution' ? (
              <Table head={['Data', 'Vendas', 'Custo', 'Lucro']}
                rows={series.map((p) => [p.bucket, formatKz(p.salesNet), formatKz(p.cost), formatKz(p.profit)])} />
            ) : null}
            {tab === 'tax' ? (
              <Table head={['Taxa IVA', 'Base tributável', 'IVA', 'Total']}
                rows={tax.map((r) => [`${r.rate}%`, formatKz(r.net), formatKz(r.iva), formatKz(r.gross)])}
                foot={['Total', formatKz(sumTax(tax, 'net')), formatKz(sumTax(tax, 'iva')), formatKz(sumTax(tax, 'gross'))]} />
            ) : null}
            {tab === 'payments' ? (
              <Table head={['Método de pagamento', 'Nº', 'Total']}
                rows={payments.map((r) => [PAY_LABEL[r.method] ?? r.method, String(r.count), formatKz(r.total)])}
                foot={['Total', String(payments.reduce((s, r) => s + r.count, 0)), formatKz(payments.reduce((s, r) => s + r.total, 0))]} />
            ) : null}
            {tab === 'documents' ? (
              <Table head={['Documento', 'Tipo', 'Data', 'Loja', 'Operador', 'Total', 'Estado']}
                rows={docs.map((d) => [d.number, DOC_LABEL[d.doc_type] ?? d.doc_type, fmtDT(d.system_entry_date), d.store_name ?? '—', d.cashier_name ?? '—', formatKz(Number(d.gross_total)), d.status === 'A' ? 'Anulada' : 'Válida'])} />
            ) : null}
            {tab === 'cashbox' ? (
              <Table head={['Fecho', 'Loja', 'Operador', 'Fundo', 'Vendas', 'Suprim.', 'Sangrias', 'Contado', 'Diferença']}
                rows={sessions.map((s) => [fmtDT(s.closed_at), s.store_name ?? '—', s.opened_by_name ?? '—', formatKz(Number(s.opening_float)), formatKz(Number(s.total_sales)), formatKz(Number(s.total_cash_in)), formatKz(Number(s.total_cash_out)), formatKz(Number(s.counted_cash)), formatKz(Number(s.difference))])} />
            ) : null}
          </>
        )}
      </div>
      )}

      {/* Rodapé da empresa na impressão: vem do Shell (PrintBrandFoot). */}
    </div>
  );
}

function ReportCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {children}
    </div>
  );
}

function sumTax(rows: ReportTaxRow[], k: 'net' | 'iva' | 'gross'): number {
  return rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
}

function Table({ head, rows, foot }: { head: string[]; rows: string[][]; foot?: string[] }) {
  if (rows.length === 0) return <div className="empty"><IconChart size={36} /><p>Sem dados no período.</p></div>;
  return (
    <table className="ptable stack">
      <thead><tr>{head.map((h, i) => <th key={i} style={i > 0 ? { textAlign: 'right' } : undefined}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j} data-label={head[j]} style={j > 0 ? { textAlign: 'right' } : undefined}>{c}</td>)}</tr>
        ))}
      </tbody>
      {foot ? <tfoot><tr>{foot.map((c, j) => <th key={j} style={j > 0 ? { textAlign: 'right' } : undefined}>{c}</th>)}</tr></tfoot> : null}
    </table>
  );
}
