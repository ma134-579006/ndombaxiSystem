import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type {
  CreateReceivableInput,
  Receivable,
  ReceivableStatus,
  ReceivableSummary,
  RecordPaymentInput,
} from '../api/types';
import { IconCard, IconPlus, IconRefresh } from '../components/Icons';
import { Modal } from '../components/ui';
import { formatKz } from '../format';

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
function todayISO(d = new Date()): string { return d.toISOString().slice(0, 10); }

/** Contas a receber (venda a crédito): saldo em dívida, antiguidade, recibos. */
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

  return (
    <div className="profit-page">
      <div className="content-head no-print">
        <h2>Contas a receber</h2>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => void load()}><IconRefresh size={15} /> Atualizar</button>
        <button className="btn sm" onClick={() => window.print()}>🖨 Imprimir</button>
        <button className="btn" onClick={() => setCreating(true)}><IconPlus size={18} /> Nova conta</button>
      </div>

      {lastReceipt ? (
        <div className="banner success no-print">Recibo emitido: <strong>{lastReceipt}</strong></div>
      ) : null}
      {error ? <div className="banner danger no-print">{error}</div> : null}

      <div className="print-only print-header"><h2>Contas a Receber</h2><p>{new Date().toLocaleDateString('pt-PT')}</p></div>

      {/* KPIs */}
      <div className="kpi-grid">
        <div className="kpi-card warning"><div className="kpi-ic"><IconCard size={20} /></div>
          <div className="kpi-label">Em dívida (total)</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{formatKz(sum?.outstanding ?? 0)}</div>
          <div className="kpi-sub">{sum?.openCount ?? 0} conta(s) em aberto</div>
        </div>
        <div className="kpi-card danger"><div className="kpi-ic"><IconCard size={20} /></div>
          <div className="kpi-label">Vencido</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{formatKz(sum?.overdue ?? 0)}</div>
          <div className="kpi-sub">{sum?.overdueCount ?? 0} conta(s) em atraso</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="card no-print" style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <button key={f.key} className={`chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
      </div>

      {/* Lista */}
      <div className="card">
        {loading ? <div className="loading">A carregar…</div>
          : rows.length === 0 ? <div className="empty"><IconCard size={40} /><p>Sem contas a receber neste filtro.</p></div>
          : (
            <table className="ptable">
              <thead>
                <tr><th>Cliente</th><th>Factura</th><th>Original</th><th>Pago</th><th>Saldo</th><th>Vencimento</th><th>Estado</th><th className="no-print" /></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = statusInfo(r);
                  return (
                    <tr key={r.id}>
                      <td>{r.customer_name || '—'}</td>
                      <td>{r.invoice_number || '—'}</td>
                      <td>{formatKz(Number(r.original_amount))}</td>
                      <td>{formatKz(Number(r.paid_amount))}</td>
                      <td style={{ fontWeight: 700 }}>{formatKz(Number(r.outstanding))}</td>
                      <td>{r.due_date ? new Date(r.due_date).toLocaleDateString('pt-PT') : '—'}</td>
                      <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                      <td className="no-print">
                        {r.status !== 'PAID' ? (
                          <button className="btn sm" onClick={() => setPaying(r)}>Receber</button>
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
