import { confirmDialog } from '../components/feedback';
import { printSectionReport } from "../pdf/printDoc";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type CreateExpenseInput,
  type Expense,
  type ExpenseCategory,
  type ExpensePayment,
  type ExpenseSummary,
} from '../api/types';
import { IconPlus, IconRefresh, IconReceipt, IconTrash } from '../components/Icons';
import { Modal } from '../components/ui';
import { formatKz } from '../format';

const PAYMENT_LABELS: Record<ExpensePayment, string> = {
  CASH: 'Dinheiro', TRANSFER: 'Transferência', REFERENCE: 'Referência', CARD: 'Cartão',
};

function todayISO(d = new Date()): string { return d.toISOString().slice(0, 10); }

interface FormState {
  category: ExpenseCategory;
  amount: string;
  description: string;
  supplier: string;
  paymentMethod: ExpensePayment;
  documentRef: string;
  expenseDate: string;
}
const EMPTY: FormState = {
  category: 'RENDA', amount: '', description: '', supplier: '',
  paymentMethod: 'CASH', documentRef: '', expenseDate: todayISO(),
};

/** Despesas operacionais do gestor: registo por categoria, filtro por datas,
 *  repartição em gráfico, total e impressão. Liga ao lucro líquido (página Lucros). */
export function Expenses() {
  const [from, setFrom] = useState(todayISO(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(todayISO());
  const [catFilter, setCatFilter] = useState<ExpenseCategory | ''>('');
  const [list, setList] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const timer = useRef<number | null>(null);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [l, s] = await Promise.all([
        api.expenses.list(from, to, catFilter || undefined),
        api.expenses.summary(from, to),
      ]);
      setList(l); setSummary(s); setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar despesas.');
    } finally { setLoading(false); }
  }, [from, to, catFilter]);

  useEffect(() => {
    void load();
    timer.current = window.setInterval(() => void load(), 60_000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [load]);

  const setPreset = (days: number) => {
    setFrom(todayISO(new Date(Date.now() - (days - 1) * 86400000)));
    setTo(todayISO());
  };

  const openCreate = () => { setForm({ ...EMPTY, expenseDate: todayISO() }); setFormError(null); setCreating(true); };

  const save = async () => {
    setFormError(null);
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setFormError('Indique um valor válido.'); return; }
    setSaving(true);
    try {
      const payload: CreateExpenseInput = {
        category: form.category,
        amount,
        description: form.description.trim() || undefined,
        supplier: form.supplier.trim() || undefined,
        paymentMethod: form.paymentMethod,
        documentRef: form.documentRef.trim() || undefined,
        expenseDate: form.expenseDate || undefined,
      };
      await api.expenses.create(payload);
      setCreating(false);
      await load();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Não foi possível guardar a despesa.');
    } finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!(await confirmDialog({ message: 'Eliminar esta despesa? A ação fica registada na auditoria.', danger: true }))) return;
    try { await api.expenses.remove(id); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível eliminar.'); }
  };

  const total = summary?.total ?? 0;
  const maxCat = Math.max(1, ...(summary?.byCategory ?? []).map((c) => c.total));

  return (
    <div className="profit-page">
      <div className="content-head no-print">
        <h2>Gastos da empresa</h2>
        <span className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
          <span className="live-dot" /> Ao vivo{updatedAt ? ` · ${updatedAt.toLocaleTimeString('pt-PT')}` : ''}
        </span>
        <span className="spacer" />
        <button className="btn" onClick={openCreate}><IconPlus size={18} /> Novo gasto</button>
      </div>

      {/* Filtros */}
      <div className="card no-print">
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Data inicial</label>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Data final</label>
            <input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Categoria</label>
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value as ExpenseCategory | '')}>
              <option value="">Todas</option>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="chip" onClick={() => setPreset(1)}>Hoje</button>
            <button className="chip" onClick={() => setPreset(7)}>7 dias</button>
            <button className="chip" onClick={() => setPreset(30)}>30 dias</button>
            <button className="chip" onClick={() => setPreset(90)}>90 dias</button>
          </div>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => void load()}><IconRefresh size={15} /> Atualizar</button>
          <button className="btn sm" onClick={() => void printSectionReport()}>🖨 Imprimir</button>
        </div>
      </div>

      {error ? <div className="banner danger no-print">{error}</div> : null}

      {/* Cabeçalho de impressão */}
      <div className="print-only print-header">
        <h2>Relatório de Despesas</h2>
        <p>Período: {new Date(from).toLocaleDateString('pt-PT')} a {new Date(to).toLocaleDateString('pt-PT')}</p>
      </div>

      {/* Total + repartição por categoria */}
      <div className="kpi-grid">
        <div className="kpi-card danger">
          <div className="kpi-ic"><IconReceipt size={20} /></div>
          <div className="kpi-label">Total de despesas</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{formatKz(total)}</div>
          <div className="kpi-sub">{list.length} lançamento(s) no período</div>
        </div>
        <div className="card" style={{ gridColumn: 'span 3', margin: 0 }}>
          <h3>Repartição por categoria</h3>
          {(summary?.byCategory ?? []).length === 0 ? (
            <p className="muted">Sem despesas no período.</p>
          ) : (
            <div className="catbars">
              {summary!.byCategory.map((c) => (
                <div className="catbar" key={c.category}>
                  <span className="catbar-name">{EXPENSE_CATEGORY_LABELS[c.category] ?? c.category}</span>
                  <div className="catbar-track">
                    <div className="catbar-fill" style={{ width: `${(c.total / maxCat) * 100}%` }} />
                  </div>
                  <span className="catbar-val">{formatKz(c.total)} · {total > 0 ? Math.round((c.total / total) * 100) : 0}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Lista de despesas */}
      <div className="card">
        <h3>Lançamentos</h3>
        {loading ? <div className="loading">A carregar…</div>
          : list.length === 0 ? (
            <div className="empty"><IconReceipt size={40} /><p>Sem despesas no período. Registe a primeira.</p></div>
          ) : (
            <table className="ptable stack">
              <thead>
                <tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>Fornecedor</th><th>Pagamento</th><th>Valor</th><th className="no-print" /></tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Data">{new Date(e.expense_date).toLocaleDateString('pt-PT')}</td>
                    <td data-label="Categoria"><span className="pill">{EXPENSE_CATEGORY_LABELS[e.category] ?? e.category}</span></td>
                    <td data-label="Descrição">{e.description || '—'}{e.document_ref ? <span className="muted"> · {e.document_ref}</span> : null}</td>
                    <td data-label="Fornecedor">{e.supplier || '—'}</td>
                    <td data-label="Pagamento">{e.payment_method ? PAYMENT_LABELS[e.payment_method] : '—'}</td>
                    <td data-label="Valor" style={{ fontWeight: 700 }}>{formatKz(Number(e.amount))}</td>
                    <td className="actions no-print">
                      <button className="btn sm ghost" title="Eliminar" onClick={() => void remove(e.id)}><IconTrash size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={5} style={{ textAlign: 'right', fontWeight: 700 }}>Total</td><td style={{ fontWeight: 800 }}>{formatKz(total)}</td><td className="no-print" /></tr>
              </tfoot>
            </table>
          )}
      </div>

      {creating ? (
        <Modal title="Novo gasto" onClose={() => setCreating(false)}>
          {formError ? <div className="banner danger" style={{ marginBottom: 12 }}>{formError}</div> : null}
          <div className="grid-2">
            <div className="field">
              <label>Categoria</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })}>
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Valor (Kz)</label>
              <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal" placeholder="0" />
            </div>
          </div>
          <div className="field">
            <label>Motivo / descrição</label>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="ex.: Táxi, renda, energia, material…" />
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Fornecedor / beneficiário</label>
              <input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder="Opcional" />
            </div>
            <div className="field">
              <label>Forma de pagamento</label>
              <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value as ExpensePayment })}>
                {(Object.keys(PAYMENT_LABELS) as ExpensePayment[]).map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
              </select>
            </div>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Nº documento (recibo/factura)</label>
              <input value={form.documentRef} onChange={(e) => setForm({ ...form, documentRef: e.target.value })} placeholder="Opcional" />
            </div>
            <div className="field">
              <label>Data</label>
              <input type="date" value={form.expenseDate} max={todayISO()} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} />
            </div>
          </div>
          <button className="btn lg block" style={{ marginTop: 14 }} onClick={save} disabled={saving}>
            {saving ? 'A guardar…' : 'Registar despesa'}
          </button>
        </Modal>
      ) : null}
    </div>
  );
}
