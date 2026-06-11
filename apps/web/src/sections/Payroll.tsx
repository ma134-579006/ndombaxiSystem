import { confirmDialog, toast } from '../components/feedback';
import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { PayrollRun, PayrollRunDetail } from '../api/types';
import { Modal } from '../components/ui';
import { IconPlus, IconReceipt, IconCheck } from '../components/Icons';
import { formatKz } from '../format';

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
const periodLabel = (r: { period_year: number; period_month: number }) =>
  `${MONTHS[r.period_month - 1] ?? r.period_month} de ${r.period_year}`;

/** Folha salarial (RH): processa INSS (3% trab. / 8% empresa) + IRT por trabalhador. */
export function Payroll() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [detail, setDetail] = useState<PayrollRunDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRuns(await api.hr.payroll.listRuns()); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const open = async (id: string) => {
    try { setDetail(await api.hr.payroll.getRun(id)); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao abrir folha.'); }
  };

  const pay = async (id: string) => {
    if (!(await confirmDialog({ message: 'Marcar esta folha como paga?' }))) return;
    try { await api.hr.payroll.pay(id); await load(); setDetail(null); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao marcar como paga.'); }
  };

  return (
    <>
      <div className="content-head">
        <h2>Folha Salarial</h2>
        <span className="spacer" />
        <button className="btn" onClick={() => setProcessing(true)}><IconPlus size={16} /> Processar folha</button>
      </div>

      {error ? <div className="banner danger">{error}</div> : null}

      <div className="card">
        <h3>Folhas processadas</h3>
        {loading ? <div className="loading">A carregar…</div> : runs.length === 0 ? (
          <div className="empty"><IconReceipt size={40} /><p>Ainda não processou nenhuma folha salarial.</p></div>
        ) : runs.map((r) => (
          <div className="list-row" key={r.id} style={{ cursor: 'pointer' }} onClick={() => open(r.id)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{periodLabel(r)}</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {r.employee_count} trab. · líquido {formatKz(r.net_total)} · custo p/ empresa {formatKz(r.employer_cost_total)}
              </div>
            </div>
            <span className="badge" style={{ color: r.status === 'PAID' ? 'var(--success)' : 'var(--warning)', borderColor: 'currentColor' }}>
              {r.status === 'PAID' ? 'Paga' : 'Processada'}
            </span>
            {r.status === 'PROCESSED' ? (
              <button className="btn sm" onClick={(e) => { e.stopPropagation(); void pay(r.id); }}><IconCheck size={14} /> Marcar paga</button>
            ) : null}
          </div>
        ))}
      </div>

      {processing ? <ProcessModal onClose={() => setProcessing(false)} onDone={async (run) => { await load(); setProcessing(false); await open(run.id); }} /> : null}
      {detail ? <RunSheet detail={detail} onClose={() => setDetail(null)} onPay={pay} /> : null}
    </>
  );
}

function ProcessModal({ onClose, onDone }: { onClose(): void; onDone(run: PayrollRun): Promise<void> | void }) {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try { const run = await api.hr.payroll.process(Number(year), Number(month)); await onDone(run); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao processar.'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Processar folha salarial" onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <p className="muted" style={{ marginTop: 0 }}>
        Calcula a folha de todos os trabalhadores activos para o período escolhido. Cada período só pode ser processado uma vez.
      </p>
      <div className="grid-2">
        <div className="field"><label>Mês</label>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select></div>
        <div className="field"><label>Ano</label>
          <input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} /></div>
      </div>
      <button className="btn lg block" style={{ marginTop: 6 }} onClick={submit} disabled={busy}>
        {busy ? 'A processar…' : 'Processar folha'}
      </button>
    </Modal>
  );
}

function RunSheet({ detail, onClose, onPay }: { detail: PayrollRunDetail; onClose(): void; onPay(id: string): void }) {
  const { run, items } = detail;
  return (
    <Modal title={`Folha · ${periodLabel(run)}`} onClose={onClose}>
      <div className="kpi-grid" style={{ marginBottom: 12 }}>
        <Kpi label="Salário bruto" value={formatKz(run.gross_total)} />
        <Kpi label="INSS (trab. 3%)" value={formatKz(run.inss_employee_total)} />
        <Kpi label="IRT retido" value={formatKz(run.irt_total)} />
        <Kpi label="Líquido a pagar" value={formatKz(run.net_total)} strong />
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        INSS empresa (8%): <strong>{formatKz(run.inss_employer_total)}</strong> · Custo total p/ empresa: <strong>{formatKz(run.employer_cost_total)}</strong>
      </div>

      <div style={{ maxHeight: '46vh', overflow: 'auto' }}>
        <table className="ptable stack">
          <thead>
            <tr><th>Trabalhador</th><th>Bruto</th><th>INSS</th><th>IRT</th><th>Líquido</th></tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td data-label="Trabalhador">
                  <div style={{ fontWeight: 600 }}>{it.employee_name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{it.employee_number}</div>
                </td>
                <td data-label="Bruto">{formatKz(it.gross_salary)}</td>
                <td data-label="INSS">{formatKz(it.inss_employee)}</td>
                <td data-label="IRT">{formatKz(it.irt)}</td>
                <td data-label="Líquido" style={{ fontWeight: 700 }}>{formatKz(it.net_salary)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ gap: 10, marginTop: 14 }}>
        <button className="btn ghost" onClick={() => window.print()}>🖨 Imprimir</button>
        <span className="spacer" />
        {run.status === 'PROCESSED' ? (
          <button className="btn" onClick={() => onPay(run.id)}><IconCheck size={16} /> Marcar como paga</button>
        ) : <span className="badge" style={{ color: 'var(--success)', borderColor: 'currentColor' }}>Paga</span>}
      </div>
    </Modal>
  );
}

function Kpi({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ fontSize: strong ? 20 : 17 }}>{value}</div>
    </div>
  );
}
