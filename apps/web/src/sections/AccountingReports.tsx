import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { AccDailySales, AccDocuments, AccPaymentTypes, AccProductLines, AccSupplierTaxMap, AccTaxMap, AccTaxRow, ManagerStore } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { runDownload } from '../components/feedback';
import { IconSearch } from '../components/Icons';
import { formatKz, localIso } from '../format';
import { printSectionReport } from '../pdf/printDoc';
import { ACC_TABS, type AccTab } from './accMenu';


const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DOC_LABEL: Record<string, string> = {
  FT: 'Fatura', FR: 'Fatura Recibo', FS: 'Fatura Simplificada', ND: 'Nota de Débito', NC: 'Nota de Crédito',
  RC: 'Recibo', PF: 'Fatura Pró-Forma', OR: 'Orçamento', GR: 'Guia de Remessa', GT: 'Guia de Transporte',
};
const ALL_TYPES = ['FT', 'FR', 'FS', 'ND', 'NC', 'RC', 'PF', 'OR', 'GR', 'GT'];
const FISCAL_TYPES = ['FT', 'FR', 'FS', 'ND', 'NC'];
const PAY_LABEL: Record<string, string> = {
  CASH: 'Dinheiro', CARD: 'Multicaixa/Cartão', TRANSFER: 'Transferência Bancária', REFERENCE: 'Referência',
  EXPRESS: 'Multicaixa Express', CREDIT: 'Conta Corrente', SEM_TURNO: 'Sem turno de caixa', OUTRO: 'Outro',
};
const PAY_ORDER = ['CASH', 'CARD', 'EXPRESS', 'TRANSFER', 'REFERENCE', 'CREDIT', 'OUTRO', 'SEM_TURNO'];

