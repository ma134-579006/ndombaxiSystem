import React, { useCallback, useEffect, useState } from 'react';
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
        <button className="btn sm" onClick={() => window.print()}>🖨 Imprimir</button>
        <button className="btn" onClick={() => setCreating(true)}><IconPlus size={18} /> Novo pedido</button>
      </div>

      {error ? <div className="banner danger no-print">{error}</div> : null}

      <div className="print-only print-header"><h2>Férias & Ausências</h2><p>{new Date().toLocaleDateString('pt-PT')}</p></div>

      <div className="kpi-grid">
        <div className="kpi-card warning"><div className="kpi-ic"><IconBuilding size={20} /></div>
          <div className="kpi-label">Pedidos pendentes</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{sum?.pending ?? 0}</div>
          <div className="kpi-sub">a aguardar decisão</div>
        </div>
        <div className="kpi-card primary"><div className="kpi-ic"><IconBuilding size={20} /></div>
          <div className="kpi-label">Dias de férias (ano)</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{sum?.ferasDaysYear ?? 0}</div>
          <div className="kpi-sub">aprovados este ano</div>
        </div>
      </div>

      <div className="card no-print" style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <button key={f.label} className={`chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
      </div>

      <div className="card">
        {loading ? <div className="loading">A carregar…</div>
          : rows.length === 0 ? <div className="empty"><IconBuilding size={40} /><p>Sem pedidos neste filtro.</p></div>
          : (
            <table className="ptable">
              <thead><tr><th>Funcionário</th><th>Tipo</th><th>Período</th><th>Dias</th><th>Motivo</th><th>Estado</th><th className="no-print" /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.employee_name || '—'}</td>
                    <td>{TYPE_LABEL[r.type] ?? r.type}</td>
                    <td>{new Date(r.start_date).toLocaleDateString('pt-PT')} – {new Date(r.end_date).toLocaleDateString('pt-PT')}</td>
                    <td>{r.days}</td>
                    <td>{r.reason || '—'}</td>
                    <td>
                      <span className={`pill ${r.status === 'APPROVED' ? 'on' : r.status === 'REJECTED' ? 'off' : ''}`}>
                        {r.status === 'APPROVED' ? 'Aprovado' : r.status === 'REJECTED' ? 'Rejeitado' : 'Pendente'}
                      </span>
                    </td>
                    <td className="no-print">
                      {r.status === 'PENDING' ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn sm success" disabled={busy} onClick={() => review(r.id, 'APPROVED')}>Aprovar</button>
                          <button className="btn sm ghost" disabled={busy} onClick={() => review(r.id, 'REJECTED')}>Rejeitar</button>
                        </div>
                      ) : <span className="muted" style={{ fontSize: 12 }}>{r.reviewed_by_name ?? ''}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
