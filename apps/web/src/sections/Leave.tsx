import React, { useCallback, useEffect, useState } from 'react';
import { printSectionReport } from "../pdf/printDoc";
import { api, ApiError } from '../api/client';
import type { CreateLeaveInput, LeaveEmployee, LeaveRow, LeaveSummary, LeaveType } from '../api/types';
import { IconBuilding, IconPlus } from '../components/Icons';
import { Modal } from '../components/ui';
import { localIso } from '../format';

const TYPE_LABEL: Record<LeaveType, string> = { FERIAS: 'Férias', FALTA: 'Falta', LICENCA: 'Licença', OUTRO: 'Outro' };
const FILTERS = [
  { key: 'PENDING', label: 'Pendentes' },
  { key: 'APPROVED', label: 'Aprovados' },
  { key: 'REJECTED', label: 'Rejeitados' },
  { key: '', label: 'Todos' },
];
function todayISO(d = new Date()): string { return localIso(d); }

/** Férias / ausências: pedidos por funcionário, aprovação do gestor e saldo. */
export function Leave() {
  const [filter, setFilter] = useState('PENDING');
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [sum, setSum] = useState<LeaveSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [l, s] = await Promise.all([api.leave.list(filter || undefined), api.leave.summary()]);
      setRows(l); setSum(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar férias.');
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const review = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    setBusy(true);
    try { await api.leave.review(id, decision); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Operação falhou.'); }
    finally { setBusy(false); }
  };

  // Lista no modelo do backoffice de referência: migalhas + botões, filtro
  // segmentado com o resumo, tabela com Opções (Aprovar / Rejeitar).
  const fmtD = (v: string) => new Date(v).toLocaleDateString('pt-PT');
  return (
    <div className="vd-page">
      <div className="vd-head no-print">
        <p className="vd-crumb"><span style={{ color: 'var(--primary)' }}>Férias</span><span className="sep">/</span><span>Listagem</span></p>
        <span className="spacer" />
        <button className="vd-btn outline" onClick={() => void printSectionReport()}>Imprimir</button>
        <button className="vd-btn" onClick={() => setCreating(true)}><IconPlus size={16} /> Adicionar Pedido</button>
      </div>
      {error ? <div className="vd-err no-print" role="alert">{error}</div> : null}
      <div className="print-only print-header"><h2>Férias & Ausências</h2><p>{new Date().toLocaleDateString('pt-PT')}</p></div>

      <div className="vd-card vd-filters no-print">
        <div className="vd-frow" style={{ alignItems: 'center' }}>
          <div className="vd-seg" role="tablist" aria-label="Estado">
            {FILTERS.map((f) => (
              <button key={f.label} type="button" role="tab" aria-selected={filter === f.key} className={filter === f.key ? 'on' : ''} onClick={() => setFilter(f.key)}>{f.label}</button>
            ))}
          </div>
          <span className="spacer" style={{ flex: 1 }} />
          <div className="vd-sum">
            <span>Pendentes <b className={(sum?.pending ?? 0) > 0 ? 'bad' : ''}>{sum?.pending ?? 0}</b></span>
            <span>Dias de férias aprovados (ano) <b>{sum?.ferasDaysYear ?? 0}</b></span>
          </div>
        </div>
      </div>

      <div className="vd-card vd-tablecard">
        {loading ? <div className="vd-empty">A carregar…</div>
          : rows.length === 0 ? <div className="vd-empty">Não existem registos</div>
          : (
            <div className="vd-tablewrap">
              <table className="vd-table">
                <thead><tr><th>Funcionário</th><th>Tipo</th><th>Início</th><th>Fim</th><th className="num">Dias</th><th>Motivo</th><th>Estado</th><th className="no-print" aria-label="Opções" /></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td><b>{r.employee_name || '—'}</b></td>
                      <td>{TYPE_LABEL[r.type] ?? r.type}</td>
                      <td>{fmtD(r.start_date)}</td>
                      <td>{fmtD(r.end_date)}</td>
                      <td className="num">{r.days}</td>
                      <td>{r.reason || '—'}</td>
                      <td>{r.status === 'APPROVED' ? <span className="vd-tag ok">Aprovado</span> : r.status === 'REJECTED' ? <span className="vd-tag bad">Rejeitado</span> : <span className="vd-tag">Pendente</span>}
                        {r.reviewed_by_name ? <span className="sub">{r.reviewed_by_name}</span> : null}</td>
                      <td className="num no-print">
                        {r.status === 'PENDING' ? (
                          <span style={{ display: 'inline-flex', gap: 6 }}>
                            <button className="vd-btn sm" disabled={busy} onClick={() => review(r.id, 'APPROVED')}>Aprovar</button>
                            <button className="vd-btn sm plain" disabled={busy} onClick={() => review(r.id, 'REJECTED')}>Rejeitar</button>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {creating ? <NewModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void load(); }} /> : null}
    </div>
  );
}

function NewModal({ onClose, onCreated }: { onClose(): void; onCreated(): void }) {
  const [employees, setEmployees] = useState<LeaveEmployee[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [type, setType] = useState<LeaveType>('FERIAS');
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.leave.employees().then((e) => { setEmployees(e); if (e[0]) setEmployeeId(e[0].id); })
      .catch(() => setErr('Não foi possível carregar funcionários.'));
  }, []);

  const submit = async () => {
    if (!employeeId) { setErr('Selecione o funcionário.'); return; }
    if (endDate < startDate) { setErr('A data final é anterior à inicial.'); return; }
    setBusy(true); setErr(null);
    try {
      const payload: CreateLeaveInput = { employeeId, type, startDate, endDate, reason: reason.trim() || undefined };
      await api.leave.create(payload);
      onCreated();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível registar o pedido.');
    } finally { setBusy(false); }
  };

  return (
    <Modal title="Novo pedido de férias/ausência" onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <div className="field"><label>Funcionário</label>
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          {employees.length === 0 ? <option value="">(sem funcionários activos)</option> : null}
          {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
      </div>
      <div className="grid-2">
        <div className="field"><label>Tipo</label>
          <select value={type} onChange={(e) => setType(e.target.value as LeaveType)}>
            {(Object.keys(TYPE_LABEL) as LeaveType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </div>
        <div className="field"><label>Motivo</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Opcional" /></div>
      </div>
      <div className="grid-2">
        <div className="field"><label>Data inicial</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
        <div className="field"><label>Data final</label>
          <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} /></div>
      </div>
      <button className="btn lg block" style={{ marginTop: 12 }} onClick={submit} disabled={busy}>
        {busy ? 'A registar…' : 'Registar pedido'}
      </button>
    </Modal>
  );
}
