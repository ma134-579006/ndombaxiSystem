import React, { useCallback, useEffect, useState } from 'react';
import { printSectionReport } from "../pdf/printDoc";
import { api, ApiError } from '../api/client';
import type {
  CreateReceivableInput,
  Receivable,
  ReceivableStatus,
  ReceivableSummary,
  RecordPaymentInput,
} from '../api/types';
import { IconPlus, IconSearch } from '../components/Icons';
import { Modal } from '../components/ui';
import { formatKz, localIso } from '../format';

const FILTERS: { key: string; label: string }[] = [
  { key: 'open', label: 'Em aberto' },
  { key: 'overdue', label: 'Vencidas' },
  { key: 'paid', label: 'Pagas' },
  { key: 'all', label: 'Todas' },
];
const PAY_METHODS: { v: NonNullable<RecordPaymentInput['method']>; label: string }[] = [
  { v: 'CASH', label: 'Numerário' }, { v: 'TRANSFER', label: 'Transferência' },
  { v: 'REFERENCE', label: 'Referência' }, { v: 'CARD', label: 'Multicaixa (TPA)' }, { v: 'EXPRESS', label: 'Express' },
];

function statusInfo(r: Receivable): { label: string; cls: string } {
  if (r.status === 'PAID') return { label: 'Pago', cls: 'on' };
  if (r.days_overdue > 0) return { label: `Vencida (${r.days_overdue}d)`, cls: 'off' };
  if (r.status === 'PARTIAL') return { label: 'Parcial', cls: '' };
  return { label: 'Em aberto', cls: '' };
}
function todayISO(d = new Date()): string { return localIso(d); }