const pct = (r: number) => `${Number(r).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const dmy = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const dmyhm = (s: string) => { const d = new Date(s); return `${d.toLocaleDateString('pt-PT')} ${d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`; };
const qtyFmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();

type Data =
  | { tab: 'acc-documents'; d: AccDocuments } | { tab: 'acc-taxmap'; d: AccTaxMap } | { tab: 'acc-products'; d: AccProductLines }
  | { tab: 'acc-daily'; d: AccDailySales } | { tab: 'acc-payments'; d: AccPaymentTypes } | { tab: 'acc-suppliers'; d: AccSupplierTaxMap };

/** Contabilidade › relatório, no layout do Vendus: caminho, filtros (Ano, Mês, Loja,
 *  «Personalizar Datas»), Imprimir / Download PDF / Exportar CSV e as tabelas. */
export function AccountingReports({ tab }: { tab: AccTab }) {
  const now = new Date();
  const label = ACC_TABS.find((t) => t.key === tab)?.label ?? 'Contabilidade';
  const daily = tab === 'acc-daily';
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [custom, setCustom] = useState(daily);
  const [from, setFrom] = useState(daily ? localIso(now) : localIso(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(localIso(now));
  const [types, setTypes] = useState<string[]>(FISCAL_TYPES);
  const [storeId, setStoreId] = useState('');
  const [stores, setStores] = useState<ManagerStore[]>([]);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === 'COMPANY_ADMIN';
  useEffect(() => { if (isAdmin) api.staff.listStores().then(setStores).catch(() => undefined); }, [isAdmin]);

  const range = useCallback((): { f: string; t: string } => {
    if (custom) return { f: from, t: to };
    const mm = String(month).padStart(2, '0');
    return { f: `${year}-${mm}-01`, t: `${year}-${mm}-${String(lastDay(year, month)).padStart(2, '0')}` };
  }, [custom, from, to, year, month]);

  const load = useCallback(async () => {
    const { f, t } = range();
    const sid = storeId || undefined;
    setLoading(true); setError(null);
    try {
      const A = api.reports.accounting;
      if (tab === 'acc-documents') setData({ tab, d: await A.documents({ from: f, to: t, storeId: sid, types }) });
      else if (tab === 'acc-taxmap') setData({ tab, d: await A.taxMap(f, t, sid) });
      else if (tab === 'acc-products') setData({ tab, d: await A.products(f, t, sid) });
      else if (tab === 'acc-daily') setData({ tab, d: await A.dailySales(f, t, sid) });
      else if (tab === 'acc-payments') setData({ tab, d: await A.paymentTypes(f, t, sid) });
      else setData({ tab, d: await A.supplierTaxMap(f, t) });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar o relatório.');
    } finally { setLoading(false); }
  }, [tab, range, storeId, types]);
  // Carrega ao abrir; depois só com «Aplicar Filtro» (como no Vendus).
  useEffect(() => { void load(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const { f, t } = range();
  const period = `${dmy(f)} a ${dmy(t)}`;
  const crumbTail = custom ? `${f} a ${t}` : String(year);
  const years: number[] = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 6; y--) years.push(y);
  const showStores = isAdmin && stores.length > 1 && tab !== 'acc-suppliers';

  const csv = (): string[][] => {
    if (!data) return [];
    if (data.tab === 'acc-documents') return [['Data', 'Documento', 'Tipo', 'Tipos de Pagamento', 'Cliente', 'NIF', 'IVA', 'Líquido', 'Imposto', 'Total', 'Estado'],
      ...data.d.rows.map((r) => [dmy(r.date), r.number, DOC_LABEL[r.doc_type] ?? r.doc_type, PAY_LABEL[r.method] ?? r.method, r.customer_name ?? 'Consumidor Final', r.customer_tax_id ?? '', r.taxes.map((x) => `AO ${x.code} ${x.rate}% ${x.iva}`).join(' | '), String(r.net), String(r.iva), String(r.gross), r.status === 'A' ? 'Anulado' : 'Normal'])];
    if (data.tab === 'acc-taxmap') return [['Tipo', 'Região', 'Código', 'Taxa', 'Nº de Documentos', 'IVA', 'Base de Incidência', 'Total'],
      ...data.d.rows.map((r) => ['Todos', 'AO', r.code, String(r.rate), String(r.docs), String(r.iva), String(r.base), String(r.total)]),
      ...data.d.byType.map((r) => [DOC_LABEL[r.doc_type ?? ''] ?? r.doc_type ?? '', 'AO', r.code, String(r.rate), String(r.docs), String(r.iva), String(r.base), String(r.total)])];
    if (data.tab === 'acc-products') return [['Documento', 'Cliente', 'Data', 'Referência', 'Produto', 'Qtd.', 'Região', 'Código', 'Taxa', 'Valor IVA', 'P. Base', 'P. Unitário', 'Total'],
      ...data.d.rows.map((r) => [r.number, r.customer_name ?? 'Consumidor Final', dmyhm(r.at), r.code, r.description, String(r.qty), 'AO', r.iva_code, String(r.rate), String(r.iva), String(r.base), String(r.unit), String(r.total)])];
    if (data.tab === 'acc-daily') return [['Loja', 'Referência', 'Produto', 'Quantidade', 'Total', 'Total PVP'], ...data.d.rows.map((r) => [r.store_name, r.code, r.description, String(r.qty), String(r.net), String(r.gross)])];
    if (data.tab === 'acc-payments') return [['Loja', 'Caixa', 'Tipo de Pagamento', 'Quantidade', 'Total'], ...data.d.rows.map((r) => [r.store_name, r.register, PAY_LABEL[r.method] ?? r.method, String(r.count), String(r.total)])];
    return [['Imposto', 'Taxa', 'Nº de Produtos', 'IVA', 'Base de Incidência', 'Total'], ...data.d.rows.map((r) => [r.label, String(r.rate), String(r.products), String(r.iva), String(r.base), String(r.total)])];
  };
  const exportCsv = () => {
    const cell = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const body = csv().map((r) => r.map(cell).join(';')).join('\r\n');
    void runDownload({ title: 'A exportar relatório', fileName: `contabilidade-${tab.slice(4)}-${f}-a-${t}.csv`, make: async () => new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' }) });
  };

  return (
    <div className="vd-page acc-page">
      <div className="vd-head no-print">
        <p className="vd-crumb"><span style={{ color: 'var(--primary)' }}>Contabilidade</span><span className="sep">/</span><span style={{ color: 'var(--primary)' }}>{label}</span><span className="sep">/</span><span>{crumbTail}</span></p>
      </div>

      <form className="vd-card rp-search acc-search no-print" onSubmit={(e) => { e.preventDefault(); void load(); }}>
        <div className="acc-fields">
          {custom ? (
            <label className="rp-f acc-range"><span>Intervalo de Datas</span>
              <span className="acc-dates">
                <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="Data de início" />
                <span className="acc-ate">até</span>
                <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="Data de fim" />
              </span></label>
          ) : (
            <>
              <label className="rp-f acc-year"><span>Ano</span>
                <select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
              <label className="rp-f acc-month"><span>Mês</span>
                <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
            </>
          )}
          {tab === 'acc-documents' ? <TypePicker value={types} onChange={setTypes} /> : null}
          {showStores ? (
            <label className="rp-f"><span>{daily ? 'Lojas' : 'Loja'}</span>
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                <option value="">{daily ? '-- Todas as Lojas --' : 'Todas'}</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></label>
          ) : null}
          <button type="submit" className="vd-btn rp-apply acc-apply" disabled={loading}><IconSearch size={16} /> {loading ? 'A carregar…' : 'Aplicar Filtro'}</button>
          {!daily ? <button type="button" className="acc-custom" onClick={() => setCustom((c) => !c)}>{custom ? 'Por Ano e Mês' : 'Personalizar Datas'}</button> : null}
        </div>
        <div className="acc-actions">
          <button type="button" className="vd-btn outline sm" onClick={() => void printSectionReport({ title: label, subtitle: period })}>Imprimir</button>
          <button type="button" className="vd-btn outline sm" onClick={() => void printSectionReport({ title: label, subtitle: period })}>Download PDF</button>
          <button type="button" className="vd-btn outline sm" onClick={exportCsv} disabled={!data}>Exportar CSV</button>
        </div>
      </form>

      {error ? <div className="vd-err no-print" role="alert">{error}</div> : null}
      <div className="print-only doc-print-sub"><span className="dph-title">{label}</span><span className="dph-period"> · Período: {period}</span></div>

      {loading && !data ? <div className="vd-card acc-box"><div className="vd-empty">A carregar…</div></div>
        : data && data.tab === tab ? <Body data={data} period={period} loading={loading} /> : null}
    </div>
  );
}

/** Seletor de «Tipos de Documentos» (lista com caixas, como o do Vendus). */
function TypePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((x) => x !== k) : ALL_TYPES.filter((x) => x === k || value.includes(x)));
  return (
    <div className="rp-f acc-types"><span>Tipos de Documentos</span>
      <details ref={ref}>
        <summary>{value.length} Tipos Documento(s)</summary>
        <div className="acc-types-list">
          <button type="button" onClick={() => onChange(value.length === ALL_TYPES.length ? FISCAL_TYPES : ALL_TYPES)}>{value.length === ALL_TYPES.length ? 'Só documentos fiscais' : 'Selecionar todos'}</button>
          {ALL_TYPES.map((k) => (
            <label key={k}><input type="checkbox" checked={value.includes(k)} onChange={() => toggle(k)} /> {DOC_LABEL[k]}</label>
          ))}
        </div>
      </details>
    </div>
  );
}

function Empty() { return <div className="vd-empty">Não existem registos no período.</div>; }

/** Listas longas em páginas de 100 linhas (como o Vendus): milhares de linhas de uma
 *  vez bloqueavam o navegador vários segundos. O CSV exporta sempre tudo. */
const PAGE = 100;
function usePage<T>(rows: T[]): { slice: T[]; pager: React.ReactNode } {
  const [p, setP] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(p, pages - 1);
  const slice = rows.slice(cur * PAGE, cur * PAGE + PAGE);
  const go = (n: number) => { setP(n); document.querySelector('.acc-page')?.scrollIntoView({ block: 'start' }); };
  const pager = pages > 1 ? (
    <nav className="acc-pager" aria-label="Páginas">
      <button type="button" className="vd-btn plain sm" onClick={() => go(cur - 1)} disabled={cur === 0}>Anterior</button>
      <span>Página {cur + 1} de {pages} · {rows.length} registos</span>
      <button type="button" className="vd-btn plain sm" onClick={() => go(cur + 1)} disabled={cur >= pages - 1}>Seguinte</button>
    </nav>
  ) : null;
  return { slice, pager };
}

function Body({ data, period, loading }: { data: Data; period: string; loading: boolean }) {
  const cls = `acc-body${loading ? ' is-loading' : ''}`;
  if (data.tab === 'acc-documents') return <DocsBody d={data.d} cls={cls} />;
  if (data.tab === 'acc-products') return <LinesBody d={data.d} cls={cls} />;
  if (data.tab === 'acc-daily') return <DailyBody rows={data.d.rows} cls={cls} />;
  return <OtherBody data={data} period={period} cls={cls} />;
}

function DocsBody({ d, cls }: { d: AccDocuments; cls: string }) {
  const { slice, pager } = usePage(d.rows);
  {
    const rates = [...new Set(d.ivaByType.map((r) => r.rate))].sort((a, b) => a - b);
    const typesIva = [...new Set(d.ivaByType.map((r) => r.doc_type))];
    return (
      <div className={cls}>
        <div className="acc-sum">
          <section className="vd-card acc-box"><h3 className="acc-hd">Total IVA</h3>
            {typesIva.length === 0 ? <Empty /> : (
              <table className="ptable acc-mini"><thead><tr><th /> {rates.map((r) => <th key={r} className="num">AO {Number(r)}%</th>)}</tr></thead>
                <tbody>{typesIva.map((ty) => <tr key={ty}><td className="num">{DOC_LABEL[ty] ?? ty}</td>{rates.map((r) => <td key={r} className="num">{formatKz(d.ivaByType.find((x) => x.doc_type === ty && x.rate === r)?.iva ?? 0)}</td>)}</tr>)}</tbody></table>
            )}
          </section>
          <section className="vd-card acc-box"><h3 className="acc-hd">Total</h3>
            {d.totalsByType.length === 0 ? <Empty /> : (
              <table className="ptable acc-mini"><thead><tr><th /><th className="num">Líquido</th><th className="num">Imposto</th><th className="num">Total</th></tr></thead>
                <tbody>{d.totalsByType.map((r) => <tr key={r.doc_type}><td className="num">{DOC_LABEL[r.doc_type] ?? r.doc_type}</td><td className="num">{formatKz(r.net)}</td><td className="num">{formatKz(r.iva)}</td><td className="num">{formatKz(r.gross)}</td></tr>)}</tbody></table>
            )}
          </section>
        </div>
        <section className="vd-card acc-box">
          {d.rows.length === 0 ? <Empty /> : (
            <>
              {d.total > d.rows.length ? <p className="acc-note">A mostrar os {d.rows.length} documentos mais recentes de {d.total}. Escolha um período mais curto para ver todos.</p> : null}
              <table className="ptable acc-table">
                <thead><tr><th>Data</th><th>Documento</th><th>Tipos de Pagamento</th><th>Cliente</th><th>IVA</th><th className="num">Líquido</th><th className="num">Imposto</th><th className="num">Total</th></tr></thead>
                <tbody>{slice.map((r) => (
                  <tr key={r.id} className={r.status === 'A' ? 'acc-void' : undefined}>
                    <td className="nw">{dmy(r.date)}</td>
                    <td><strong className="acc-doc">{r.number}</strong><span className="acc-sub">{DOC_LABEL[r.doc_type] ?? r.doc_type}{r.status === 'A' ? ' · Anulado' : ''}</span></td>
                    <td>{PAY_LABEL[r.method] ?? r.method}</td>
                    <td className="wrap">{r.customer_name || 'Consumidor Final'}<span className="acc-sub">{r.customer_tax_id || '---------'}</span></td>
                    <td><span className="acc-taxes">{r.taxes.map((x, i) => <span key={i}><span>AO</span><span>{x.code}</span><span>{Number(x.rate)}%</span><span className="num">{formatKz(x.iva)}</span></span>)}</span></td>
                    <td className="num">{formatKz(r.net)}</td><td className="num">{formatKz(r.iva)}</td><td className="num">{formatKz(r.gross)}</td>
                  </tr>
                ))}</tbody>
              </table>
              {pager}
            </>
          )}
        </section>
      </div>
    );
  }
}

function OtherBody({ data, period, cls }: { data: Data; period: string; cls: string }) {
  if (data.tab === 'acc-taxmap') {
    const d = data.d;
    const byType = [...new Set(d.byType.map((r) => r.doc_type ?? ''))];
    return (
      <div className={cls}>
        <section className="vd-card acc-box"><h3 className="acc-hd">Mapa de Impostos - {period}</h3><TaxTable rows={d.rows} /></section>
        <section className="vd-card acc-box"><h3 className="acc-hd">Mapa de Impostos por Tipo</h3>
          {byType.length === 0 ? <Empty /> : byType.map((ty) => (
            <div key={ty} className="acc-group"><h4>{DOC_LABEL[ty] ?? ty}</h4><TaxTable rows={d.byType.filter((r) => r.doc_type === ty)} /></div>
          ))}
        </section>
      </div>
    );
  }
  if (data.tab === 'acc-payments' || data.tab === 'acc-suppliers') return <PaymentsAndSuppliers data={data} period={period} cls={cls} />;
  return null;
}

function LinesBody({ d, cls }: { d: AccProductLines; cls: string }) {
  const { slice, pager } = usePage(d.rows);
  {
    return (
      <div className={cls}>
        <section className="vd-card acc-box">
          {d.rows.length === 0 ? <Empty /> : (
            <>
              {d.total > d.rows.length ? <p className="acc-note">A mostrar as {d.rows.length} linhas mais recentes de {d.total}. Os totais abaixo são do período inteiro.</p> : null}
              <table className="ptable acc-table">
                <thead><tr><th>Documento</th><th>Data</th><th>Produto</th><th className="num">Qtd.</th><th>IVA</th><th className="num">P. Base</th><th className="num">P. Unitário</th><th className="num">Total</th></tr></thead>
                <tbody>{slice.map((r) => (
                  <tr key={`${r.id}-${r.line}`}>
                    <td><strong className="acc-doc">{r.number}</strong><span className="acc-sub">{r.customer_name || 'Consumidor Final'}</span></td>
                    <td className="nw">{new Date(r.at).toLocaleDateString('pt-PT')}<span className="acc-sub">{new Date(r.at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}</span></td>
                    <td className="wrap">{r.description}<span className="acc-sub">{r.code}</span></td>
                    <td className="num">{qtyFmt(r.qty)}</td>
                    <td className="nw">AO {r.iva_code} {Number(r.rate)}%<span className="acc-sub">{formatKz(r.iva)}</span></td>
                    <td className="num">{formatKz(r.base)}</td><td className="num">{formatKz(r.unit)}</td><td className="num">{formatKz(r.total)}</td>
                  </tr>
                ))}</tbody>
                <tfoot><tr><th colSpan={3}>Total</th><th className="num">{qtyFmt(d.totals.qty)}</th><th>{formatKz(d.totals.iva)}</th><th className="num">{formatKz(d.totals.base)}</th><th /><th className="num">{formatKz(d.totals.total)}</th></tr></tfoot>
              </table>
              {pager}
            </>
          )}
        </section>
      </div>
    );
  }
}

function DailyBody({ rows, cls }: { rows: AccDailySales['rows']; cls: string }) {
  const { slice, pager } = usePage(rows);
  {
    const s = (k: 'qty' | 'net' | 'gross') => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
    return (
      <div className={cls}>
        <section className="vd-card acc-box">
          {rows.length === 0 ? <Empty /> : (
            <table className="ptable acc-table">
              <thead><tr><th>Loja</th><th>Referência</th><th>Produto</th><th className="num">Quantidade</th><th className="num">Total</th><th className="num">Total PVP</th></tr></thead>
              <tbody>{slice.map((r, i) => <tr key={i}><td>{r.store_name}</td><td className="wrap">{r.code}</td><td className="wrap">{r.description}</td><td className="num">{qtyFmt(r.qty)}</td><td className="num">{formatKz(r.net)}</td><td className="num">{formatKz(r.gross)}</td></tr>)}</tbody>
              <tfoot><tr><th colSpan={3}>Total</th><th className="num">{qtyFmt(s('qty'))}</th><th className="num">{formatKz(s('net'))}</th><th className="num">{formatKz(s('gross'))}</th></tr></tfoot>
            </table>
          )}
          {pager}
        </section>
      </div>
    );
  }
}

function PaymentsAndSuppliers({ data, period, cls }: { data: Extract<Data, { tab: 'acc-payments' | 'acc-suppliers' }>; period: string; cls: string }) {
  if (data.tab === 'acc-payments') {
    const rows = data.d.rows;
    const methods = PAY_ORDER.filter((m) => rows.some((r) => r.method === m)).concat([...new Set(rows.map((r) => r.method))].filter((m) => !PAY_ORDER.includes(m)));
    const keys = [...new Set(rows.map((r) => `${r.store_name}\u0000${r.register}`))];
    const cell = (k: string, m: string) => rows.filter((r) => `${r.store_name}\u0000${r.register}` === k && r.method === m).reduce((a, r) => a + r.total, 0);
    const cnt = (k: string) => rows.filter((r) => `${r.store_name}\u0000${r.register}` === k).reduce((a, r) => a + r.count, 0);
    return (
      <div className={cls}>
        <section className="vd-card acc-box">
          {rows.length === 0 ? <Empty /> : (
            <table className="ptable acc-table">
              <thead><tr><th>Loja/Caixa</th>{methods.map((m) => <th key={m} className="num">{PAY_LABEL[m] ?? m}</th>)}<th className="num">Quantidade</th><th className="num">Total</th></tr></thead>
              <tbody>{keys.map((k) => {
                const [store, reg] = k.split('\u0000');
                return <tr key={k}><td>{store}<span className="acc-sub">{reg || 'Sem caixa'}</span></td>{methods.map((m) => <td key={m} className="num">{formatKz(cell(k, m))}</td>)}<td className="num">{cnt(k)}</td><td className="num">{formatKz(methods.reduce((a, m) => a + cell(k, m), 0))}</td></tr>;
              })}</tbody>
              <tfoot><tr><th>Total</th>{methods.map((m) => <th key={m} className="num">{formatKz(rows.filter((r) => r.method === m).reduce((a, r) => a + r.total, 0))}</th>)}<th className="num">{rows.reduce((a, r) => a + r.count, 0)}</th><th className="num">{formatKz(rows.reduce((a, r) => a + r.total, 0))}</th></tr></tfoot>
            </table>
          )}
        </section>
      </div>
    );
  }
  const rows = data.d.rows;
  const s = (k: 'products' | 'iva' | 'base' | 'total') => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  return (
    <div className={cls}>
      <section className="vd-card acc-box"><h3 className="acc-hd">Mapa de Impostos Fornecedores - {period}</h3>
        <table className="ptable acc-table">
          <thead><tr><th>Imposto</th><th className="num">Taxa</th><th className="num">Nº de Produtos</th><th className="num">IVA</th><th className="num">Base de Incidência</th><th className="num">Total</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.rate}><td>{r.label}</td><td className="num">{pct(r.rate)}</td><td className="num">{r.products}</td><td className="num">{formatKz(r.iva)}</td><td className="num">{formatKz(r.base)}</td><td className="num">{formatKz(r.total)}</td></tr>)}</tbody>
          <tfoot><tr><th colSpan={2}>Total</th><th className="num">{s('products')}</th><th className="num">{formatKz(s('iva'))}</th><th className="num">{formatKz(s('base'))}</th><th className="num">{formatKz(s('total'))}</th></tr></tfoot>
        </table>
        <p className="acc-note">Compras rececionadas (Compras › Encomendas) com data no período.</p>
      </section>
    </div>
  );
}

function TaxTable({ rows }: { rows: AccTaxRow[] }) {
  if (rows.length === 0) return <Empty />;
  const s = (k: 'iva' | 'base' | 'total') => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  return (
    <table className="ptable acc-table">
      <thead><tr><th>Região</th><th>Código</th><th className="num">Taxa</th><th className="num">Nº de Documentos</th><th className="num">IVA</th><th className="num">Base de Incidência</th><th className="num">Total</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={`${r.code}-${r.rate}`}><td>AO</td><td>{r.code}</td><td className="num">{pct(r.rate)}</td><td className="num">{r.docs}</td><td className="num">{formatKz(r.iva)}</td><td className="num">{formatKz(r.base)}</td><td className="num">{formatKz(r.total)}</td></tr>)}</tbody>
      <tfoot><tr><th colSpan={4}>Total</th><th className="num">{formatKz(s('iva'))}</th><th className="num">{formatKz(s('base'))}</th><th className="num">{formatKz(s('total'))}</th></tr></tfoot>
    </table>
  );
}
