import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { ManagerStore, ReportDocRow, SaleDetail } from '../api/types';
import { formatKz } from '../format';
import { invoicePdf } from '../components/InvoiceShare';
import { Modal } from '../components/ui';

/**
 * Documentos (faturação) no modelo do backoffice de referência:
 *   • lista em cartões — círculo com o tipo (FT/FR/FS/NC), número, cliente/NIF,
 *     valor e data à direita, estado;
 *   • painel de filtros à direita: Lojas, Data de emissão, Tipo, Estado,
 *     Intervalo de valores, "Aplicar filtro" / "Limpar filtro";
 *   • abrir um documento: detalhe com as linhas e 2.ª via em PDF.
 */
const DOC_LABEL: Record<string, string> = { FT: 'Fatura', FR: 'Fatura-Recibo', FS: 'Fatura Simplificada', NC: 'Nota de Crédito', ND: 'Nota de Débito', RC: 'Recibo' };
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const fmtDT = (s: string) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? s : d.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const num = (s: string | number | null | undefined) => Number(s) || 0;

export function Documents() {
  const [rows, setRows] = useState<ReportDocRow[]>([]);
  const [stores, setStores] = useState<ManagerStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Filtros (rascunho no painel → aplicados com "Aplicar filtro").
  const [draft, setDraft] = useState({ storeId: '', from: monthStart(), to: today(), docType: '', status: '', min: '', max: '' });
  const [applied, setApplied] = useState(draft);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<{ row: ReportDocRow; detail: SaleDetail | null } | null>(null);

  useEffect(() => { api.staff.listStores().then(setStores).catch(() => undefined); }, []);
  const load = useCallback(async (f = applied) => {
    setLoading(true); setError(null);
    try { setRows(await api.reports.documents({ from: f.from, to: f.to, storeId: f.storeId || undefined, docType: f.docType || undefined })); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível carregar os documentos.'); }
    finally { setLoading(false); }
  }, [applied]);
  useEffect(() => { void load(); }, [load]);

  const list = useMemo(() => {
    const lo = draftNum(applied.min), hi = draftNum(applied.max), term = q.trim().toLowerCase();
    return rows.filter((d) => {
      if (applied.status === 'VALID' && d.status === 'A') return false;
      if (applied.status === 'ANNULLED' && d.status !== 'A') return false;
      const g = num(d.gross_total);
      if (lo != null && g < lo) return false;
      if (hi != null && g > hi) return false;
      if (term && !`${d.number} ${d.customer_name ?? ''} ${d.customer_tax_id ?? ''}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rows, applied, q]);
  const total = list.filter((d) => d.status !== 'A').reduce((t, d) => t + num(d.gross_total), 0);

  const openDoc = async (row: ReportDocRow) => {
    setOpen({ row, detail: null });
    if (!row.id) return;
    try { const detail = await api.sales.detail(row.id); setOpen({ row, detail }); } catch { /* fica sem linhas */ }
  };

  const exportCsv = () => {
    const esc = (v: unknown) => { const t = String(v ?? ''); return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const head = ['Documento', 'Tipo', 'Data', 'Cliente', 'NIF', 'Loja', 'Operador', 'Base', 'IVA', 'Total', 'Estado'];
    const lines = list.map((d) => [d.number, d.doc_type, fmtDT(d.system_entry_date), d.customer_name ?? '', d.customer_tax_id ?? '', d.store_name ?? '', d.cashier_name ?? '',
      num(d.net_total).toFixed(2), num(d.iva_total).toFixed(2), num(d.gross_total).toFixed(2), d.status === 'A' ? 'Anulado' : 'Válido'].map(esc).join(';'));
    const blob = new Blob(['﻿' + [head.join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `documentos-${applied.from}-${applied.to}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="vd-page">
      <div className="vd-head">
        <p className="vd-crumb"><span style={{ color: 'var(--primary)' }}>Documentos</span><span className="sep">/</span><span>Faturação</span></p>
        <span className="spacer" />
        <button className="vd-btn outline" onClick={exportCsv} disabled={list.length === 0}>Exportar CSV</button>
      </div>
      {error ? <div className="vd-err" role="alert">{error}</div> : null}

      <div className="doc-layout">
        <div className="doc-main">
          <div className="vd-card doc-search">
            <input className="vd-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar por número, cliente ou NIF" aria-label="Pesquisar documentos" />
            <div className="vd-sum">
              <span>Documentos <b>{list.length}</b></span>
              <span>Total <b>{formatKz(total)}</b></span>
              <span>Anulados <b className={list.some((d) => d.status === 'A') ? 'bad' : ''}>{list.filter((d) => d.status === 'A').length}</b></span>
            </div>
          </div>
          {loading ? <div className="vd-card vd-empty">A carregar documentos…</div>
            : list.length === 0 ? <div className="vd-card vd-empty">Sem documentos no período.</div>
            : (
              <ul className="doc-list">
                {list.map((d, i) => (
                  <li key={d.id ?? d.number} style={{ animationDelay: `${Math.min(i, 14) * 22}ms` }}>
                    <button className={`doc-item${d.status === 'A' ? ' off' : ''}`} onClick={() => void openDoc(d)}>
                      <span className={`doc-badge t-${d.doc_type}`}>{d.doc_type}</span>
                      <span className="doc-id">
                        <b>{d.number}</b>
                        <small>{d.customer_name || (d.customer_tax_id ? `NIF ${d.customer_tax_id}` : 'Consumidor final')}{d.store_name ? ` · ${d.store_name}` : ''}</small>
                      </span>
                      <span className="doc-val">
                        <b>{formatKz(num(d.gross_total))}</b>
                        <small>{fmtDT(d.system_entry_date)}</small>
                      </span>
                      {d.status === 'A' ? <span className="vd-tag bad">Anulado</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>

        <aside className="vd-card doc-filters" aria-label="Filtros">
          <p className="vd-sect">Filtros</p>
          <label className="vd-f"><span>Lojas</span><select value={draft.storeId} onChange={(e) => setDraft({ ...draft, storeId: e.target.value })}>
            <option value="">Todas as lojas</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
          <div className="vd-f"><span>Data de emissão</span>
            <div className="vd-range">
              <input type="date" value={draft.from} max={draft.to} onChange={(e) => setDraft({ ...draft, from: e.target.value })} aria-label="De" />
              <span className="mid">até</span>
              <input type="date" value={draft.to} min={draft.from} onChange={(e) => setDraft({ ...draft, to: e.target.value })} aria-label="Até" />
            </div></div>
          <label className="vd-f"><span>Tipo de documento</span><select value={draft.docType} onChange={(e) => setDraft({ ...draft, docType: e.target.value })}>
            <option value="">Todos</option>
            {['FT', 'FR', 'FS', 'NC'].map((t) => <option key={t} value={t}>{t} — {DOC_LABEL[t]}</option>)}
          </select></label>
          <label className="vd-f"><span>Estado</span><select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
            <option value="">Todos</option><option value="VALID">Válidos</option><option value="ANNULLED">Anulados</option>
          </select></label>
          <div className="vd-f"><span>Intervalo de valores</span>
            <div className="vd-range">
              <input inputMode="decimal" value={draft.min} onChange={(e) => setDraft({ ...draft, min: e.target.value })} placeholder="Min" aria-label="Valor mínimo" />
              <span className="mid">até</span>
              <input inputMode="decimal" value={draft.max} onChange={(e) => setDraft({ ...draft, max: e.target.value })} placeholder="Max" aria-label="Valor máximo" />
            </div></div>
          <button className="vd-btn block" onClick={() => setApplied({ ...draft })}>Aplicar filtro</button>
          <button className="vd-clear block" onClick={() => { const d = { storeId: '', from: monthStart(), to: today(), docType: '', status: '', min: '', max: '' }; setDraft(d); setApplied(d); }}>✕ Limpar filtro</button>
        </aside>
      </div>

      {open ? (
        <Modal title={`${DOC_LABEL[open.row.doc_type] ?? open.row.doc_type} ${open.row.number}`} onClose={() => setOpen(null)}>
          <div className="doc-meta">
            <span>{fmtDT(open.row.system_entry_date)}</span>
            <span>{open.row.customer_name || (open.row.customer_tax_id ? `NIF ${open.row.customer_tax_id}` : 'Consumidor final')}</span>
            {open.row.cashier_name ? <span>Operador: {open.row.cashier_name}</span> : null}
            {open.row.status === 'A' ? <span className="vd-tag bad">Anulado</span> : <span className="vd-tag ok">Válido</span>}
          </div>
          {open.detail ? (
            <table className="vd-table doc-lines">
              <thead><tr><th>Artigo</th><th className="num">Qtd</th><th className="num">Preço</th><th className="num">Total</th></tr></thead>
              <tbody>
                {open.detail.items.map((it) => (
                  <tr key={`${it.productCode}-${it.description}`}><td>{it.description}</td><td className="num">{it.quantity}</td><td className="num">{formatKz(it.unitPrice)}</td><td className="num">{formatKz(it.total)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <div className="vd-empty">A carregar linhas…</div>}
          <div className="doc-tot">
            <span>Base <b>{formatKz(num(open.row.net_total))}</b></span>
            <span>IVA <b>{formatKz(num(open.row.iva_total))}</b></span>
            <span>Total <b>{formatKz(num(open.row.gross_total))}</b></span>
          </div>
          {open.row.id ? (
            <div className="vd-actions">
              <button className="vd-btn outline" onClick={() => void invoicePdf(open.row.id!)}>Descarregar PDF</button>
              <button className="vd-btn" onClick={() => void invoicePdf(open.row.id!)}>Imprimir 2.ª via</button>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}

function draftNum(s: string): number | null {
  if (!s.trim()) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
