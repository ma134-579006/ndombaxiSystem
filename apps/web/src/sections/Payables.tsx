import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type {
  CreatePayableInput,
  Payable,
  PayableSummary,
  RecordPayablePaymentInput,
} from '../api/types';
import { IconPlus, IconRefresh, IconTruck } from '../components/Icons';
import { Modal } from '../components/ui';
import { formatKz } from '../format';

const FILTERS: { key: string; label: string }[] = [
  { key: 'open', label: 'Em aberto' },
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
function todayISO(d = new Date()): string { return d.toISOString().slice(0, 10); }

/** Contas a pagar (fornecedores): saldo em dívida, antiguidade, comprovativos. */
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

  return (
    <div className="profit-page">
      <div className="content-head no-print">
        <h2>Contas a pagar</h2>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => void load()}><IconRefresh size={15} /> Atualizar</button>
        <button className="btn sm" onClick={() => window.print()}>🖨 Imprimir</button>
        <button className="btn" onClick={() => setCreating(true)}><IconPlus size={18} /> Nova conta</button>
      </div>

      {lastVoucher ? <div className="banner success no-print">Comprovativo emitido: <strong>{lastVoucher}</strong></div> : null}
      {error ? <div className="banner danger no-print">{error}</div> : null}

      <div className="print-only print-header"><h2>Contas a Pagar</h2><p>{new Date().toLocaleDateString('pt-PT')}</p></div>

      <div className="kpi-grid">
        <div className="kpi-card warning"><div className="kpi-ic"><IconTruck size={20} /></div>
          <div className="kpi-label">A pagar (total)</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{formatKz(sum?.outstanding ?? 0)}</div>
          <div className="kpi-sub">{sum?.openCount ?? 0} conta(s) em aberto</div>
        </div>
        <div className="kpi-card danger"><div className="kpi-ic"><IconTruck size={20} /></div>
          <div className="kpi-label">Vencido</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{formatKz(sum?.overdue ?? 0)}</div>
          <div className="kpi-sub">{sum?.overdueCount ?? 0} conta(s) em atraso</div>
        </div>
      </div>

      <div className="card no-print" style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <button key={f.key} className={`chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
      </div>

      <div className="card">
        {loading ? <div className="loading">A carregar…</div>
          : rows.length === 0 ? <div className="empty"><IconTruck size={40} /><p>Sem contas a pagar neste filtro.</p></div>
          : (
            <table className="ptable">
              <thead>
                <tr><th>Fornecedor</th><th>Referência</th><th>Original</th><th>Pago</th><th>Saldo</th><th>Vencimento</th><th>Estado</th><th className="no-print" /></tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const st = statusInfo(p);
                  return (
                    <tr key={p.id}>
                      <td>{p.supplier_name || '—'}</td>
                      <td>{p.reference || '—'}</td>
                      <td>{formatKz(Number(p.original_amount))}</td>
                      <td>{formatKz(Number(p.paid_amount))}</td>
                      <td style={{ fontWeight: 700 }}>{formatKz(Number(p.outstanding))}</td>
                      <td>{p.due_date ? new Date(p.due_date).toLocaleDateString('pt-PT') : '—'}</td>
                      <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                      <td className="no-print">
                        {p.status !== 'PAID' && p.status !== 'CANCELLED' ? (
                          <button className="btn sm" onClick={() => setPaying(p)}>Pagar</button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </div>

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
