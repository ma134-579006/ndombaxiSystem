import React, { useCallback, useEffect, useState } from 'react';
import { runDownload } from '../components/feedback';
import { printSectionReport } from "../pdf/printDoc";
import { api, ApiError } from '../api/client';
import type {
  ManagerStore, ProfitPoint, ProfitProduct, ReportCashSession, ReportCategoryRow,
  ReportDocRow, ReportPaymentRow, ReportTaxRow, ReportUserRow,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { IconCalendar, IconChart, IconSearch } from '../components/Icons';
import { REPORT_TABS, type ReportTab } from './reportMenu';
import { AreaChart } from '../components/AreaChart';
import { ColumnChart } from '../components/ColumnChart';
import { DonutChart } from '../components/DonutChart';
import { formatKz, localIso } from '../format';

type Tab = ReportTab;
type TimeTab = 'hour' | 'weekday' | 'daily' | 'month';
const TIME_BY: Record<TimeTab, 'hour' | 'weekday' | 'day' | 'month'> = { hour: 'hour', weekday: 'weekday', daily: 'day', month: 'month' };
const WEEKDAY = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const isTime = (t: Tab): t is TimeTab => t === 'hour' || t === 'weekday' || t === 'daily' || t === 'month';
const TABS = REPORT_TABS;
type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'lastmonth' | 'year' | 'custom';
const PRESETS: { k: Preset; l: string }[] = [
  { k: 'today', l: 'Hoje' }, { k: 'yesterday', l: 'Ontem' }, { k: 'week', l: 'Últimos 7 dias' },
  { k: 'month', l: 'Mês' }, { k: 'lastmonth', l: 'Mês anterior' }, { k: 'year', l: 'Ano' }, { k: 'custom', l: 'Personalizado' },
];
const todayISO = (d = new Date()) => localIso(d);
const fmtDT = (s: string) => { try { return new Date(s).toLocaleString('pt-PT'); } catch { return s; } };
const PAY_LABEL: Record<string, string> = {
  CASH: 'Numerário', CARD: 'Multicaixa/Cartão', TRANSFER: 'Transferência',
  REFERENCE: 'Referência', EXPRESS: 'Multicaixa Express', CREDIT: 'A crédito', OUTRO: 'Outro', SEM_TURNO: 'Sem turno de caixa',
};
const DOC_LABEL: Record<string, string> = { FT: 'Fatura', FS: 'Fatura simplificada', NC: 'Nota de crédito', FR: 'Fatura-recibo' };

/** Centro de Relatórios (estilo Vendus): performance, contabilidade e caixa. */
/** Relatórios no formato do Vendus: o tipo escolhe-se no menu lateral (Gestão › Relatórios);
 *  a página tem a barra de filtros (Período, Lojas, Aplicar filtro), o gráfico com
 *  «Evolução / Top» e a tabela com totais e Imprimir / Exportar. */
export function Reports({ tab = 'product' }: { tab?: Tab } = {}) {
  const [preset, setPreset] = useState<Preset>('month');
  const [chartView, setChartView] = useState<'evo' | 'top'>('evo');
  const [from, setFrom] = useState(() => { const d = new Date(); return todayISO(new Date(d.getFullYear(), d.getMonth(), 1)); });
  const [to, setTo] = useState(todayISO());
  const [docType, setDocType] = useState('');
  const [storeId, setStoreId] = useState('');
  const [stores, setStores] = useState<ManagerStore[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tabs que suportam filtro por loja (multi-loja).
  const STORE_FILTERABLE: Tab[] = ['all', 'product', 'evolution', 'user', 'category', 'brand', 'tax', 'documents', 'customer', 'hour', 'weekday', 'daily', 'month'];

  const [byProduct, setByProduct] = useState<ProfitProduct[]>([]);
  const [byUser, setByUser] = useState<ReportUserRow[]>([]);
  const [byCustomer, setByCustomer] = useState<ReportUserRow[]>([]);
  const [byTime, setByTime] = useState<{ bucket: string; sales: number; net: number; gross: number }[]>([]);
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
      else if (tab === 'product') setByProduct(await api.profit.byProduct(from, to, sid));
      else if (tab === 'user') setByUser(await api.reports.salesByUser(from, to, sid));
      else if (tab === 'customer') setByCustomer(await api.reports.salesByCustomer(from, to, sid));
      else if (isTime(tab)) setByTime(await api.reports.salesByTime(TIME_BY[tab], from, to, sid));
      else if (tab === 'store') setByStore(await api.reports.salesByStore(from, to));
      else if (tab === 'category') setByCategory(await api.reports.salesByCategory(from, to, sid));
      else if (tab === 'brand') setByBrand(await api.reports.salesByBrand(from, to, sid));
      else if (tab === 'evolution') setSeries(await api.profit.series(from, to, sid));
      else if (tab === 'tax') setTax(await api.reports.taxMap(from, to, sid));
      else if (tab === 'payments') setPayments(await api.reports.paymentMethods(from, to));
      else if (tab === 'documents') setDocs(await api.reports.documents({ from, to, storeId: sid, docType: docType || undefined }));
      else if (tab === 'cashbox') setSessions(await api.reports.cashSessions(from, to));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar o relatório.');
    } finally { setLoading(false); }
  }, [tab, from, to, docType, sid]);

  useEffect(() => { void load(); }, [load]);

  const timeLabel = (b: string) => (tab === 'weekday' ? WEEKDAY[Number(b)] ?? b : tab === 'hour' ? `${b}h` : b);
  // Por hora / dias da semana: mostra TODOS os períodos (os sem vendas a zero), como no backoffice de referência.
  const timeRows = (() => {
    if (tab === 'hour') return Array.from({ length: 24 }, (_, h) => { const b = String(h).padStart(2, '0'); return byTime.find((r) => r.bucket === b) ?? { bucket: b, sales: 0, net: 0, gross: 0 }; });
    if (tab === 'weekday') return Array.from({ length: 7 }, (_, d) => { const b = String(d + 1); return byTime.find((r) => r.bucket === b) ?? { bucket: b, sales: 0, net: 0, gross: 0 }; });
    return byTime;
  })();
  const buildCsv = (): { name: string; csv: string } => {
    let headers: string[] = []; let rows: (string | number)[][] = [];
    if (tab === 'product') { headers = ['Produto', 'Qt', 'Vendas', 'Custo', 'Lucro', 'Margem%']; rows = byProduct.map((p) => [p.description, p.qty, p.salesNet, p.cost, p.profit, p.marginPct]); }
    else if (tab === 'user') { headers = ['Utilizador', 'Vendas', 'Líquido', 'Total']; rows = byUser.map((r) => [r.name, r.sales, r.net, r.gross]); }
    else if (tab === 'customer') { headers = ['Cliente', 'Vendas', 'Líquido', 'Total']; rows = byCustomer.map((r) => [r.name, r.sales, r.net, r.gross]); }
    else if (isTime(tab)) { headers = ['Período', 'Vendas', 'Líquido', 'Total']; rows = timeRows.map((r) => [timeLabel(r.bucket), r.sales, r.net, r.gross]); }
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
    void runDownload({ title: 'A exportar relatório', fileName: name, make: async () => new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }) });
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


  // Mini-dashboard por relatório (tempo real): o tipo de gráfico varia conforme
  // os dados — COLUNAS (rankings), ROSCA (composição/quota) e ÁREA (evolução).
  const reportChart: React.ReactNode = (() => {
    if (tab === 'product' && byProduct.length)
      return <ColumnChart data={byProduct.slice(0, 8).map((p) => ({ label: p.description, value: p.salesNet, hint: `${p.qty} un. · lucro ${formatKz(p.profit)}` }))} format={formatKz} />;
    if (tab === 'customer' && byCustomer.length)
      return <ColumnChart data={byCustomer.slice(0, 8).map((r) => ({ label: r.name, value: r.gross, hint: `${r.sales} venda(s)` }))} format={formatKz} />;
    if (isTime(tab) && timeRows.length)
      return tab === 'daily' || tab === 'month'
        ? <AreaChart points={timeRows.map((r) => ({ label: timeLabel(r.bucket), value: r.gross }))} format={formatKz} />
        : <ColumnChart data={timeRows.map((r) => ({ label: timeLabel(r.bucket), value: r.gross, hint: `${r.sales} venda(s)` }))} format={formatKz} />;
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

  const num = (v: unknown) => Number(v) || 0;
  const sum = <T,>(rows: T[], f: (r: T) => unknown) => rows.reduce((t, r) => t + num(f(r)), 0);
  const label = TABS.find((t) => t.key === tab)?.label ?? 'Relatório';
  const presetLabel = PRESETS.find((p) => p.k === preset)?.l ?? 'Período';

  // Período (como o seletor «Período» do Vendus): muda as datas e recarrega.
  const applyPreset = (p: Preset) => {
    setPreset(p);
    if (p === 'custom') return;
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const range: Record<Exclude<Preset, 'custom'>, [Date, Date]> = {
      today: [now, now],
      yesterday: [new Date(y, m, d - 1), new Date(y, m, d - 1)],
      week: [new Date(y, m, d - 6), now],
      month: [new Date(y, m, 1), now],
      lastmonth: [new Date(y, m - 1, 1), new Date(y, m, 0)],
      year: [new Date(y, 0, 1), now],
    };
    const [a, b] = range[p];
    setFrom(todayISO(a)); setTo(todayISO(b));
  };

  // Gráfico «Evolução» (vendas por dia no período) — carregado à parte, só quando é visto.
  const timeTab = isTime(tab);
  const hasToggle = !timeTab && tab !== 'evolution' && tab !== 'all';
  useEffect(() => {
    if (!hasToggle || chartView !== 'evo') return;
    let alive = true;
    api.profit.series(from, to, STORE_FILTERABLE.includes(tab) ? sid : undefined)
      .then((v) => { if (alive) setSeries(v); }).catch(() => { if (alive) setSeries([]); });
    return () => { alive = false; };
  }, [hasToggle, chartView, tab, from, to, sid]); // eslint-disable-line react-hooks/exhaustive-deps
  const evoChart = series.length ? <AreaChart points={series.map((p) => ({ label: p.bucket, value: p.salesNet }))} format={formatKz} /> : null;
  const chart = hasToggle ? (chartView === 'evo' ? evoChart : reportChart) : reportChart;

  const salesFoot = (rows: { sales?: number; qty?: number; net: number; gross: number }[], first: string, k: 'sales' | 'qty') =>
    [first, String(sum(rows, (r) => r[k])), formatKz(sum(rows, (r) => r.net)), formatKz(sum(rows, (r) => r.gross))];
  const tableTitle = tab === 'documents' ? 'Documentos' : tab === 'tax' ? 'Impostos' : tab === 'payments' ? 'Pagamentos' : tab === 'cashbox' ? 'Movimentos de Caixa' : 'Vendas';

  const table: React.ReactNode = (() => {
    if (tab === 'product') {
      return <Table head={['Produtos', 'Vendas c/IVA', 'Vendas', 'Custos', 'Resultado', 'Quantidade', 'Nº Vendas', 'Nº Rectificações']}
        rows={byProduct.map((p) => [p.description, formatKz(num(p.salesGross)), formatKz(p.salesNet), formatKz(p.cost), formatKz(p.profit), String(p.qty), String(p.sales ?? '—'), String(p.rectifications ?? 0)])}
        foot={['Total', formatKz(sum(byProduct, (p) => p.salesGross)), formatKz(sum(byProduct, (p) => p.salesNet)), formatKz(sum(byProduct, (p) => p.cost)), formatKz(sum(byProduct, (p) => p.profit)), String(Math.round(sum(byProduct, (p) => p.qty) * 1000) / 1000), String(sum(byProduct, (p) => p.sales)), String(sum(byProduct, (p) => p.rectifications))]} />;
    }
    if (tab === 'customer') return <Table head={['Clientes', 'Nº Vendas', 'Vendas', 'Vendas c/IVA']} rows={byCustomer.map((r) => [r.name, String(r.sales), formatKz(r.net), formatKz(r.gross)])} foot={salesFoot(byCustomer, 'Total', 'sales')} />;
    if (timeTab) return <Table head={[tab === 'hour' ? 'Hora' : tab === 'weekday' ? 'Dia da semana' : tab === 'month' ? 'Mês' : 'Dia', 'Nº Vendas', 'Vendas', 'Vendas c/IVA']} rows={timeRows.map((r) => [timeLabel(r.bucket), String(r.sales), formatKz(r.net), formatKz(r.gross)])} foot={salesFoot(timeRows, 'Total', 'sales')} />;
    if (tab === 'user') return <Table head={['Utilizadores', 'Nº Vendas', 'Vendas', 'Vendas c/IVA']} rows={byUser.map((r) => [r.name, String(r.sales), formatKz(r.net), formatKz(r.gross)])} foot={salesFoot(byUser, 'Total', 'sales')} />;
    if (tab === 'store') return <Table head={['Lojas', 'Nº Vendas', 'Vendas', 'Vendas c/IVA']} rows={byStore.map((r) => [r.name, String(r.sales), formatKz(r.net), formatKz(r.gross)])} foot={salesFoot(byStore, 'Total', 'sales')} />;
    if (tab === 'category') return <Table head={['Categorias', 'Quantidade', 'Vendas', 'Vendas c/IVA']} rows={byCategory.map((r) => [r.name, String(r.qty), formatKz(r.net), formatKz(r.gross)])} foot={salesFoot(byCategory, 'Total', 'qty')} />;
    if (tab === 'brand') return <Table head={['Marcas', 'Quantidade', 'Vendas', 'Vendas c/IVA']} rows={byBrand.map((r) => [r.name, String(r.qty), formatKz(r.net), formatKz(r.gross)])} foot={salesFoot(byBrand, 'Total', 'qty')} />;
    if (tab === 'evolution') return <Table head={['Data', 'Vendas', 'Custos', 'Resultado']} rows={series.map((p) => [p.bucket, formatKz(p.salesNet), formatKz(p.cost), formatKz(p.profit)])} foot={['Total', formatKz(sum(series, (p) => p.salesNet)), formatKz(sum(series, (p) => p.cost)), formatKz(sum(series, (p) => p.profit))]} />;
    if (tab === 'tax') return <Table head={['Taxa IVA', 'Base tributável', 'IVA', 'Total']} rows={tax.map((r) => [`${r.rate}%`, formatKz(r.net), formatKz(r.iva), formatKz(r.gross)])} foot={['Total', formatKz(sumTax(tax, 'net')), formatKz(sumTax(tax, 'iva')), formatKz(sumTax(tax, 'gross'))]} />;
    if (tab === 'payments') return <Table head={['Método de pagamento', 'Nº', 'Total']} rows={payments.map((r) => [PAY_LABEL[r.method] ?? r.method, String(r.count), formatKz(r.total)])} foot={['Total', String(sum(payments, (r) => r.count)), formatKz(sum(payments, (r) => r.total))]} />;
    if (tab === 'documents') return <Table head={['Documento', 'Tipo', 'Data', 'Loja', 'Operador', 'Total', 'Estado']} rows={docs.map((d) => [d.number, DOC_LABEL[d.doc_type] ?? d.doc_type, fmtDT(d.system_entry_date), d.store_name ?? '—', d.cashier_name ?? '—', formatKz(num(d.gross_total)), d.status === 'A' ? 'Anulada' : 'Válida'])} foot={[`${docs.length} documento(s)`, '', '', '', '', formatKz(sum(docs.filter((d) => d.status !== 'A'), (d) => d.gross_total)), '']} />;
    if (tab === 'cashbox') return <Table head={['Fecho', 'Loja', 'Operador', 'Fundo', 'Vendas', 'Suprim.', 'Sangrias', 'Contado', 'Diferença']} rows={sessions.map((x) => [fmtDT(x.closed_at), x.store_name ?? '—', x.opened_by_name ?? '—', formatKz(num(x.opening_float)), formatKz(num(x.total_sales)), formatKz(num(x.total_cash_in)), formatKz(num(x.total_cash_out)), formatKz(num(x.counted_cash)), formatKz(num(x.difference))])} foot={['Total', '', '', '', formatKz(sum(sessions, (x) => x.total_sales)), formatKz(sum(sessions, (x) => x.total_cash_in)), formatKz(sum(sessions, (x) => x.total_cash_out)), formatKz(sum(sessions, (x) => x.counted_cash)), formatKz(sum(sessions, (x) => x.difference))]} />;
    return null;
  })();

  const period = `${from.split('-').reverse().join('/')} a ${to.split('-').reverse().join('/')}`;
  const actions = (
    <span className="rp-bar-act no-print">
      <button type="button" className="vd-btn outline sm" onClick={() => void printSectionReport({ subtitle: period })}>Imprimir</button>
      <button type="button" className="vd-btn outline sm" onClick={() => void printSectionReport({ subtitle: period })}>Exportar PDF</button>
      <button type="button" className="vd-btn outline sm" onClick={csvExport}>Exportar CSV</button>
      <button type="button" className="vd-btn outline sm" onClick={() => void emailExport()}>Enviar por e-mail</button>
    </span>
  );

  return (
    <div className="vd-page reports-page">
      <div className="vd-head no-print">
        <p className="vd-crumb"><span style={{ color: 'var(--primary)' }}>Relatórios</span><span className="sep">/</span><span>{label}</span></p>
      </div>

      <form className="vd-card rp-search no-print" onSubmit={(e) => { e.preventDefault(); void load(); }}>
        <label className="rp-f"><span>Período</span>
          <select value={preset} onChange={(e) => applyPreset(e.target.value as Preset)}>
            {PRESETS.map((p) => <option key={p.k} value={p.k}>{p.l}</option>)}
          </select></label>
        {preset === 'custom' ? (
          <>
            <label className="rp-f"><span>De</span><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="rp-f"><span>Até</span><input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} /></label>
          </>
        ) : null}
        {isAdmin && stores.length > 1 && STORE_FILTERABLE.includes(tab) ? (
          <label className="rp-f"><span>Lojas</span>
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">Todas as lojas</option>
              {stores.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select></label>
        ) : null}
        {tab === 'documents' ? (
          <label className="rp-f"><span>Tipo de documento</span>
            <select value={docType} onChange={(e) => setDocType(e.target.value)}>
              <option value="">Todos</option>
              <option value="FT">Fatura (FT)</option>
              <option value="FS">Fatura simplificada (FS)</option>
              <option value="NC">Nota de crédito (NC)</option>
            </select></label>
        ) : null}
        <button type="submit" className="vd-btn rp-apply" disabled={loading}><IconSearch size={16} /> {loading ? 'A carregar…' : 'Aplicar filtro'}</button>
      </form>

      {error ? <div className="vd-err no-print" role="alert">{error}</div> : null}

      {/* Título + período (só na impressão — o cabeçalho da empresa vem do Shell) */}
      <div className="print-only doc-print-sub">
        <span className="dph-title">{label}</span>
        <span className="dph-period"> · Período: {period}</span>
      </div>

      <section className="vd-card rp-box no-print" aria-label="Gráfico">
        <div className="rp-bar">
          <span className="rp-bar-t"><IconCalendar size={18} /> {presetLabel}: {from} a {to}</span>
          {hasToggle ? (
            <span className="rp-seg" role="group" aria-label="Tipo de gráfico">
              <button type="button" className={chartView === 'evo' ? 'on' : ''} aria-pressed={chartView === 'evo'} onClick={() => setChartView('evo')}><IconTrend /> Evolução</button>
              <button type="button" className={chartView === 'top' ? 'on' : ''} aria-pressed={chartView === 'top'} onClick={() => setChartView('top')}><IconChart size={16} /> Top</button>
            </span>
          ) : null}
        </div>
        <div className="rp-body">
          {loading ? <div className="loading">A carregar…</div> : chart ?? <div className="empty"><IconChart size={36} /><p>Sem dados no período.</p></div>}
        </div>
      </section>

      <section className="vd-card rp-box" aria-label={tableTitle}>
        <div className="rp-bar"><span className="rp-bar-t">{tableTitle}</span>{actions}</div>
        <div className="rp-body">{loading ? <div className="loading">A carregar…</div> : table}</div>
      </section>
    </div>
  );
}

function IconTrend() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 4H3a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1zm-1 14H4v-2.6l4.2-3.8 3.6 2.9a1 1 0 0 0 1.3 0L20 8.4z" /></svg>;
}

function sumTax(rows: ReportTaxRow[], k: 'net' | 'iva' | 'gross'): number {
  return rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
}

function Table({ head, rows, foot }: { head: string[]; rows: string[][]; foot?: string[] }) {
  if (rows.length === 0) return <div className="empty"><IconChart size={36} /><p>Sem dados no período.</p></div>;
  return (
    <table className="ptable stack">
      <thead><tr>{head.map((h, i) => <th key={i} className={i > 0 ? 'num' : undefined}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j} data-label={head[j]} className={j > 0 ? 'num' : undefined}>{c}</td>)}</tr>
        ))}
      </tbody>
      {foot ? <tfoot><tr>{foot.map((c, j) => <th key={j} className={j > 0 ? 'num' : undefined}>{c}</th>)}</tr></tfoot> : null}
    </table>
  );
}
