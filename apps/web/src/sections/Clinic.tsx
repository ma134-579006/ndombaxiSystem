import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { ClinicAppointment, ClinicPatient, ClinicPatientDetail } from '../api/types';
import { toast } from '../components/feedback';
import { IconPlus, IconSearch } from '../components/Icons';
import { Modal } from '../components/ui';
import { formatKz } from '../format';
import { BedsTab, EmergencyTab, ExamsTab, InsurersTab, PatientRecordModal, PrescriptionsTab, ProfessionalsTab } from './ClinicHospitalTabs';

const KZ = (n: string | number) => formatKz(Number(n) || 0);
const todayISO = () => new Date().toISOString().slice(0, 10);
const APPT: Record<string, { label: string; tone: string }> = {
  SCHEDULED: { label: 'Marcada', tone: 'var(--primary)' }, DONE: { label: 'Realizada', tone: 'var(--success)' },
  CANCELLED: { label: 'Cancelada', tone: 'var(--muted)' }, NO_SHOW: { label: 'Faltou', tone: 'var(--danger)' },
};
const hm = (s: string) => { try { return new Date(s).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }); } catch { return s; } };

type ClinicTab = 'agenda' | 'patients' | 'emergency' | 'beds' | 'prescriptions' | 'professionals' | 'exams' | 'insurers';
const CLINIC_TABS: ClinicTab[] = ['agenda', 'patients', 'emergency', 'beds', 'prescriptions', 'professionals', 'exams', 'insurers'];

/** Clínica / Hospital (HIS) — agenda, pacientes/prontuário, emergência,
 *  internação (leitos), receitas (dispensa na farmácia), profissionais e exames. */
