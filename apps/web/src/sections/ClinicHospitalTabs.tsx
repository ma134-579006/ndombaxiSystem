import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type {
  ClinicAdmission, ClinicBed, ClinicClaim, ClinicExamRow, ClinicInsurer, ClinicMedication, ClinicPatient,
  ClinicPatientRecord, ClinicPrescriptionDetail, ClinicPrescriptionRow,
  ClinicProfessional, ClinicTriageRow,
} from '../api/types';
import { confirmDialog, toast } from '../components/feedback';
import { IconPlus, IconSearch } from '../components/Icons';
import { Modal } from '../components/ui';
import { formatKz } from '../format';

const KZ = (n: string | number) => formatKz(Number(n) || 0);
const fmtDT = (s: string | null) => { if (!s) return '—'; try { return new Date(s).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }); } catch { return s; } };
const errMsg = (e: unknown, fb: string) => (e instanceof ApiError ? e.message : fb);

// ── EMERGÊNCIA (triagem de Manchester) ─────────────────────────
const RISKS: Array<{ id: string; label: string; color: string }> = [
  { id: 'RED', label: 'Emergente', color: '#e5484d' },
  { id: 'ORANGE', label: 'Muito urgente', color: '#f76b15' },
  { id: 'YELLOW', label: 'Urgente', color: '#f5d90a' },
  { id: 'GREEN', label: 'Pouco urgente', color: '#30a46c' },
  { id: 'BLUE', label: 'Não urgente', color: '#0091ff' },
];
const riskOf = (id: string) => RISKS.find((r) => r.id === id) ?? RISKS[3];
const TRIAGE_NEXT: Record<string, Array<{ id: string; label: string }>> = {
  WAITING: [{ id: 'IN_CARE', label: 'Atender' }],
  IN_CARE: [{ id: 'OBSERVATION', label: 'Observação' }, { id: 'DISCHARGED', label: 'Alta' }, { id: 'ADMITTED', label: 'Internar' }],
  OBSERVATION: [{ id: 'DISCHARGED', label: 'Alta' }, { id: 'ADMITTED', label: 'Internar' }],
};

