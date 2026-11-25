import React, { useCallback, useEffect, useState } from 'react';
import { printSectionReport } from "../pdf/printDoc";
import { api, ApiError } from '../api/client';
import type {
  CreatePayableInput,
  Payable,
  PayableSummary,
  RecordPayablePaymentInput,
} from '../api/types';
import { IconPlus, IconSearch, IconTruck } from '../components/Icons';
import { Modal } from '../components/ui';
import { formatKz, localIso } from '../format';

const FILTERS: { key: string; label: string }[] = [
  { key: 'open', label: 'Por Pagar' },
  { key: 'overdue', label: 'Vencidas' },
  { key: 'paid', label: 'Pagas' },
  { key: 'all', label: 'Todas' },
];
const PAY_METHODS: { v: NonNullable<RecordPayablePaymentInput['method']>; label: string }[] = [
  { v: 'CASH', label: 'Numerário' }, { v: 'TRANSFER', label: 'Transferência' },
  { v: 'REFERENCE', label: 'Referência' }, { v: 'CARD', label: 'Multicaixa (TPA)' }, { v: 'EXPRESS', label: 'Express' },
];

function statusInfo(p: Payable): { label: string; cls: string } {
  if (p.status === 'PAID') return { label: 'Pago', cls: 'on' };
  if (p.status === 'CANCELLED') return { label: 'Cancelado', cls: '' };
  if (p.days_overdue > 0) return { label: `Vencida (${p.days_overdue}d)`, cls: 'off' };
  if (p.status === 'PARTIAL') return { label: 'Parcial', cls: '' };
  return { label: 'Em aberto', cls: '' };
}
function todayISO(d = new Date()): string { return localIso(d); }