export function Clinic() {
  const [tab, setTab] = useState<ClinicTab>('agenda');
  // Deep-link do Centro de Comando (num efeito — StrictMode-safe).
  useEffect(() => {
    try {
      const t = sessionStorage.getItem('ndx_clinic_tab');
      if (t && (CLINIC_TABS as string[]).includes(t)) { setTab(t as ClinicTab); sessionStorage.removeItem('ndx_clinic_tab'); }
    } catch { /* indisponível */ }
  }, []);
  const [kpi, setKpi] = useState<{ todayAppointments: number; todayConsultations: number; patients: number; revenue30: number } | null>(null);
  const [day, setDay] = useState(todayISO());
  const [appts, setAppts] = useState<ClinicAppointment[]>([]);
  const [patients, setPatients] = useState<ClinicPatient[]>([]);
  const [search, setSearch] = useState('');
  const [newAppt, setNewAppt] = useState(false);
  const [newPatient, setNewPatient] = useState(false);
  const [consultFor, setConsultFor] = useState<ClinicAppointment | null>(null);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [recordFor, setRecordFor] = useState<string | null>(null);

  const loadKpi = useCallback(async () => { try { setKpi(await api.clinic.metrics()); } catch { /* */ } }, []);
  const loadAppts = useCallback(async () => { try { setAppts(await api.clinic.appointments(day)); } catch { /* */ } }, [day]);
  const loadPatients = useCallback(async () => { try { setPatients(await api.clinic.patients(search || undefined)); } catch { /* */ } }, [search]);
  useEffect(() => { void loadKpi(); }, [loadKpi]);
  useEffect(() => { if (tab === 'agenda') void loadAppts(); }, [tab, loadAppts]);
  // Os separadores hospitalares também precisam da lista de pacientes (modais).
  useEffect(() => { if (tab !== 'agenda') void loadPatients(); }, [tab, loadPatients]);
  const refresh = async () => { await loadKpi(); await loadAppts(); };

  return (
    <>
      <div className="content-head">
        <h2>🏥 Clínica / Hospital</h2>
        <span className="spacer" />
        {tab === 'agenda' ? <button className="btn" onClick={() => setNewAppt(true)}><IconPlus size={17} /> Marcação</button>
          : tab === 'patients' ? <button className="btn" onClick={() => setNewPatient(true)}><IconPlus size={17} /> Paciente</button>
          : null}
      </div>

      {kpi ? (
        <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
          {[
            { label: 'Marcações hoje', value: String(kpi.todayAppointments) },
            { label: 'Consultas hoje', value: String(kpi.todayConsultations) },
            { label: 'Pacientes', value: String(kpi.patients) },
            { label: 'Receita (30 dias)', value: KZ(kpi.revenue30) },
          ].map((k) => (
            <div key={k.label} className="card" style={{ padding: '12px 14px' }}>
              <div className="muted" style={{ fontSize: 12.5 }}>{k.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, margin: '2px 0' }}>{k.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="card toolbar-sticky" style={{ display: 'flex', gap: 6, padding: '8px 10px', flexWrap: 'wrap' }}>
        <button className={`chip${tab === 'agenda' ? ' active' : ''}`} onClick={() => setTab('agenda')}>📅 Agenda</button>
        <button className={`chip${tab === 'emergency' ? ' active' : ''}`} onClick={() => setTab('emergency')}>🚑 Emergência</button>
        <button className={`chip${tab === 'beds' ? ' active' : ''}`} onClick={() => setTab('beds')}>🛏️ Internação</button>
        <button className={`chip${tab === 'patients' ? ' active' : ''}`} onClick={() => setTab('patients')}>👤 Pacientes</button>
        <button className={`chip${tab === 'prescriptions' ? ' active' : ''}`} onClick={() => setTab('prescriptions')}>💊 Receitas</button>
        <button className={`chip${tab === 'exams' ? ' active' : ''}`} onClick={() => setTab('exams')}>🧪 Exames</button>
        <button className={`chip${tab === 'insurers' ? ' active' : ''}`} onClick={() => setTab('insurers')}>🛡️ Convénios</button>
        <button className={`chip${tab === 'professionals' ? ' active' : ''}`} onClick={() => setTab('professionals')}>🧑‍⚕️ Profissionais</button>
      </div>

      {tab === 'emergency' ? <EmergencyTab patients={patients} />
        : tab === 'beds' ? <BedsTab patients={patients} />
        : tab === 'prescriptions' ? <PrescriptionsTab patients={patients} />
        : tab === 'exams' ? <ExamsTab patients={patients} />
        : tab === 'insurers' ? <InsurersTab patients={patients} onPatientsChanged={loadPatients} />
        : tab === 'professionals' ? <ProfessionalsTab />
        : tab === 'agenda' ? (
        <>
          <div className="card" style={{ padding: 10, marginBottom: 0 }}>
            <div className="field" style={{ margin: 0, maxWidth: 220 }}><label>Dia</label><input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></div>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {appts.length === 0 ? <div className="empty" style={{ padding: 24 }}><p>Sem marcações neste dia.</p></div>
              : appts.map((a) => {
                const st = APPT[a.status] ?? APPT.SCHEDULED;
                return (
                  <div key={a.id} className="list-row" style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
                    <strong style={{ fontSize: 14, width: 52 }}>{hm(a.scheduled_at)}</strong>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontSize: 14 }}>{a.patient_name || 'Paciente'}</strong>
                      <div className="muted" style={{ fontSize: 12.5 }}>{a.reason || '—'}{a.professional ? ` · 👨‍⚕️ ${a.professional}` : ''}</div>
                    </div>
                    <span className="pill" style={{ color: st.tone, borderColor: st.tone }}>{st.label}</span>
                    {a.status === 'SCHEDULED' ? <button className="btn sm success" onClick={() => setConsultFor(a)}>Atender</button> : null}
                  </div>
                );
              })}
          </div>
        </>
      ) : (
        <>
          <div className="card toolbar-sticky" style={{ padding: '2px 12px', top: 52 }}>
            <div className="row"><IconSearch size={18} /><input style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '11px 0', color: 'var(--text)' }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Procurar paciente…" /></div>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {patients.length === 0 ? <div className="empty" style={{ padding: 24 }}><p>Sem pacientes.</p></div>
              : patients.map((p) => (
                <div key={p.id} className="list-row" style={{ display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)', padding: '12px 16px' }}>
                  <button onClick={() => setPatientId(p.id)} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text)', padding: 0 }}>
                    <strong style={{ fontSize: 14 }}>{p.name}</strong>
                    <div className="muted" style={{ fontSize: 12.5 }}>{[p.phone, p.sex, p.blood_type].filter(Boolean).join(' · ') || '—'}{p.allergies ? ` · ⚠ ${p.allergies}` : ''}</div>
                  </button>
                  <button className="btn sm ghost" onClick={() => setRecordFor(p.id)}>📖 Prontuário</button>
                </div>
              ))}
          </div>
        </>
      )}

      {newAppt ? <NewAppointment patients={patients} onClose={() => setNewAppt(false)} onCreated={async () => { setNewAppt(false); await refresh(); }} /> : null}
      {newPatient ? <NewPatient onClose={() => setNewPatient(false)} onCreated={async () => { setNewPatient(false); await loadPatients(); }} /> : null}
      {consultFor ? <ConsultModal appointment={consultFor} onClose={() => setConsultFor(null)} onDone={async () => { setConsultFor(null); await refresh(); }} /> : null}
      {patientId ? <PatientDetail id={patientId} onClose={() => setPatientId(null)} /> : null}
      {recordFor ? <PatientRecordModal patientId={recordFor} onClose={() => setRecordFor(null)} /> : null}
    </>
  );
}

function NewPatient({ onClose, onCreated }: { onClose(): void; onCreated(): void }) {
  const [f, setF] = useState({ name: '', phone: '', nif: '', birthDate: '', sex: '', bloodType: '', allergies: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.name.trim()) { toast.warning('Indique o nome.'); return; }
    setBusy(true);
    try {
      // Só o nome é obrigatório — os campos opcionais VAZIOS têm de ser OMITIDOS
      // (não enviados como "", que o backend @IsOptional @Length(1,…) rejeita).
      const payload: Record<string, string> = { name: f.name.trim() };
      for (const k of ['phone', 'nif', 'birthDate', 'sex', 'bloodType', 'allergies'] as const) {
        if (f[k] && f[k].trim()) payload[k] = f[k].trim();
      }
      await api.clinic.createPatient(payload); toast.success('Paciente registado.'); onCreated();
    }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha.'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Novo paciente" onClose={onClose}>
      <div className="field"><label>Nome</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div className="grid-2">
        <div className="field"><label>Telefone</label><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" /></div>
        <div className="field"><label>NIF</label><input value={f.nif} onChange={(e) => setF({ ...f, nif: e.target.value })} /></div>
      </div>
      <div className="grid-2">
        <div className="field"><label>Data de nascimento</label><input type="date" value={f.birthDate} onChange={(e) => setF({ ...f, birthDate: e.target.value })} /></div>
        <div className="field"><label>Sexo</label>
          <select value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })}><option value="">—</option><option value="M">M</option><option value="F">F</option><option value="O">Outro</option></select></div>
      </div>
      <div className="grid-2">
        <div className="field"><label>Grupo sanguíneo</label><input value={f.bloodType} onChange={(e) => setF({ ...f, bloodType: e.target.value })} placeholder="O+" /></div>
        <div className="field"><label>Alergias</label><input value={f.allergies} onChange={(e) => setF({ ...f, allergies: e.target.value })} /></div>
      </div>
      <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A guardar…' : 'Registar'}</button>
    </Modal>
  );
}