export function EmergencyTab({ patients }: { patients: ClinicPatient[] }) {
  const [rows, setRows] = useState<ClinicTriageRow[]>([]);
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => { try { setRows(await api.clinic.emergency()); } catch { /* */ } }, []);
  useEffect(() => { void load(); const t = window.setInterval(load, 10000); return () => window.clearInterval(t); }, [load]);

  const advance = async (r: ClinicTriageRow, status: string) => {
    if (status === 'ADMITTED' && !(await confirmDialog({ message: `Internar ${r.patient_name}? (o leito escolhe-se no separador Internação)` }))) return;
    await api.clinic.triageStatus(r.id, status).catch((e) => toast.error(errMsg(e, 'Falha.')));
    await load();
  };

  return (
    <>
      <div className="content-head" style={{ marginTop: 0 }}>
        <h3 style={{ margin: 0 }}>🚑 Fila de emergência</h3>
        <span className="spacer" />
        <button className="btn" onClick={() => setAdding(true)}><IconPlus size={16} /> Nova chegada</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {rows.length === 0 ? <div className="empty" style={{ padding: 26 }}><p>Sem episódios de emergência ativos.</p></div>
          : rows.map((r) => {
            const risk = riskOf(r.risk);
            return (
              <div key={r.id} className="list-row" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, borderLeft: `5px solid ${risk.color}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 14 }}>{r.patient_name}</strong>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    {risk.label} · {r.complaint || 'sem queixa registada'} · espera {r.wait_min} min
                    {r.professional ? ` · ${r.professional}` : ''}{r.room ? ` · sala ${r.room}` : ''}
                  </div>
                </div>
                <span className="pill off">{r.status === 'WAITING' ? 'Em espera' : r.status === 'IN_CARE' ? 'Em atendimento' : 'Observação'}</span>
                {(TRIAGE_NEXT[r.status] ?? []).map((n) => (
                  <button key={n.id} className="btn sm ghost" onClick={() => void advance(r, n.id)}>{n.label}</button>
                ))}
              </div>
            );
          })}
      </div>
      {adding ? <TriageModal patients={patients} onClose={() => setAdding(false)} onDone={() => { setAdding(false); void load(); }} /> : null}
    </>
  );
}

function TriageModal({ patients, onClose, onDone }: { patients: ClinicPatient[]; onClose(): void; onDone(): void }) {
  const [f, setF] = useState({ patientId: '', patientName: '', complaint: '', risk: 'GREEN', room: '', professional: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.patientId && !f.patientName.trim()) { toast.warning('Indique o paciente.'); return; }
    setBusy(true);
    try {
      const dto: Record<string, unknown> = { risk: f.risk };
      if (f.patientId) dto.patientId = f.patientId; else dto.patientName = f.patientName.trim();
      if (f.complaint.trim()) dto.complaint = f.complaint.trim();
      if (f.room.trim()) dto.room = f.room.trim();
      if (f.professional.trim()) dto.professional = f.professional.trim();
      await api.clinic.triage(dto); toast.success('Chegada registada na triagem.'); onDone();
    } catch (e) { toast.error(errMsg(e, 'Falha ao registar.')); } finally { setBusy(false); }
  };
  return (
    <Modal title="🚑 Triagem — nova chegada" onClose={onClose}>
      <div className="field"><label>Paciente (ficha)</label>
        <select value={f.patientId} onChange={(e) => setF({ ...f, patientId: e.target.value })}>
          <option value="">— sem ficha (indicar nome) —</option>
          {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></div>
      {!f.patientId ? (
        <div className="field"><label>Nome do paciente</label><input value={f.patientName} onChange={(e) => setF({ ...f, patientName: e.target.value })} /></div>
      ) : null}
      <div className="field"><label>Queixa principal</label><input value={f.complaint} onChange={(e) => setF({ ...f, complaint: e.target.value })} placeholder="ex.: dor torácica" /></div>
      <div className="field"><label>Classificação de risco (Manchester)</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {RISKS.map((r) => (
            <button key={r.id} className="btn sm" onClick={() => setF({ ...f, risk: r.id })}
              style={{ borderColor: r.color, background: f.risk === r.id ? r.color : 'transparent', color: f.risk === r.id ? '#fff' : 'var(--text)' }}>
              {r.label}
            </button>
          ))}
        </div></div>
      <div className="grid-2">
        <div className="field"><label>Sala (opcional)</label><input value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} /></div>
        <div className="field"><label>Profissional (opcional)</label><input value={f.professional} onChange={(e) => setF({ ...f, professional: e.target.value })} /></div>
      </div>
      <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A registar…' : 'Registar chegada'}</button>
    </Modal>
  );
}

// ── INTERNAÇÃO (leitos) ────────────────────────────────────────
const WARD_ICON: Record<string, string> = { ENFERMARIA: '🛏️', UTI: '💟', ISOLAMENTO: '🚧', QUARTO: '🚪' };
const BED_LABEL: Record<string, string> = { FREE: 'Livre', OCCUPIED: 'Ocupado', CLEANING: 'Limpeza', MAINTENANCE: 'Manutenção', BLOCKED: 'Bloqueado' };

export function BedsTab({ patients }: { patients: ClinicPatient[] }) {
  const [beds, setBeds] = useState<ClinicBed[]>([]);
  const [newBed, setNewBed] = useState(false);
  const [admitting, setAdmitting] = useState<ClinicBed | null>(null);
  const load = useCallback(async () => { try { setBeds(await api.clinic.beds()); } catch { /* */ } }, []);
  useEffect(() => { void load(); }, [load]);

  const discharge = async (b: ClinicBed, outcome: string) => {
    const verb = outcome === 'DECEASED' ? 'registar o ÓBITO de' : 'dar ALTA a';
    if (!(await confirmDialog({ message: `Confirmar ${verb} ${b.admitted_patient}? As diárias serão calculadas e o leito passa a limpeza.`, danger: outcome === 'DECEASED' }))) return;
    try {
      const r = await api.clinic.discharge(b.admission_id!, outcome);
      toast.success(`Internação fechada: ${r.days} diária(s), total ${KZ(r.total)}. Leito em limpeza.`);
      await load();
    } catch (e) { toast.error(errMsg(e, 'Falha.')); }
  };
  const setStatus = async (b: ClinicBed, status: string) => {
    await api.clinic.bedStatus(b.id, status).catch((e) => toast.error(errMsg(e, 'Falha.')));
    await load();
  };
  const [admHistory, setAdmHistory] = useState<ClinicAdmission[]>([]);
  const loadHistory = useCallback(async () => { try { setAdmHistory(await api.clinic.admissions()); } catch { /* */ } }, []);
  useEffect(() => { void loadHistory(); }, [loadHistory, beds]);
  const invoiceAdm = async (a: ClinicAdmission) => {
    try { const r = await api.clinic.invoiceAdmission(a.id); toast.success(`Fatura ${r.invoiceNumber} emitida.`); await loadHistory(); }
    catch (e) { toast.error(errMsg(e, 'Falha ao faturar.')); }
  };

  return (
    <>
      <div className="content-head" style={{ marginTop: 0 }}>
        <h3 style={{ margin: 0 }}>🛏️ Mapa de leitos</h3>
        <span className="spacer" />
        <button className="btn ghost" onClick={() => setNewBed(true)}><IconPlus size={16} /> Novo leito</button>
      </div>
      {beds.length === 0 ? (
        <div className="card"><div className="empty"><p>Sem leitos. Crie o primeiro (ex.: ENF-01, UTI-01).</p></div></div>
      ) : (
        <div className="pgrid">
          {beds.map((b) => {
            const occupied = b.status === 'OCCUPIED';
            const tone = occupied ? 'var(--warning)' : b.status === 'FREE' ? 'var(--success, #30a46c)' : 'var(--muted, #888)';
            return (
              <div key={b.id} className="pcard" style={{ textAlign: 'left', borderTop: `4px solid ${tone}` }}>
                <div className="thumb" style={{ fontSize: 26, display: 'grid', placeItems: 'center' }}>{WARD_ICON[b.ward] ?? '🛏️'}</div>
                <div className="pinfo">
                  <div className="pname">{b.code} <span className="muted" style={{ fontWeight: 400 }}>· {b.ward}{b.room ? ` · ${b.room}` : ''}</span></div>
                  <div className="pcode">{occupied ? `${b.admitted_patient} · desde ${fmtDT(b.admitted_at)}` : `${BED_LABEL[b.status] ?? b.status} · diária ${KZ(b.daily_rate)}`}</div>
                  <div className="pfoot" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {b.status === 'FREE' ? <button className="btn sm" onClick={() => setAdmitting(b)}>Internar</button> : null}
                    {occupied ? <>
                      <button className="btn sm" onClick={() => void discharge(b, 'DISCHARGED')}>Alta</button>
                      <button className="btn sm ghost" onClick={() => void discharge(b, 'DECEASED')}>Óbito</button>
                    </> : null}
                    {b.status === 'CLEANING' ? <button className="btn sm ghost" onClick={() => void setStatus(b, 'FREE')}>Limpo ✓</button> : null}
                    {b.status === 'FREE' ? <button className="btn sm ghost" onClick={() => void setStatus(b, 'MAINTENANCE')}>Manutenção</button> : null}
                    {b.status === 'MAINTENANCE' ? <button className="btn sm ghost" onClick={() => void setStatus(b, 'FREE')}>Reparado ✓</button> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* Internações com alta — faturação hospitalar (documento fiscal AGT) */}
      {admHistory.filter((a) => a.status !== 'ADMITTED').length > 0 ? (
        <>
          <div className="content-head"><h3 style={{ margin: 0 }}>🧾 Internações — faturação</h3></div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {admHistory.filter((a) => a.status !== 'ADMITTED').slice(0, 30).map((a) => (
              <div key={a.id} className="list-row" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 13.5 }}>{a.number}</strong> <span className="muted">· {a.patient_name ?? '—'}</span>
                  <div className="muted" style={{ fontSize: 12 }}>{a.bed_label ?? '—'} · {a.status === 'DECEASED' ? 'óbito' : 'alta'} {fmtDT(a.discharged_at)} · total {KZ(a.total)}</div>
                </div>
                {a.invoice_id ? <span className="pill on">Faturada</span>
                  : Number(a.total) > 0 ? <button className="btn sm" onClick={() => void invoiceAdm(a)}>🧾 Faturar</button>
                  : <span className="muted" style={{ fontSize: 12 }}>sem valor</span>}
              </div>
            ))}
          </div>
        </>
      ) : null}
      {newBed ? <NewBedModal onClose={() => setNewBed(false)} onDone={() => { setNewBed(false); void load(); }} /> : null}
      {admitting ? <AdmitModal bed={admitting} patients={patients} onClose={() => setAdmitting(null)} onDone={() => { setAdmitting(null); void load(); }} /> : null}
    </>
  );
}

function NewBedModal({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const [f, setF] = useState({ code: '', ward: 'ENFERMARIA', room: '', dailyRate: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.code.trim()) { toast.warning('Indique o código (ex.: ENF-01).'); return; }
    setBusy(true);
    try {
      await api.clinic.createBed({ code: f.code.trim(), ward: f.ward, room: f.room.trim() || undefined, dailyRate: Number(f.dailyRate) || 0 });
      toast.success('Leito criado.'); onDone();
    } catch (e) { toast.error(errMsg(e, 'Falha.')); } finally { setBusy(false); }
  };
  return (
    <Modal title="Novo leito" onClose={onClose}>
      <div className="grid-2">
        <div className="field"><label>Código</label><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="ENF-01" /></div>
        <div className="field"><label>Ala</label>
          <select value={f.ward} onChange={(e) => setF({ ...f, ward: e.target.value })}>
            <option value="ENFERMARIA">Enfermaria</option><option value="UTI">UTI</option>
            <option value="ISOLAMENTO">Isolamento</option><option value="QUARTO">Quarto privado</option>
          </select></div>
      </div>
      <div className="grid-2">
        <div className="field"><label>Sala/quarto (opcional)</label><input value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} /></div>
        <div className="field"><label>Diária (Kz, c/ IVA)</label><input value={f.dailyRate} onChange={(e) => setF({ ...f, dailyRate: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" /></div>
      </div>
      <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A criar…' : 'Criar leito'}</button>
    </Modal>
  );
}

function AdmitModal({ bed, patients, onClose, onDone }: { bed: ClinicBed; patients: ClinicPatient[]; onClose(): void; onDone(): void }) {
  const [f, setF] = useState({ patientId: '', professional: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.patientId) { toast.warning('Escolha o paciente.'); return; }
    setBusy(true);
    try {
      const r = await api.clinic.admit({ patientId: f.patientId, bedId: bed.id, professional: f.professional.trim() || undefined, reason: f.reason.trim() || undefined });
      toast.success(`Internação ${r.number} criada — leito ${bed.code} ocupado.`); onDone();
    } catch (e) { toast.error(errMsg(e, 'Falha ao internar.')); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Internar — leito ${bed.code} (${bed.ward})`} onClose={onClose}>
      <div className="field"><label>Paciente</label>
        <select value={f.patientId} onChange={(e) => setF({ ...f, patientId: e.target.value })}>
          <option value="">— escolher —</option>
          {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></div>
      <div className="field"><label>Médico responsável</label><input value={f.professional} onChange={(e) => setF({ ...f, professional: e.target.value })} placeholder="Dr(a). …" /></div>
      <div className="field"><label>Motivo / diagnóstico</label><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
      <p className="muted" style={{ fontSize: 12 }}>Diária do leito: <strong>{KZ(bed.daily_rate)}</strong> (congelada na admissão).</p>
      <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A internar…' : 'Internar paciente'}</button>
    </Modal>
  );
}

// ── RECEITAS MÉDICAS (farmácia: dispensa FEFO) ─────────────────
const RX_LABEL: Record<string, string> = { ISSUED: 'Por dispensar', DISPENSED: 'Dispensada', CANCELLED: 'Cancelada' };

export function PrescriptionsTab({ patients }: { patients: ClinicPatient[] }) {
  const [rows, setRows] = useState<ClinicPrescriptionRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<ClinicPrescriptionDetail | null>(null);
  const load = useCallback(async () => { try { setRows(await api.clinic.prescriptions()); } catch { /* */ } }, []);
  useEffect(() => { void load(); }, [load]);

  const open = async (id: string) => {
    try { setDetail(await api.clinic.prescription(id)); } catch (e) { toast.error(errMsg(e, 'Falha.')); }
  };
  const dispense = async () => {
    if (!detail) return;
    if (!(await confirmDialog({ message: `Dispensar a receita ${detail.prescription.number}? O stock da farmácia baixa por lote (validade mais próxima primeiro).` }))) return;
    try {
      await api.clinic.dispense(detail.prescription.id);
      toast.success('Receita dispensada — stock da farmácia atualizado.');
      setDetail(null); await load();
    } catch (e) { toast.error(errMsg(e, 'Falha ao dispensar.')); }
  };
  const invoiceRx = async () => {
    if (!detail) return;
    try {
      const inv = await api.clinic.invoicePrescription(detail.prescription.id);
      toast.success(`Fatura ${inv.invoiceNumber} emitida.`);
      setDetail(null); await load();
    } catch (e) { toast.error(errMsg(e, 'Falha ao faturar.')); }
  };

  return (
    <>
      <div className="content-head" style={{ marginTop: 0 }}>
        <h3 style={{ margin: 0 }}>💊 Receitas médicas</h3>
        <span className="spacer" />
        <button className="btn" onClick={() => setCreating(true)}><IconPlus size={16} /> Nova receita</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {rows.length === 0 ? <div className="empty" style={{ padding: 26 }}><p>Sem receitas. Emita a primeira.</p></div>
          : rows.map((r) => (
            <div key={r.id} className="list-row" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => void open(r.id)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 13.5 }}>{r.number}</strong> <span className="muted">· {r.patient_name ?? '—'}</span>
                <div className="muted" style={{ fontSize: 12 }}>{r.professional ?? '—'} · {r.item_count} medicamento(s) · {fmtDT(r.issued_at)}</div>
              </div>
              <span className={`pill ${r.status === 'DISPENSED' ? 'on' : 'off'}`}>{RX_LABEL[r.status] ?? r.status}</span>
              {r.status === 'DISPENSED' && r.invoice_id ? <span className="pill on">🧾</span>
                : r.status === 'DISPENSED' && r.has_billable ? <span className="pill off">a faturar</span> : null}
            </div>
          ))}
      </div>
      {creating ? <NewPrescriptionModal patients={patients} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void load(); }} /> : null}
      {detail ? (
        <Modal title={`Receita ${detail.prescription.number}`} onClose={() => setDetail(null)}>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            {detail.prescription.patient_name ?? '—'} · {detail.prescription.professional ?? '—'} · {RX_LABEL[detail.prescription.status] ?? detail.prescription.status}
          </p>
          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
            {detail.items.map((it) => (
              <div key={it.id} className="list-row" style={{ padding: '9px 14px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 13.5 }}>{it.medication}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {[it.dosage, it.posology, it.route, it.duration].filter(Boolean).join(' · ') || 'sem posologia'}
                    {it.product_code ? ` · farmácia: ${it.product_code} (stock ${Number(it.product_stock ?? 0)})` : ' · medicamento externo'}
                  </div>
                </div>
                <span className="muted" style={{ fontSize: 12.5 }}>{Number(it.quantity)} un</span>
              </div>
            ))}
          </div>
          {detail.prescription.status === 'ISSUED' ? (
            <button className="btn lg block" onClick={() => void dispense()}>💊 Dispensar na farmácia (baixa stock FEFO)</button>
          ) : detail.prescription.status === 'DISPENSED' ? (
            detail.prescription.invoice_id
              ? <div className="pill on" style={{ display: 'block', textAlign: 'center', padding: 10 }}>🧾 Receita faturada</div>
              : detail.items.some((i) => i.product_code)
                ? <button className="btn lg block" onClick={() => void invoiceRx()}>🧾 Faturar medicamentos (documento AGT)</button>
                : <p className="muted" style={{ fontSize: 12, textAlign: 'center' }}>Sem medicamentos faturáveis (externos/sem preço).</p>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}

interface RxItemDraft { productId?: string; medication: string; dosage: string; posology: string; route: string; duration: string; quantity: string }

function NewPrescriptionModal({ patients, onClose, onDone }: { patients: ClinicPatient[]; onClose(): void; onDone(): void }) {
  const [patientId, setPatientId] = useState('');
  const [professional, setProfessional] = useState('');
  const [items, setItems] = useState<RxItemDraft[]>([]);
  const [q, setQ] = useState('');
  const [meds, setMeds] = useState<ClinicMedication[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!q.trim()) { setMeds([]); return; }
    const t = window.setTimeout(() => { api.clinic.medications(q).then(setMeds).catch(() => setMeds([])); }, 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const addMed = (m: ClinicMedication) => {
    if (items.some((i) => i.productId === m.id)) return;
    setItems([...items, { productId: m.id, medication: m.name, dosage: '', posology: '', route: 'Oral', duration: '', quantity: '1' }]);
    setQ(''); setMeds([]);
  };
  const addExternal = () => {
    if (!q.trim()) return;
    setItems([...items, { medication: q.trim(), dosage: '', posology: '', route: 'Oral', duration: '', quantity: '1' }]);
    setQ(''); setMeds([]);
  };
  const patch = (i: number, p: Partial<RxItemDraft>) => setItems(items.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const save = async () => {
    if (!patientId) { toast.warning('Escolha o paciente.'); return; }
    if (items.length === 0) { toast.warning('Adicione pelo menos 1 medicamento.'); return; }
    setBusy(true);
    try {
      const r = await api.clinic.createPrescription({
        patientId, professional: professional.trim() || undefined,
        items: items.map((i) => ({
          productId: i.productId, medication: i.medication,
          dosage: i.dosage.trim() || undefined, posology: i.posology.trim() || undefined,
          route: i.route.trim() || undefined, duration: i.duration.trim() || undefined,
          quantity: Number(i.quantity) || 1,
        })),
      });
      toast.success(`Receita ${r.number} emitida.`); onDone();
    } catch (e) { toast.error(errMsg(e, 'Falha ao emitir.')); } finally { setBusy(false); }
  };

  return (
    <Modal title="💊 Nova receita médica" onClose={onClose}>
      <div className="grid-2">
        <div className="field"><label>Paciente</label>
          <select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
            <option value="">— escolher —</option>
            {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
        <div className="field"><label>Médico</label><input value={professional} onChange={(e) => setProfessional(e.target.value)} placeholder="Dr(a). …" /></div>
      </div>

      <div className="card" style={{ padding: '2px 12px', marginBottom: 8 }}>
        <div className="row"><IconSearch size={18} />
          <input style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '10px 0', color: 'var(--text)' }}
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar medicamento na farmácia…" />
        </div>
      </div>
      {meds.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 8, maxHeight: '20vh', overflowY: 'auto' }}>
          {meds.map((m) => (
            <button key={m.id} className="list-row" style={{ width: '100%', textAlign: 'left', padding: '8px 14px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text)' }} onClick={() => addMed(m)}>
              <strong style={{ fontSize: 13 }}>{m.name}</strong>
              <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                {m.active_ingredient ? `${m.active_ingredient} · ` : ''}stock {Number(m.stock_qty)}{m.next_expiry ? ` · val. ${m.next_expiry.slice(0, 10)}` : ''}{m.requires_prescription ? ' · 🔒 controlado' : ''}
              </span>
            </button>
          ))}
        </div>
      ) : q.trim() ? (
        <button className="btn sm ghost" style={{ marginBottom: 8 }} onClick={addExternal}>+ Adicionar "{q.trim()}" como medicamento externo</button>
      ) : null}

      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
        {items.length === 0 ? <div className="empty" style={{ padding: 14 }}><p>Sem medicamentos. Procure acima.</p></div>
          : items.map((it, i) => (
            <div key={i} className="list-row" style={{ padding: '8px 14px', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <strong style={{ fontSize: 13, flexBasis: '100%' }}>{it.medication}{it.productId ? '' : ' (externo)'}</strong>
              <input value={it.dosage} onChange={(e) => patch(i, { dosage: e.target.value })} placeholder="dose (500 mg)" style={{ width: 110 }} />
              <input value={it.posology} onChange={(e) => patch(i, { posology: e.target.value })} placeholder="posologia (8/8h)" style={{ width: 130 }} />
              <input value={it.route} onChange={(e) => patch(i, { route: e.target.value })} placeholder="via" style={{ width: 70 }} />
              <input value={it.duration} onChange={(e) => patch(i, { duration: e.target.value })} placeholder="duração" style={{ width: 90 }} />
              <input value={it.quantity} onChange={(e) => patch(i, { quantity: e.target.value.replace(/[^\d]/g, '') })} placeholder="qtd" inputMode="numeric" style={{ width: 56 }} />
              <button className="btn sm ghost" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
      </div>
      <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A emitir…' : 'Emitir receita'}</button>
    </Modal>
  );
}

// ── PROFISSIONAIS DE SAÚDE ─────────────────────────────────────
const CAT_LABEL: Record<string, string> = {
  MEDICO: '🧑‍⚕️ Médico', ENFERMEIRO: '💉 Enfermeiro', TECNICO: '🔬 Técnico', RECECAO: '🛎️ Receção',
  LABORATORIO: '🧪 Laboratório', FARMACIA: '💊 Farmácia', ADMIN: '📋 Administração', OUTRO: '👤 Outro',
};

export function ProfessionalsTab() {
  const [rows, setRows] = useState<ClinicProfessional[]>([]);
  const [creating, setCreating] = useState(false);
  const load = useCallback(async () => { try { setRows(await api.clinic.professionals()); } catch { /* */ } }, []);
  useEffect(() => { void load(); }, [load]);

  const toggleOnCall = async (p: ClinicProfessional) => {
    await api.clinic.updateProfessional(p.id, { onCall: !p.on_call }).catch((e) => toast.error(errMsg(e, 'Falha.')));
    await load();
  };

  return (
    <>
      <div className="content-head" style={{ marginTop: 0 }}>
        <h3 style={{ margin: 0 }}>🧑‍⚕️ Profissionais de saúde</h3>
        <span className="spacer" />
        <button className="btn" onClick={() => setCreating(true)}><IconPlus size={16} /> Novo profissional</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {rows.length === 0 ? <div className="empty" style={{ padding: 26 }}><p>Sem profissionais registados.</p></div>
          : rows.map((p) => (
            <div key={p.id} className="list-row" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 13.5 }}>{p.name}</strong>
                <div className="muted" style={{ fontSize: 12 }}>
                  {CAT_LABEL[p.category] ?? p.category}
                  {p.specialty ? ` · ${p.specialty}` : ''}{p.license_number ? ` · nº ordem ${p.license_number}` : ''}
                  {p.office ? ` · consultório ${p.office}` : ''}{p.schedule ? ` · ${p.schedule}` : ''}
                </div>
              </div>
              {p.category === 'MEDICO' ? (
                <button className={`btn sm ${p.on_call ? '' : 'ghost'}`} onClick={() => void toggleOnCall(p)}>
                  {p.on_call ? '🟢 De plantão' : 'Fora de plantão'}
                </button>
              ) : null}
            </div>
          ))}
      </div>
      {creating ? <NewProfessionalModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); void load(); }} /> : null}
    </>
  );
}

function NewProfessionalModal({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const [f, setF] = useState({ name: '', category: 'MEDICO', licenseNumber: '', specialty: '', office: '', schedule: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.name.trim()) { toast.warning('Indique o nome.'); return; }
    setBusy(true);
    try {
      const dto: Record<string, unknown> = { name: f.name.trim(), category: f.category };
      if (f.licenseNumber.trim()) dto.licenseNumber = f.licenseNumber.trim();
      if (f.specialty.trim()) dto.specialty = f.specialty.trim();
      if (f.office.trim()) dto.office = f.office.trim();
      if (f.schedule.trim()) dto.schedule = f.schedule.trim();
      await api.clinic.createProfessional(dto); toast.success('Profissional registado.'); onDone();
    } catch (e) { toast.error(errMsg(e, 'Falha.')); } finally { setBusy(false); }
  };
  return (
    <Modal title="Novo profissional" onClose={onClose}>
      <div className="field"><label>Nome</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div className="grid-2">
        <div className="field"><label>Categoria</label>
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {Object.entries(CAT_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></div>
        <div className="field"><label>Nº da ordem / carteira</label><input value={f.licenseNumber} onChange={(e) => setF({ ...f, licenseNumber: e.target.value })} /></div>
      </div>
      <div className="grid-2">
        <div className="field"><label>Especialidade</label><input value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })} placeholder="ex.: Pediatria" /></div>
        <div className="field"><label>Consultório</label><input value={f.office} onChange={(e) => setF({ ...f, office: e.target.value })} placeholder="ex.: 2" /></div>
      </div>
      <div className="field"><label>Horário</label><input value={f.schedule} onChange={(e) => setF({ ...f, schedule: e.target.value })} placeholder="ex.: 2ª-6ª 08h-16h" /></div>
      <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A registar…' : 'Registar profissional'}</button>
    </Modal>
  );
}

// ── EXAMES ─────────────────────────────────────────────────────
const EXAM_LABEL: Record<string, string> = { REQUESTED: 'Pedido', COLLECTED: 'Colhido', IN_LAB: 'No laboratório', DONE: 'Concluído', DELIVERED: 'Entregue' };
const EXAM_NEXT: Record<string, { id: string; label: string }> = {
  REQUESTED: { id: 'COLLECTED', label: 'Colher' }, COLLECTED: { id: 'IN_LAB', label: 'Enviar ao lab.' },
  IN_LAB: { id: 'DONE', label: 'Concluir' }, DONE: { id: 'DELIVERED', label: 'Entregar' },
};

export function ExamsTab({ patients }: { patients: ClinicPatient[] }) {
  const [rows, setRows] = useState<ClinicExamRow[]>([]);
  const [creating, setCreating] = useState(false);
  const load = useCallback(async () => { try { setRows(await api.clinic.exams()); } catch { /* */ } }, []);
  useEffect(() => { void load(); }, [load]);

  const advance = async (r: ClinicExamRow) => {
    const next = EXAM_NEXT[r.status];
    if (!next) return;
    let resultText: string | undefined;
    if (next.id === 'DONE') {
      resultText = window.prompt('Resultado / laudo (opcional):') ?? undefined;
    }
    await api.clinic.examStatus(r.id, next.id, resultText).catch((e) => toast.error(errMsg(e, 'Falha.')));
    await load();
  };
  const invoiceExam = async (r: ClinicExamRow) => {
    try {
      const inv = await api.clinic.invoiceExam(r.id);
      if (inv.insurer && Number(inv.covered) > 0) {
        const paciente = inv.invoiceNumber ? `paciente ${KZ(inv.copay ?? 0)} (FT ${inv.invoiceNumber})` : 'paciente 0 (100% coberto)';
        toast.success(`Convénio ${inv.insurer}: cobre ${KZ(inv.covered)}, ${paciente}.`);
      } else {
        toast.success(`Fatura ${inv.invoiceNumber} emitida.`);
      }
      await load();
    } catch (e) { toast.error(errMsg(e, 'Falha ao faturar.')); }
  };

  return (
    <>
      <div className="content-head" style={{ marginTop: 0 }}>
        <h3 style={{ margin: 0 }}>🧪 Exames</h3>
        <span className="spacer" />
        <button className="btn" onClick={() => setCreating(true)}><IconPlus size={16} /> Solicitar exame</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {rows.length === 0 ? <div className="empty" style={{ padding: 26 }}><p>Sem exames.</p></div>
          : rows.map((r) => (
            <div key={r.id} className="list-row" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 13.5 }}>{r.exam_type}</strong> <span className="muted">· {r.patient_name ?? '—'}</span>
                <div className="muted" style={{ fontSize: 12 }}>
                  {r.requested_by ? `pedido por ${r.requested_by} · ` : ''}{fmtDT(r.requested_at)}
                  {r.result_text ? ` · 📄 ${r.result_text.slice(0, 60)}` : ''}
                </div>
              </div>
              <span className={`pill ${['DONE', 'DELIVERED'].includes(r.status) ? 'on' : 'off'}`}>{EXAM_LABEL[r.status] ?? r.status}</span>
              {EXAM_NEXT[r.status] ? <button className="btn sm ghost" onClick={() => void advance(r)}>{EXAM_NEXT[r.status].label}</button> : null}
              {['DONE', 'DELIVERED'].includes(r.status) && Number(r.fee) > 0
                ? (r.invoice_id ? <span className="pill on">Faturado</span> : <button className="btn sm" onClick={() => void invoiceExam(r)}>🧾 Faturar</button>)
                : null}
            </div>
          ))}
      </div>
      {creating ? <NewExamModal patients={patients} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void load(); }} /> : null}
    </>
  );
}