/** Faturas de fornecedores (contas a pagar) no formato do Vendus: Compras › Faturas. */
export function Payables() {
  const [filter, setFilter] = useState('open');
  const [rows, setRows] = useState<Payable[]>([]);
  const [sum, setSum] = useState<PayableSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [paying, setPaying] = useState<Payable | null>(null);
  const [creating, setCreating] = useState(false);
  const [lastVoucher, setLastVoucher] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [l, s] = await Promise.all([api.payables.list(filter), api.payables.summary()]);
      setRows(l); setSum(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar contas a pagar.');
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  // Filtros como nas Faturas do Vendus: texto, estado, data da fatura e data de vencimento.
  const [q, setQ] = useState('');
  const [d1, setD1] = useState(''); const [d2, setD2] = useState('');
  const [v1, setV1] = useState(''); const [v2, setV2] = useState('');
  const clearFilters = () => { setQ(''); setD1(''); setD2(''); setV1(''); setV2(''); setFilter('open'); };
  const day = (s: string | null) => (s ? String(s).slice(0, 10) : '');
  const term = q.trim().toLowerCase();
  const list = rows.filter((p) => {
    const em = day(p.created_at), ve = day(p.due_date);
    return (!term || `${p.reference ?? ''} ${p.supplier_name ?? ''}`.toLowerCase().includes(term))
      && (!d1 || em >= d1) && (!d2 || em <= d2) && (!v1 || (ve && ve >= v1)) && (!v2 || (ve && ve <= v2));
  });
  const exportCsv = () => {
    const esc = (v: unknown) => { const t = String(v ?? ''); return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const head = ['Fornecedor', 'Nº Fatura', 'Data Fatura', 'Data Vencimento', 'Valor da Fatura', 'Valor Pago', 'Em Dívida', 'Estado'];
    const lines = list.map((p) => [p.supplier_name ?? '', p.reference ?? '', day(p.created_at), day(p.due_date), Number(p.original_amount).toFixed(2), Number(p.paid_amount).toFixed(2), Number(p.outstanding).toFixed(2), statusInfo(p).label].map(esc).join(';'));
    const blob = new Blob(['﻿' + [head.join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'faturas-fornecedores.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const fmtD = (s: string | null) => (s ? new Date(s).toLocaleDateString('pt-PT') : '—');

  return (
    <div className="vd-page">
      <div className="vd-head no-print">
        <p className="vd-crumb"><span style={{ color: 'var(--primary)' }}>Faturas</span><span className="sep">/</span><span>Listagem</span></p>
        <span className="spacer" />
        <button className="vd-btn" onClick={() => setCreating(true)}><IconPlus size={16} /> Adicionar Fatura</button>
        <button className="vd-btn outline" onClick={exportCsv} disabled={list.length === 0}>Exportar</button>
        <button className="vd-btn outline" onClick={() => void printSectionReport()}>Imprimir</button>
      </div>

      {lastVoucher ? <div className="banner success no-print">Comprovativo emitido: <strong>{lastVoucher}</strong></div> : null}
      {error ? <div className="vd-err no-print" role="alert">{error}</div> : null}

      <div className="print-only print-header"><h2>Faturas de fornecedores</h2><p>{new Date().toLocaleDateString('pt-PT')}</p></div>

      <form className="vd-card vd-filters no-print" onSubmit={(e) => { e.preventDefault(); void load(); }}>
        <div className="vd-frow" style={{ alignItems: 'center' }}>
          <label className="vd-f grow"><input className="vd-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisa por Número da Fatura ou Fornecedor" aria-label="Pesquisar faturas" /></label>
          <label className="vd-f"><select className="vd-in" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Estado">
            {FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select></label>
        </div>
        <div className="vd-frow">
          <div className="vd-f pu-dates"><span className="pu-dl">Data de emissão da fatura</span><div className="vd-range">
            <input type="date" className="vd-in" value={d1} max={d2 || undefined} onChange={(e) => setD1(e.target.value)} aria-label="Emissão de" />
            <span className="mid">até</span>
            <input type="date" className="vd-in" value={d2} min={d1 || undefined} onChange={(e) => setD2(e.target.value)} aria-label="Emissão até" />
          </div></div>
          <div className="vd-f pu-dates"><span className="pu-dl">Data Vencimento</span><div className="vd-range">
            <input type="date" className="vd-in" value={v1} max={v2 || undefined} onChange={(e) => setV1(e.target.value)} aria-label="Vencimento de" />
            <span className="mid">até</span>
            <input type="date" className="vd-in" value={v2} min={v1 || undefined} onChange={(e) => setV2(e.target.value)} aria-label="Vencimento até" />
          </div></div>
        </div>
        <div className="vd-frow">
          <button type="submit" className="vd-btn"><IconSearch size={15} /> Pesquisar</button>
          <button type="button" className="vd-btn outline" onClick={clearFilters}>✕ Limpar Filtro</button>
        </div>
      </form>

      <div className="vd-card vd-tablecard">
        {loading ? <div className="vd-empty">A carregar…</div>
          : list.length === 0 ? (
            <div className="pu-noreg"><IconTruck size={56} /><strong>Não existem registos</strong><span>{rows.length === 0 && filter === 'open' ? 'Ainda não adicionou nenhuma fatura de fornecedor?' : 'Sem faturas com estes filtros.'}</span>
              <button className="vd-btn outline" onClick={() => setCreating(true)}>Adicionar fatura</button></div>
          ) : (
            <div className="vd-tablewrap">
              <table className="vd-table">
                <thead>
                  <tr><th>Fornecedor</th><th>Nº Fatura</th><th>Data Fatura</th><th>Data Vencimento</th><th className="num">Valor da Fatura</th><th className="num">Valor Pago</th><th className="num">Em Dívida</th><th>Estado</th><th className="no-print" aria-label="Ações" /></tr>
                </thead>
                <tbody>
                  {list.map((p) => {
                    const st = statusInfo(p);
                    return (
                      <tr key={p.id}>
                        <td>{p.supplier_name || '—'}</td>
                        <td>{p.reference || '—'}</td>
                        <td>{fmtD(p.created_at)}</td>
                        <td>{fmtD(p.due_date)}</td>
                        <td className="num">{formatKz(Number(p.original_amount))}</td>
                        <td className="num">{formatKz(Number(p.paid_amount))}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{formatKz(Number(p.outstanding))}</td>
                        <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                        <td className="num no-print">
                          {p.status !== 'PAID' && p.status !== 'CANCELLED' ? (
                            <button className="vd-btn sm" onClick={() => setPaying(p)}>Pagar</button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>
      {sum ? <p className="pu-sum no-print">Por pagar <b>{formatKz(sum.outstanding)}</b> em {sum.openCount} fatura(s) · vencido <b className={sum.overdue > 0 ? 'neg' : ''}>{formatKz(sum.overdue)}</b></p> : null}

      {paying ? (
        <PayModal payable={paying} onClose={() => setPaying(null)} onPaid={(v) => { setPaying(null); setLastVoucher(v); void load(); }} />
      ) : null}
      {creating ? (
        <NewModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void load(); }} />
      ) : null}
    </div>
  );
}

function PayModal({ payable, onClose, onPaid }: { payable: Payable; onClose(): void; onPaid(v: string): void }) {
  const outstanding = Number(payable.outstanding);
  const [amount, setAmount] = useState(String(outstanding));
  const [method, setMethod] = useState<NonNullable<RecordPayablePaymentInput['method']>>('CASH');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) { setErr('Valor inválido.'); return; }
    if (a > outstanding + 0.001) { setErr(`Máximo: ${formatKz(outstanding)}.`); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.payables.pay(payable.id, { amount: a, method });
      onPaid(r.referenceNumber);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível registar o pagamento.');
    } finally { setBusy(false); }
  };

  return (
    <Modal title={`Pagar — ${payable.supplier_name ?? ''}`} onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <div className="totals" style={{ marginBottom: 12 }}>
        <div className="t-row grand"><span>Saldo em dívida</span><span>{formatKz(outstanding)}</span></div>
      </div>
      <div className="grid-2">
        <div className="field"><label>Valor a pagar (Kz)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></div>
        <div className="field"><label>Forma</label>
          <select value={method} onChange={(e) => setMethod(e.target.value as NonNullable<RecordPayablePaymentInput['method']>)}>
            {PAY_METHODS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
          </select></div>
      </div>
      <button className="btn lg block success" style={{ marginTop: 12 }} onClick={submit} disabled={busy}>
        {busy ? 'A registar…' : 'Registar pagamento'}
      </button>
    </Modal>
  );
}

function NewModal({ onClose, onCreated }: { onClose(): void; onCreated(): void }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [dueDate, setDueDate] = useState(todayISO(new Date(Date.now() + 30 * 86400000)));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) { setErr('Indique o fornecedor.'); return; }
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) { setErr('Valor inválido.'); return; }
    setBusy(true); setErr(null);
    try {
      const payload: CreatePayableInput = { supplierName: name.trim(), amount: a, reference: reference.trim() || undefined, dueDate, notes: notes.trim() || undefined };
      await api.payables.create(payload);
      onCreated();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível criar a conta.');
    } finally { setBusy(false); }
  };

  return (
    <Modal title="Nova conta a pagar" onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <div className="field"><label>Fornecedor</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do fornecedor" /></div>
      <div className="grid-2">
        <div className="field"><label>Valor (Kz)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" /></div>
        <div className="field"><label>Vencimento</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
      </div>
      <div className="field"><label>Referência (nº factura/OC)</label>
        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Opcional" /></div>
      <div className="field"><label>Notas</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" /></div>
      <button className="btn lg block" style={{ marginTop: 12 }} onClick={submit} disabled={busy}>
        {busy ? 'A criar…' : 'Criar conta'}
      </button>
    </Modal>
  );
}
