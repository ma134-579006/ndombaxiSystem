import React, { useCallback, useEffect, useState } from 'react';
import { printSectionReport } from "../pdf/printDoc";
import { api, ApiError } from '../api/client';
import type { CreateLeaveInput, LeaveEmployee, LeaveRow, LeaveSummary, LeaveType } from '../api/types';
import { IconBuilding, IconPlus, IconRefresh } from '../components/Icons';
import { Modal } from '../components/ui';

const TYPE_LABEL: Record<LeaveType, string> = { FERIAS: 'Férias', FALTA: 'Falta', LICENCA: 'Licença', OUTRO: 'Outro' };
const FILTERS = [
  { key: 'PENDING', label: 'Pendentes' },
  { key: 'APPROVED', label: 'Aprovados' },
  { key: 'REJECTED', label: 'Rejeitados' },
  { key: '', label: 'Todos' },
];
function todayISO(d = new Date()): string { return d.toISOString().slice(0, 10); }

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

  return (
    <div className="profit-page">
      <div className="content-head no-print">
        <h2>Férias & ausências</h2>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => void load()}><IconRefresh size={15} /> Atualizar</button>
        <button className="btn sm" onClick={() => void printSectionReport()}>Imprimir</button>
        <button className="btn" onClick={() => setCreating(true)}><IconPlus size={18} /> Novo pedido</button>
      </div>

      {error ? <div className="banner danger no-print">{error}</div> : null}

      <div className="print-only print-header"><h2>Férias & Ausências</h2><p>{new Date().toLocaleDateString('pt-PT')}</p></div>

      <div className="ph-kpis no-print">
        <div className={`ui-tile${(sum?.pending ?? 0) > 0 ? ' warn' : ''}`}><div className="ui-tile-l">Pedidos pendentes</div><div className="ui-tile-v">{sum?.pending ?? 0}</div><div className="ui-tile-h">a aguardar decisão</div></div>
        <div className="ui-tile info"><div className="ui-tile-l">Dias de férias (ano)</div><div className="ui-tile-v">{sum?.ferasDaysYear ?? 0}</div><div className="ui-tile-h">aprovados este ano</div></div>
      </div>

      <div className="fx-tabs inv-tabs no-print">
        {FILTERS.map((f) => (
          <button key={f.label} className={filter === f.key ? 'on' : ''} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>

      {loading ? <div className="card"><div className="loading">A carregar…</div></div>
        : rows.length === 0 ? <div className="card"><div className="empty"><IconBuilding size={40} /><p>Sem pedidos neste filtro.</p></div></div>
        : (
          <div className="rc-list">
            {rows.map((r) => (
              <div key={r.id} className={`rc-row rc-static lv-row lt-${r.type} st-${r.status === 'APPROVED' ? 'READY' : r.status === 'REJECTED' ? 'CANCELLED' : 'IN_PROGRESS'}`}>
                <span className="rc-av">{(r.employee_name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
                <div className="rc-main">
                  <strong>{r.employee_name || '—'}<span className="lv-type">{TYPE_LABEL[r.type] ?? r.type}</span></strong>
                  <div className="muted">{new Date(r.start_date).toLocaleDateString('pt-PT')} → {new Date(r.end_date).toLocaleDateString('pt-PT')} · {r.reason || 'sem motivo'}</div>
                </div>
                <span className="rc-amt">{r.days}<small>{r.days === 1 ? 'dia' : 'dias'}</small></span>
                <span className="rc-state">{r.status === 'APPROVED' ? 'Aprovado' : r.status === 'REJECTED' ? 'Rejeitado' : 'Pendente'}</span>
                <div className="lv-act no-print">
                  {r.status === 'PENDING' ? (
                    <>
                      <button className="btn sm success" disabled={busy} onClick={() => review(r.id, 'APPROVED')}>Aprovar</button>
                      <button className="btn sm ghost" disabled={busy} onClick={() => review(r.id, 'REJECTED')}>Rejeitar</button>
                    </>
                  ) : <span className="muted" style={{ fontSize: 12 }}>{r.reviewed_by_name ?? ''}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

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