function NewExamModal({ patients, onClose, onDone }: { patients: ClinicPatient[]; onClose(): void; onDone(): void }) {
  const [f, setF] = useState({ patientId: '', examType: '', requestedBy: '', fee: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.examType.trim()) { toast.warning('Indique o tipo de exame.'); return; }
    setBusy(true);
    try {
      const dto: Record<string, unknown> = { examType: f.examType.trim(), fee: Number(f.fee) || 0 };
      if (f.patientId) dto.patientId = f.patientId;
      if (f.requestedBy.trim()) dto.requestedBy = f.requestedBy.trim();
      await api.clinic.requestExam(dto); toast.success('Exame solicitado.'); onDone();
    } catch (e) { toast.error(errMsg(e, 'Falha.')); } finally { setBusy(false); }
  };
  return (
    <Modal title="🧪 Solicitar exame" onClose={onClose}>
      <div className="field"><label>Paciente</label>
        <select value={f.patientId} onChange={(e) => setF({ ...f, patientId: e.target.value })}>
          <option value="">— escolher —</option>
          {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></div>
      <div className="field"><label>Tipo de exame</label><input value={f.examType} onChange={(e) => setF({ ...f, examType: e.target.value })} placeholder="ex.: Hemograma completo, Raio-X tórax" /></div>
      <div className="grid-2">
        <div className="field"><label>Pedido por</label><input value={f.requestedBy} onChange={(e) => setF({ ...f, requestedBy: e.target.value })} placeholder="Dr(a). …" /></div>
        <div className="field"><label>Preço (Kz)</label><input value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" /></div>
      </div>
      <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A solicitar…' : 'Solicitar exame'}</button>
    </Modal>
  );
}

// ── CONVÉNIOS / SEGUROS ────────────────────────────────────────
const CLAIM_ST: Record<string, string> = { PENDING: 'Pendente', SUBMITTED: 'Submetido', PAID: 'Pago', REJECTED: 'Rejeitado' };
const CLAIM_NEXT: Record<string, { id: string; label: string }[]> = {
  PENDING: [{ id: 'SUBMITTED', label: 'Submeter' }],
  SUBMITTED: [{ id: 'PAID', label: 'Pago ✓' }, { id: 'REJECTED', label: 'Rejeitado' }],
};

export function InsurersTab({ patients, onPatientsChanged }: { patients: ClinicPatient[]; onPatientsChanged(): void }) {
  const [insurers, setInsurers] = useState<ClinicInsurer[]>([]);
  const [claims, setClaims] = useState<ClinicClaim[]>([]);
  const [creating, setCreating] = useState(false);
  const [assignFor, setAssignFor] = useState<ClinicPatient | null>(null);
  const load = useCallback(async () => {
    try { setInsurers(await api.clinic.insurers()); } catch { /* */ }
    try { setClaims(await api.clinic.claims()); } catch { /* */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const advance = async (c: ClinicClaim, status: string) => {
    await api.clinic.claimStatus(c.id, status).catch((e) => toast.error(errMsg(e, 'Falha.')));
    await load();
  };
  const pending = claims.filter((c) => c.status !== 'PAID' && c.status !== 'REJECTED');
  const totalToReceive = pending.reduce((s, c) => s + Number(c.covered), 0);

  return (
    <>
      <div className="content-head" style={{ marginTop: 0 }}>
        <h3 style={{ margin: 0 }}>🛡️ Convénios & Seguros</h3>
        <span className="spacer" />
        <button className="btn" onClick={() => setCreating(true)}><IconPlus size={16} /> Novo convénio</button>
      </div>

      <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
        <div className="card" style={{ padding: '12px 14px' }}><div className="muted" style={{ fontSize: 12.5 }}>Convénios ativos</div><div style={{ fontSize: 22, fontWeight: 800 }}>{insurers.length}</div></div>
        <div className="card" style={{ padding: '12px 14px' }}><div className="muted" style={{ fontSize: 12.5 }}>A receber das seguradoras</div><div style={{ fontSize: 22, fontWeight: 800 }}>{KZ(totalToReceive)}</div></div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
        {insurers.length === 0 ? <div className="empty" style={{ padding: 22 }}><p>Sem convénios. Registe o primeiro (ex.: ENSA Saúde, 80%).</p></div>
          : insurers.map((i) => (
            <div key={i.id} className="list-row" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 13.5 }}>{i.name}</strong>{i.plan ? <span className="muted"> · {i.plan}</span> : null}
                <div className="muted" style={{ fontSize: 12 }}>Cobre {Number(i.coverage_pct)}%</div>
              </div>
              <span className="pill on">{Number(i.coverage_pct)}%</span>
            </div>
          ))}
      </div>

      <div className="content-head"><h4 style={{ margin: 0 }}>👤 Convénio por paciente</h4></div>
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
        {patients.length === 0 ? <div className="empty" style={{ padding: 18 }}><p>Sem pacientes.</p></div>
          : patients.slice(0, 30).map((p) => (
            <div key={p.id} className="list-row" style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}><strong style={{ fontSize: 13 }}>{p.name}</strong>
                <div className="muted" style={{ fontSize: 12 }}>{p.insurer ? `🛡️ ${p.insurer}` : 'sem convénio (paga 100%)'}</div>
              </div>
              <button className="btn sm ghost" onClick={() => setAssignFor(p)}>Convénio</button>
            </div>
          ))}
      </div>

      <div className="content-head"><h4 style={{ margin: 0 }}>📄 Sinistros (a receber das seguradoras)</h4></div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {claims.length === 0 ? <div className="empty" style={{ padding: 18 }}><p>Sem sinistros ainda. Faturar um ato de um paciente com convénio gera um aqui.</p></div>
          : claims.map((c) => (
            <div key={c.id} className="list-row" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 13 }}>{c.insurer_name}</strong> <span className="muted">· {c.patient_name ?? '—'}</span>
                <div className="muted" style={{ fontSize: 12 }}>{c.source_type} · total {KZ(c.gross_total)} · convénio {KZ(c.covered)} · paciente {KZ(c.copay)}</div>
              </div>
              <span className={`pill ${c.status === 'PAID' ? 'on' : 'off'}`}>{CLAIM_ST[c.status] ?? c.status}</span>
              {(CLAIM_NEXT[c.status] ?? []).map((n) => <button key={n.id} className="btn sm ghost" onClick={() => void advance(c, n.id)}>{n.label}</button>)}
            </div>
          ))}
      </div>

      {creating ? <NewInsurerModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); void load(); }} /> : null}
      {assignFor ? <AssignInsurerModal patient={assignFor} insurers={insurers} onClose={() => setAssignFor(null)} onDone={() => { setAssignFor(null); void load(); onPatientsChanged(); }} /> : null}
    </>
  );
}

