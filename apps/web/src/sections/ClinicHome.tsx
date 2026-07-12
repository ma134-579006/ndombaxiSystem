import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ClinicDashboard } from '../api/types';
import { formatKz } from '../format';

const KZ = (n: number) => formatKz(Number(n) || 0);

/**
 * CENTRO DE COMANDO da clínica (vertical CLINIC) — mesma engenharia do
 * restaurante/hotel: nativo de saúde, não uma grelha de atalhos para o retalho.
 * Lê o dashboard (agenda de hoje, fila/atrasos, pacientes, vendas por canal) e
 * oferece AÇÕES PRÓPRIAS. Refresca sozinho.
 */
export function ClinicHome({ onGo }: { onGo(section: string): void }) {
  const goClinic = (tab: 'agenda' | 'patients' | 'emergency' | 'beds' | 'prescriptions' | 'professionals' | 'exams') => {
    try { sessionStorage.setItem('ndx_clinic_tab', tab); } catch { /* indisponível */ }
    onGo('clinic');
  };
  const [d, setD] = useState<ClinicDashboard | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => api.clinic.dashboard()
      .then((r) => { if (alive) { setD(r); setErr(false); } })
      .catch(() => { if (alive) setErr(true); });
    void load();
    const t = window.setInterval(load, 8000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  return (
    <>
      <div className="content-head">
        <h2>🏥 Clínica — Centro de comando</h2>
        <span className="spacer" />
        <button className="btn primary" onClick={() => goClinic('agenda')}>📅 Ver agenda</button>
      </div>

      {err && !d ? (
        <div className="card"><div className="empty"><p>Não foi possível carregar o painel da clínica. Verifica a ligação.</p></div></div>
      ) : null}

      {/* ── Vendas de HOJE (todos os canais) ── */}
      <div className="card" style={{ marginBottom: 14, background: 'linear-gradient(135deg, color-mix(in srgb, var(--primary) 10%, transparent), transparent)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="muted" style={{ fontSize: 12.5 }}>Faturação de hoje · todos os canais</div>
            <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1 }}>{d?.sales ? KZ(d.sales.total) : '—'}</div>
            <div className="muted" style={{ fontSize: 11.5 }}>{d?.sales ? `${d.sales.invoices} factura(s) emitida(s)` : 'a carregar…'}</div>
          </div>
          <span className="spacer" style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <Channel icon="🧾" label="Receção" value={d?.sales ? KZ(d.sales.counter) : '—'} />
            <Channel icon="🛜" label="Online" value={d?.sales ? KZ(d.sales.online) : '—'} />
          </div>
        </div>
      </div>

      {/* ── Hoje (agenda) ── */}
      <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
        <Tile label="Por atender" value={d ? String(d.today.scheduled) : '—'} hint={d && d.today.overdue > 0 ? `${d.today.overdue} em atraso` : 'marcações de hoje'} tone={d && d.today.overdue > 0 ? 'warn' : 'info'} />
        <Tile label="Consultas feitas" value={d ? String(d.today.done) : '—'} hint="hoje" />
        <Tile label="Pacientes ativos" value={d ? String(d.patients.active) : '—'} hint={d && d.patients.newToday > 0 ? `+${d.patients.newToday} novo(s) hoje` : 'na base'} />
        <Tile label="Faltas / cancel." value={d ? String(d.today.noShow + d.today.cancelled) : '—'} hint={d ? `${d.today.noShow} falta(s) · ${d.today.cancelled} cancel.` : ''} />
      </div>

      {/* ── Hospital (HIS): internamento, leitos, emergência, plantão ── */}
      {d?.hospital ? (
        <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
          <Tile label="Internados" value={String(d.hospital.admitted)} hint={`${d.hospital.bedsFree}/${d.hospital.bedsTotal} leitos livres`} tone={d.hospital.bedsTotal > 0 && d.hospital.bedsFree === 0 ? 'warn' : 'info'} />
          <Tile label="Emergência (espera)" value={String(d.hospital.emergencyWaiting)} hint={d.hospital.emergencyRed > 0 ? `⚠ ${d.hospital.emergencyRed} caso(s) VERMELHO` : 'fila de triagem'} tone={d.hospital.emergencyRed > 0 ? 'warn' : undefined} />
          <Tile label="Médicos de plantão" value={String(d.hospital.onCallDoctors)} hint="disponíveis agora" />
          <Tile label="Exames pendentes" value={String(d.hospital.examsPending)} hint={d.hospital.rxToDispense > 0 ? `${d.hospital.rxToDispense} receita(s) por dispensar` : 'laboratório'} />
        </div>
      ) : null}

      {/* ── Alerta de atrasos ── */}
      {d && d.today.overdue > 0 ? (
        <div className="card" style={{ marginBottom: 14, borderLeft: '4px solid var(--warning)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 30 }}>⏰</div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700 }}>Sala de espera</div>
              <div className="muted" style={{ fontSize: 13 }}>
                <strong style={{ color: 'var(--warning)' }}>{d.today.overdue}</strong> paciente(s) com hora já passada e ainda por atender.
              </div>
            </div>
            <button className="btn ghost" onClick={() => goClinic('agenda')}>Abrir agenda</button>
          </div>
        </div>
      ) : null}

      {/* ── Agenda de hoje ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border, #0002)' }}>
          <strong style={{ fontSize: 14 }}>📅 Agenda de hoje</strong>
          <span className="pill on">{d?.today.agenda.length ?? 0}</span>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn sm ghost" onClick={() => goClinic('agenda')}>Abrir</button>
        </div>
        {!d || d.today.agenda.length === 0 ? (
          <div className="empty" style={{ padding: 18 }}><p className="muted" style={{ fontSize: 13 }}>{d ? 'Sem marcações por atender hoje.' : 'a carregar…'}</p></div>
        ) : d.today.agenda.slice(0, 8).map((a) => (
          <div key={a.id} className="list-row" style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 800, fontSize: 14, minWidth: 44, color: a.overdue ? 'var(--warning)' : 'var(--primary)' }}>{a.time}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.patient}</div>
              <div className="muted" style={{ fontSize: 12 }}>{a.professional}{a.reason ? ` · ${a.reason}` : ''}</div>
            </div>
            {a.overdue ? <span className="pill" style={{ background: 'var(--warning)', color: '#111' }}>em atraso</span> : null}
          </div>
        ))}
      </div>

      {/* ── Ações próprias da clínica ── */}
      <h3 style={{ margin: '18px 0 10px', fontSize: 14, letterSpacing: 0.3 }}>Operação</h3>
      <div className="pgrid">
        <ActionCard icon="🚑" title="Emergência" desc="Triagem, classificação de risco, fila." onClick={() => goClinic('emergency')} badge={d?.hospital && d.hospital.emergencyWaiting > 0 ? String(d.hospital.emergencyWaiting) : undefined} />
        <ActionCard icon="📅" title="Agenda & Marcações" desc="Marcar, ver o dia, dar entrada." onClick={() => goClinic('agenda')} badge={d && d.today.scheduled > 0 ? String(d.today.scheduled) : undefined} />
        <ActionCard icon="🛏️" title="Internação" desc="Mapa de leitos, admissões e altas." onClick={() => goClinic('beds')} badge={d?.hospital && d.hospital.admitted > 0 ? String(d.hospital.admitted) : undefined} />
        <ActionCard icon="👤" title="Pacientes & Prontuário" desc="Fichas clínicas e histórico completo." onClick={() => goClinic('patients')} />
        <ActionCard icon="💊" title="Receitas & Farmácia" desc="Emitir e dispensar (baixa stock por lote)." onClick={() => goClinic('prescriptions')} badge={d?.hospital && d.hospital.rxToDispense > 0 ? String(d.hospital.rxToDispense) : undefined} />
        <ActionCard icon="🧪" title="Exames" desc="Pedido, colheita, laboratório, resultado." onClick={() => goClinic('exams')} badge={d?.hospital && d.hospital.examsPending > 0 ? String(d.hospital.examsPending) : undefined} />
        <ActionCard icon="🧑‍⚕️" title="Profissionais" desc="Médicos, especialidades, plantões." onClick={() => goClinic('professionals')} />
        <ActionCard icon="🧾" title="Faturação (AGT)" desc="Faturar consultas e atos clínicos." onClick={() => onGo('operations')} />
      </div>

      {/* ── Gestão (secundário) ── */}
      <h3 style={{ margin: '18px 0 10px', fontSize: 14, letterSpacing: 0.3 }} className="muted">Gestão</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn ghost" onClick={() => onGo('operations')}>🧾 Caixa & Faturação</button>
        <button className="btn ghost" onClick={() => onGo('reports')}>📊 Relatórios & SAF-T</button>
        <button className="btn ghost" onClick={() => onGo('employees')}>👥 Profissionais & Folha</button>
        <button className="btn ghost" onClick={() => onGo('customers')}>🤝 Pacientes (clientes)</button>
      </div>
    </>
  );
}

function Channel({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div className="muted" style={{ fontSize: 11.5 }}>{icon} {label}</div>
      <div style={{ fontSize: 17, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'info' | 'warn' }) {
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="muted" style={{ fontSize: 12.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, margin: '2px 0', color: tone === 'warn' ? 'var(--warning)' : tone === 'info' ? 'var(--primary)' : 'var(--text)' }}>{value}</div>
      {hint ? <div className="muted" style={{ fontSize: 11.5 }}>{hint}</div> : null}
    </div>
  );
}

function ActionCard({ icon, title, desc, onClick, badge }: { icon: string; title: string; desc: string; onClick(): void; badge?: string }) {
  return (
    <button className="pcard" onClick={onClick} style={{ textAlign: 'left', cursor: 'pointer', position: 'relative' }}>
      <div className="thumb" style={{ fontSize: 30, display: 'grid', placeItems: 'center' }}>{icon}</div>
      <div className="pinfo">
        <div className="pname">{title}</div>
        <div className="pcode">{desc}</div>
        <div className="pfoot"><span className="pill on">Abrir</span></div>
      </div>
      {badge ? <span className="pill" style={{ position: 'absolute', top: 10, right: 10, background: 'var(--warning)', color: '#111' }}>{badge}</span> : null}
    </button>
  );
}