function NewAppointment({ patients, onClose, onCreated }: { patients: ClinicPatient[]; onClose(): void; onCreated(): void }) {
  const [all, setAll] = useState<ClinicPatient[]>(patients);
  const [f, setF] = useState({ patientId: '', professional: '', date: todayISO(), time: '09:00', reason: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (patients.length === 0) api.clinic.patients().then(setAll).catch(() => undefined); }, [patients]);
  const save = async () => {
    if (!f.patientId) { toast.warning('Escolha o paciente.'); return; }
    setBusy(true);
    try {
      await api.clinic.createAppointment({ patientId: f.patientId, professional: f.professional || undefined, scheduledAt: new Date(`${f.date}T${f.time}:00`).toISOString(), reason: f.reason || undefined });
      toast.success('Marcação criada.'); onCreated();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha.'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Nova marcação" onClose={onClose}>
      <div className="field"><label>Paciente</label>
        <select value={f.patientId} onChange={(e) => setF({ ...f, patientId: e.target.value })}>
          <option value="">—</option>{all.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></div>
      <div className="grid-2">
        <div className="field"><label>Data</label><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div className="field"><label>Hora</label><input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></div>
      </div>
      <div className="field"><label>Profissional</label><input value={f.professional} onChange={(e) => setF({ ...f, professional: e.target.value })} placeholder="Dr(a). …" /></div>
      <div className="field"><label>Motivo</label><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
      <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A criar…' : 'Marcar'}</button>
    </Modal>
  );
}

function ConsultModal({ appointment, onClose, onDone }: { appointment: ClinicAppointment; onClose(): void; onDone(): void }) {
  const [f, setF] = useState({ symptoms: '', diagnosis: '', prescription: '', fee: '' });
  const [busy, setBusy] = useState(false);
  const [invoiceAfter, setInvoiceAfter] = useState(true);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.clinic.createConsultation({
        appointmentId: appointment.id, patientId: appointment.patient_id ?? undefined, professional: appointment.professional ?? undefined,
        symptoms: f.symptoms || undefined, diagnosis: f.diagnosis || undefined, prescription: f.prescription || undefined, fee: Number(f.fee) || 0,
      });
      if (invoiceAfter && Number(f.fee) > 0) {
        const inv = await api.clinic.invoiceConsultation(r.id).catch(() => null);
        if (inv && inv.insurer && Number(inv.covered) > 0) {
          const pac = inv.invoiceNumber ? `paciente ${KZ(inv.copay ?? 0)} (FT ${inv.invoiceNumber})` : 'paciente 0 (100% coberto)';
          toast.success(`Consulta registada. Convénio ${inv.insurer}: cobre ${KZ(inv.covered)}, ${pac}.`);
        } else if (inv) toast.success(`Consulta registada e faturada (${inv.invoiceNumber}).`);
        else toast.success('Consulta registada.');
      } else toast.success('Consulta registada.');
      onDone();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha.'); setBusy(false); }
  };
  return (
    <Modal title={`Consulta — ${appointment.patient_name || 'Paciente'}`} onClose={onClose}>
      <div className="field"><label>Sintomas / queixa</label><textarea value={f.symptoms} onChange={(e) => setF({ ...f, symptoms: e.target.value })} rows={2} style={{ width: '100%', resize: 'vertical' }} /></div>
      <div className="field"><label>Diagnóstico</label><textarea value={f.diagnosis} onChange={(e) => setF({ ...f, diagnosis: e.target.value })} rows={2} style={{ width: '100%', resize: 'vertical' }} /></div>
      <div className="field"><label>Receita / prescrição</label><textarea value={f.prescription} onChange={(e) => setF({ ...f, prescription: e.target.value })} rows={2} style={{ width: '100%', resize: 'vertical' }} /></div>
      <div className="field"><label>Valor da consulta (Kz, c/ IVA)</label><input value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" placeholder="0" /></div>
      <label className="switch-row" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 12px' }}>
        <input type="checkbox" checked={invoiceAfter} onChange={(e) => setInvoiceAfter(e.target.checked)} /> <span>Faturar (AGT) ao guardar</span>
      </label>
      <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A guardar…' : 'Guardar consulta'}</button>
    </Modal>
  );
}

function PatientDetail({ id, onClose }: { id: string; onClose(): void }) {
  const [d, setD] = useState<ClinicPatientDetail | null>(null);
  useEffect(() => { api.clinic.patient(id).then(setD).catch(() => undefined); }, [id]);
  if (!d) return <Modal title="Paciente" onClose={onClose}><div className="empty"><p>A carregar…</p></div></Modal>;
  const p = d.patient;
  return (
    <Modal title={p.name} onClose={onClose}>
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="muted" style={{ fontSize: 12.5 }}>{[p.phone, p.sex, p.blood_type, p.nif ? `NIF ${p.nif}` : null].filter(Boolean).join(' · ') || '—'}</div>
        {p.allergies ? <div style={{ fontSize: 12.5, color: 'var(--warning)', marginTop: 4 }}>⚠ Alergias: {p.allergies}</div> : null}
        {p.notes ? <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{p.notes}</div> : null}
      </div>
      <strong style={{ fontSize: 14 }}>Histórico de consultas</strong>
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
        {d.consultations.length === 0 ? <div className="empty" style={{ padding: 16 }}><p>Sem consultas registadas.</p></div>
          : d.consultations.map((c) => (
            <div key={c.id} className="list-row" style={{ padding: '10px 14px', display: 'block' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 13 }}>{new Date(c.created_at).toLocaleDateString('pt-PT')}</strong>
                {c.professional ? <span className="muted" style={{ fontSize: 12 }}>👨‍⚕️ {c.professional}</span> : null}
                <span className="spacer" style={{ flex: 1 }} />
                {Number(c.fee) > 0 ? <span style={{ fontWeight: 700 }}>{KZ(c.fee)}</span> : null}
                {c.invoice_id ? <span className="pill on" style={{ marginLeft: 6 }}>Faturada</span> : null}
              </div>
              {c.diagnosis ? <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>🩺 {c.diagnosis}</div> : null}
              {c.prescription ? <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>💊 {c.prescription}</div> : null}
            </div>
          ))}
      </div>
    </Modal>
  );
}