/** Conta Corrente de clientes (vendas a crédito) no formato do Vendus: Clientes › Conta Corrente. */
export function Receivables() {
  const [filter, setFilter] = useState('open');
  const [rows, setRows] = useState<Receivable[]>([]);
  const [sum, setSum] = useState<ReceivableSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [paying, setPaying] = useState<Receivable | null>(null);
  const [creating, setCreating] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [l, s] = await Promise.all([api.receivables.list(filter), api.receivables.summary()]);
      setRows(l); setSum(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar contas a receber.');
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  // Conta Corrente como no Vendus: pesquisa por nome/NIF, quadro Saldo Total / Dívida
  // Corrente / Dívida Vencida e tabela POR CLIENTE; por baixo, as faturas por liquidar
  // (com «Receber», para registar pagamentos).
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const list = rows.filter((r) => !term || `${r.customer_name ?? ''} ${r.invoice_number ?? ''}`.toLowerCase().includes(term));
  const byClient = (() => {
    const m = new Map<string, { name: string; saldo: number; corrente: number; vencida: number }>();
    for (const r of list) {
      if (r.status === 'PAID') continue;
      const name = r.customer_name || 'Consumidor Final';
      const c = m.get(name) ?? { name, saldo: 0, corrente: 0, vencida: 0 };
      const o = Number(r.outstanding) || 0;
      c.saldo += o;
      if (r.days_overdue > 0) c.vencida += o; else c.corrente += o;
      m.set(name, c);
    }
    return [...m.values()].sort((a, b) => b.saldo - a.saldo);
  })();
  const total = sum?.outstanding ?? 0, overdue = sum?.overdue ?? 0, current = Math.max(0, total - overdue);
  const exportCsv = () => {
    const esc = (v: unknown) => { const t = String(v ?? ''); return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const lines = byClient.map((c) => [c.name, c.saldo.toFixed(2), c.corrente.toFixed(2), c.vencida.toFixed(2)].map(esc).join(';'));
    const blob = new Blob(['﻿' + ['Nome;Saldo;Dívida Corrente;Dívida Vencida', ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'conta-corrente.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="vd-page">
      <div className="vd-head no-print">
        <p className="vd-crumb"><span style={{ color: 'var(--primary)' }}>Conta Corrente</span><span className="sep">/</span><span>Listagem</span></p>
        <span className="spacer" />
        <button className="vd-btn" onClick={exportCsv} disabled={byClient.length === 0}>Exportar</button>
        <button className="vd-btn outline" onClick={() => void printSectionReport()}>Imprimir</button>
        <button className="vd-btn outline" onClick={() => setCreating(true)}><IconPlus size={16} /> Nova conta</button>
      </div>

      {lastReceipt ? <div className="banner success no-print">Recibo emitido: <strong>{lastReceipt}</strong></div> : null}
      {error ? <div className="vd-err no-print" role="alert">{error}</div> : null}

      <div className="print-only print-header"><h2>Conta Corrente</h2><p>{new Date().toLocaleDateString('pt-PT')}</p></div>

      <form className="vd-card vd-filters no-print" onSubmit={(e) => { e.preventDefault(); void load(); }}>
        <div className="vd-frow" style={{ alignItems: 'center' }}>
          <label className="vd-f grow"><input className="vd-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisa por Nome ou NIF" aria-label="Pesquisar clientes" /></label>
          <label className="vd-f"><select className="vd-in" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Estado">
            {FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select></label>
          <button type="submit" className="vd-btn"><IconSearch size={15} /> Pesquisar</button>
        </div>
      </form>

      <section className="vd-card pu-debts" aria-label="Resumo da conta corrente">
        <div className="pu-debts-b">
          <div><small>Saldo Total</small><b className={total > 0 ? 'neg' : 'ok'}>{formatKz(total)}</b><span>{total > 0 ? `${sum?.openCount ?? 0} fatura(s) em dívida` : 'Não existem dívidas'}</span></div>
          <div><small>Dívida Corrente</small><b className={current > 0 ? 'neg' : 'ok'}>{formatKz(current)}</b><span>{current > 0 ? 'Pagamentos dentro do prazo' : 'Não existem pagamentos pendentes'}</span></div>
          <div><small>Dívida Vencida</small><b className={overdue > 0 ? 'neg' : 'ok'}>{formatKz(overdue)}</b><span>{overdue > 0 ? `${sum?.overdueCount ?? 0} fatura(s) fora do prazo` : 'Não existem pagamentos fora do prazo'}</span></div>
        </div>
      </section>

      <div className="vd-card vd-tablecard">
        {loading ? <div className="vd-empty">A carregar…</div> : byClient.length === 0 ? <div className="vd-empty">Não foram encontrados resultados</div> : (
          <div className="vd-tablewrap">
            <table className="vd-table">
              <thead><tr><th>Nome</th><th className="num">Saldo</th><th className="num">Dívida Corrente</th><th className="num">Dívida Vencida</th></tr></thead>
              <tbody>
                {byClient.map((c) => (
                  <tr key={c.name}>
                    <td><button type="button" className="vd-link" onClick={() => setQ(c.name)}>{c.name}</button></td>
                    <td className="num" style={{ fontWeight: 700 }}>{formatKz(c.saldo)}</td>
                    <td className="num">{formatKz(c.corrente)}</td>
                    <td className="num" style={{ color: c.vencida > 0 ? '#e0384b' : undefined }}>{formatKz(c.vencida)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && list.length > 0 ? (
        <div className="vd-card vd-tablecard">
          <div className="vd-tbar"><span>Faturas por liquidar</span></div>
          <div className="vd-tablewrap">
            <table className="vd-table">
              <thead><tr><th>Cliente</th><th>Fatura</th><th className="num">Original</th><th className="num">Pago</th><th className="num">Saldo</th><th>Vencimento</th><th>Estado</th><th className="no-print" aria-label="Ações" /></tr></thead>
              <tbody>
                {list.map((r) => {
                  const st = statusInfo(r);
                  return (
                    <tr key={r.id}>
                      <td>{r.customer_name || '—'}</td>
                      <td>{r.invoice_number || '—'}</td>
                      <td className="num">{formatKz(Number(r.original_amount))}</td>
                      <td className="num">{formatKz(Number(r.paid_amount))}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{formatKz(Number(r.outstanding))}</td>
                      <td>{r.due_date ? new Date(r.due_date).toLocaleDateString('pt-PT') : '—'}</td>
                      <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                      <td className="num no-print">{r.status !== 'PAID' ? <button className="vd-btn sm" onClick={() => setPaying(r)}>Receber</button> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {paying ? (
        <PayModal
          receivable={paying}
          onClose={() => setPaying(null)}
          onPaid={(rc) => { setPaying(null); setLastReceipt(rc); void load(); }}
        />
      ) : null}
      {creating ? (
        <NewModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void load(); }} />
      ) : null}
    </div>
  );
}

function PayModal({ receivable, onClose, onPaid }: { receivable: Receivable; onClose(): void; onPaid(rc: string): void }) {
  const outstanding = Number(receivable.outstanding);
  const [amount, setAmount] = useState(String(outstanding));
  const [method, setMethod] = useState<NonNullable<RecordPaymentInput['method']>>('CASH');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) { setErr('Valor inválido.'); return; }
    if (a > outstanding + 0.001) { setErr(`Máximo: ${formatKz(outstanding)}.`); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.receivables.pay(receivable.id, { amount: a, method });
      onPaid(r.receiptNumber);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível registar o pagamento.');
    } finally { setBusy(false); }
  };

  return (
    <Modal title={`Receber — ${receivable.customer_name ?? ''}`} onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <div className="totals" style={{ marginBottom: 12 }}>
        <div className="t-row grand"><span>Saldo em dívida</span><span>{formatKz(outstanding)}</span></div>
      </div>
      <div className="grid-2">
        <div className="field"><label>Valor a receber (Kz)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></div>
        <div className="field"><label>Forma</label>
          <select value={method} onChange={(e) => setMethod(e.target.value as NonNullable<RecordPaymentInput['method']>)}>
            {PAY_METHODS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
          </select></div>
      </div>
      <button className="btn lg block success" style={{ marginTop: 12 }} onClick={submit} disabled={busy}>
        {busy ? 'A registar…' : 'Registar e emitir recibo'}
      </button>
    </Modal>
  );
}

function NewModal({ onClose, onCreated }: { onClose(): void; onCreated(): void }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(todayISO(new Date(Date.now() + 30 * 86400000)));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) { setErr('Indique o nome do cliente.'); return; }
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) { setErr('Valor inválido.'); return; }
    setBusy(true); setErr(null);
    try {
      const payload: CreateReceivableInput = { customerName: name.trim(), amount: a, dueDate, notes: notes.trim() || undefined };
      await api.receivables.create(payload);
      onCreated();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível criar a conta.');
    } finally { setBusy(false); }
  };

  return (
    <Modal title="Nova conta a receber" onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <div className="field"><label>Cliente</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do cliente" /></div>
      <div className="grid-2">
        <div className="field"><label>Valor (Kz)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" /></div>
        <div className="field"><label>Vencimento</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
      </div>
      <div className="field"><label>Notas</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" /></div>
      <button className="btn lg block" style={{ marginTop: 12 }} onClick={submit} disabled={busy}>
        {busy ? 'A criar…' : 'Criar conta'}
      </button>
    </Modal>
  );
}