function NewInsurerModal({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const [f, setF] = useState({ name: '', plan: '', coveragePct: '80' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.name.trim()) { toast.warning('Indique o nome do convénio.'); return; }
    setBusy(true);
    try {
      await api.clinic.createInsurer({ name: f.name.trim(), plan: f.plan.trim() || undefined, coveragePct: Number(f.coveragePct) || 0 });
      toast.success('Convénio registado.'); onDone();
    } catch (e) { toast.error(errMsg(e, 'Falha.')); } finally { setBusy(false); }
  };
  return (
    <Modal title="Novo convénio / seguro" onClose={onClose}>
      <div className="field"><label>Nome</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ex.: ENSA Saúde" /></div>
      <div className="grid-2">
        <div className="field"><label>Plano (opcional)</label><input value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} placeholder="ex.: Ouro" /></div>
        <div className="field"><label>Cobertura (%)</label><input value={f.coveragePct} onChange={(e) => setF({ ...f, coveragePct: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" /></div>
      </div>
      <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A registar…' : 'Registar convénio'}</button>
    </Modal>
  );
}

function AssignInsurerModal({ patient, insurers, onClose, onDone }: { patient: ClinicPatient; insurers: ClinicInsurer[]; onClose(): void; onDone(): void }) {
  const [insurerId, setInsurerId] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.clinic.assignInsurer(patient.id, insurerId || null); toast.success('Convénio atualizado.'); onDone(); }
    catch (e) { toast.error(errMsg(e, 'Falha.')); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Convénio — ${patient.name}`} onClose={onClose}>
      <div className="field"><label>Convénio</label>
        <select value={insurerId} onChange={(e) => setInsurerId(e.target.value)}>
          <option value="">— sem convénio (paga 100%) —</option>
          {insurers.map((i) => <option key={i.id} value={i.id}>{i.name} ({Number(i.coverage_pct)}%)</option>)}
        </select></div>
      <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A guardar…' : 'Guardar'}</button>
    </Modal>
  );
}

// ── PRONTUÁRIO ELETRÓNICO (modal, aberto da lista de pacientes) ─
export function PatientRecordModal({ patientId, onClose }: { patientId: string; onClose(): void }) {
  const [rec, setRec] = useState<ClinicPatientRecord | null>(null);
  useEffect(() => { api.clinic.patientRecord(patientId).then(setRec).catch(() => toast.error('Falha ao carregar o prontuário.')); }, [patientId]);
  const p = rec?.patient as Record<string, string | null> | undefined;
  return (
    <Modal title={`📖 Prontuário — ${p?.name ?? '…'}`} onClose={onClose}>
      {!rec ? <div className="loading">A carregar…</div> : (
        <>
          <div className="card" style={{ marginBottom: 10, fontSize: 13 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              {[p?.sex, p?.blood_type, p?.birth_date ? `nasc. ${String(p.birth_date).slice(0, 10)}` : null, p?.insurer ? `convénio ${p.insurer}` : null].filter(Boolean).join(' · ') || 'sem dados demográficos'}
            </div>
            {p?.allergies ? <div style={{ color: 'var(--warning)', marginTop: 4 }}>⚠ Alergias: {p.allergies}</div> : null}
            {p?.chronic_conditions ? <div className="muted" style={{ marginTop: 2 }}>Crónicas: {p.chronic_conditions}</div> : null}
            {p?.continuous_meds ? <div className="muted" style={{ marginTop: 2 }}>Medicação contínua: {p.continuous_meds}</div> : null}
          </div>
          <RecordSection title={`🩺 Consultas (${rec.consultations.length})`} rows={rec.consultations.map((c) => ({
            id: String(c.id), main: String(c.diagnosis || c.symptoms || 'consulta'),
            sub: `${c.professional ?? '—'} · ${fmtDT(String(c.created_at))}${Number(c.fee) ? ` · ${KZ(Number(c.fee))}` : ''}`,
          }))} />
          <RecordSection title={`💊 Receitas (${rec.prescriptions.length})`} rows={rec.prescriptions.map((r) => ({
            id: String(r.id), main: `${r.number} · ${r.item_count} medicamento(s)`,
            sub: `${r.professional ?? '—'} · ${fmtDT(String(r.issued_at))} · ${RX_LABEL[String(r.status)] ?? r.status}`,
          }))} />
          <RecordSection title={`🛏️ Internações (${rec.admissions.length})`} rows={rec.admissions.map((a) => ({
            id: String(a.id), main: `${a.number} · ${a.bed_label ?? '—'}`,
            sub: `${a.reason ?? '—'} · ${fmtDT(String(a.admitted_at))}${a.discharged_at ? ` → ${fmtDT(String(a.discharged_at))}` : ' · internado'} · ${KZ(Number(a.total))}`,
          }))} />
          <RecordSection title={`🧪 Exames (${rec.exams.length})`} rows={rec.exams.map((e) => ({
            id: String(e.id), main: String(e.exam_type),
            sub: `${EXAM_LABEL[String(e.status)] ?? e.status} · ${fmtDT(String(e.requested_at))}${e.result_text ? ` · 📄 ${String(e.result_text).slice(0, 50)}` : ''}`,
          }))} />
          <RecordSection title={`❤️ Sinais vitais (${rec.vitals.length})`} rows={rec.vitals.map((v) => ({
            id: v.id, main: [
              v.temperature_c ? `${v.temperature_c}°C` : null,
              v.systolic && v.diastolic ? `TA ${v.systolic}/${v.diastolic}` : null,
              v.heart_rate ? `FC ${v.heart_rate}` : null, v.spo2 ? `SpO₂ ${v.spo2}%` : null,
              v.weight_kg ? `${v.weight_kg} kg` : null,
            ].filter(Boolean).join(' · ') || 'registo',
            sub: fmtDT(v.recorded_at),
          }))} />
        </>
      )}
    </Modal>
  );
}

function RecordSection({ title, rows }: { title: string; rows: Array<{ id: string; main: string; sub: string }> }) {
  if (rows.length === 0) return null;
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 10 }}>
      <div style={{ padding: '8px 14px', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border, #0002)' }}>{title}</div>
      {rows.slice(0, 8).map((r) => (
        <div key={r.id} className="list-row" style={{ padding: '8px 14px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13 }}>{r.main}</div>
            <div className="muted" style={{ fontSize: 11.5 }}>{r.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
