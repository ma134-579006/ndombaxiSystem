import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { StoreRoom } from '../api/types';
import { formatKz } from '../format';
import { IconClose } from './Icons';

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

/** Modal genérico simples da loja. */
function Sheet({ title, onClose, children }: { title: string; onClose(): void; children: React.ReactNode }) {
  return (
    <div className="drawer-bg" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="dh"><h2>{title}</h2><span className="spacer" /><button className="icon-x" onClick={onClose}><IconClose size={22} /></button></div>
        <div className="body" style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}

/**
 * CTA adaptativo ao MODELO de negócio (portal): Hotelaria → reservar quarto
 * (Booking); Serviços → pedir serviço (Service Portal); Clínica → marcar consulta
 * (Appointment). Retalho/Farmácia/Restauração usam o catálogo (E-commerce/Food).
 */
export function VerticalCTA({ code, businessType, prefill }: { code: string; businessType: string; prefill?: { name?: string; phone?: string; email?: string } }) {
  const [open, setOpen] = useState<null | 'hotel' | 'service' | 'clinic'>(null);
  if (businessType === 'CLINIC') {
    return (
      <>
        <button className="ax-cta" onClick={() => setOpen('clinic')}>
          <span className="ic" aria-hidden>🩺</span>
          <span className="tx"><strong>Marcar uma consulta</strong> — escolha o dia e a hora; confirmamos a sua marcação.</span>
          <span className="chev" aria-hidden>→</span>
        </button>
        {open === 'clinic' ? <AppointmentModal code={code} prefill={prefill} onClose={() => setOpen(null)} /> : null}
      </>
    );
  }
  if (businessType === 'HOSPITALITY') {
    return (
      <>
        <button className="ax-cta" onClick={() => setOpen('hotel')}>
          <span className="ic" aria-hidden>🛏️</span>
          <span className="tx"><strong>Reservar um quarto</strong> — escolha as datas e reserve online; confirmamos de seguida.</span>
          <span className="chev" aria-hidden>→</span>
        </button>
        {open === 'hotel' ? <ReservationModal code={code} prefill={prefill} onClose={() => setOpen(null)} /> : null}
      </>
    );
  }
  if (businessType === 'SERVICES') {
    return (
      <>
        <button className="ax-cta" onClick={() => setOpen('service')}>
          <span className="ic" aria-hidden>🔧</span>
          <span className="tx"><strong>Pedir um serviço / orçamento</strong> — descreva o que precisa e entramos em contacto.</span>
          <span className="chev" aria-hidden>→</span>
        </button>
        {open === 'service' ? <ServiceRequestModal code={code} prefill={prefill} onClose={() => setOpen(null)} /> : null}
      </>
    );
  }
  return null;
}

function ReservationModal({ code, prefill, onClose }: { code: string; prefill?: { name?: string; phone?: string; email?: string }; onClose(): void }) {
  const [rooms, setRooms] = useState<StoreRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const ci = today();
  const [f, setF] = useState({ roomId: '', guestName: prefill?.name || '', guestPhone: prefill?.phone || '', guestEmail: prefill?.email || '', checkIn: ci, checkOut: addDays(ci, 1), guests: '1' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Disponibilidade REATIVA às datas: só mostra quartos livres no período.
  useEffect(() => {
    if (f.checkOut <= f.checkIn) return;
    let alive = true; setLoading(true);
    api.rooms(code, f.checkIn, f.checkOut).then((r) => {
      if (!alive) return;
      setRooms(r.rooms);
      setF((s) => ({ ...s, roomId: r.rooms.some((x) => x.id === s.roomId) ? s.roomId : (r.rooms[0]?.id ?? '') }));
    }).catch(() => undefined).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [code, f.checkIn, f.checkOut]);
  const room = rooms.find((r) => r.id === f.roomId);
  const nights = Math.max(1, Math.round((new Date(f.checkOut + 'T00:00:00').getTime() - new Date(f.checkIn + 'T00:00:00').getTime()) / 86400000));
  const estimate = room ? nights * Number(room.rate) : 0;
  const submit = async () => {
    if (!f.roomId) { setErr('Escolha um quarto disponível.'); return; }
    if (f.checkOut <= f.checkIn) { setErr('A saída deve ser depois da entrada.'); return; }
    if (!f.guestName.trim() || !f.guestPhone.trim()) { setErr('Indique o seu nome e telefone.'); return; }
    setBusy(true); setErr(null);
    try {
      await api.reservation(code, { roomId: f.roomId, guestName: f.guestName.trim(), guestPhone: f.guestPhone.trim(), guestEmail: f.guestEmail.trim() || undefined, checkIn: f.checkIn, checkOut: f.checkOut, guests: Number(f.guests) || 1 });
      setDone(true);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível reservar.'); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Reservar quarto" onClose={onClose}>
      {done ? (
        <div className="empty"><div style={{ fontSize: 40 }}>✅</div><p>Reserva enviada! A loja vai confirmar a sua reserva e entrar em contacto.</p>
          <button className="btn lg" style={{ marginTop: 10 }} onClick={onClose}>Concluir</button></div>
      ) : (
        <>
          {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
          {/* 1) Datas → disponibilidade */}
          <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field"><label>Entrada</label><input type="date" min={ci} value={f.checkIn} onChange={(e) => setF({ ...f, checkIn: e.target.value, checkOut: e.target.value >= f.checkOut ? addDays(e.target.value, 1) : f.checkOut })} /></div>
            <div className="field"><label>Saída</label><input type="date" min={addDays(f.checkIn, 1)} value={f.checkOut} onChange={(e) => setF({ ...f, checkOut: e.target.value })} /></div>
          </div>
          {/* 2) Quartos disponíveis (cartões com foto) */}
          <label className="field" style={{ display: 'block', marginBottom: 4 }}>Quartos disponíveis</label>
          {loading ? <div className="empty"><p>A procurar disponibilidade…</p></div>
            : rooms.length === 0 ? <div className="empty"><p>Sem quartos livres nestas datas. Experimente outras.</p></div>
            : (
              <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                {rooms.map((r) => {
                  const sel = r.id === f.roomId;
                  return (
                    <button key={r.id} type="button" onClick={() => setF({ ...f, roomId: r.id })}
                      style={{ display: 'flex', gap: 10, alignItems: 'center', textAlign: 'left', padding: 8, borderRadius: 10, cursor: 'pointer',
                               border: `2px solid ${sel ? 'var(--primary, #2563eb)' : 'var(--border, #ddd)'}`, background: sel ? 'color-mix(in srgb, var(--primary,#2563eb) 8%, transparent)' : 'transparent' }}>
                      <div style={{ width: 64, height: 48, borderRadius: 8, overflow: 'hidden', background: 'var(--surface-2,#eee)', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 22 }}>
                        {r.photo_url ? <img src={r.photo_url} alt={r.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🛏️'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ fontSize: 13.5 }}>{r.name}</strong>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>{r.category || r.room_type || 'Quarto'} · {r.capacity}p · {formatKz(Number(r.rate))}/noite</div>
                      </div>
                      {sel ? <span style={{ color: 'var(--primary,#2563eb)', fontWeight: 800 }}>✓</span> : null}
                    </button>
                  );
                })}
              </div>
            )}
          <div className="field"><label>Hóspedes</label><input value={f.guests} onChange={(e) => setF({ ...f, guests: e.target.value.replace(/\D/g, '') })} inputMode="numeric" /></div>
          <div className="field"><label>O seu nome</label><input value={f.guestName} onChange={(e) => setF({ ...f, guestName: e.target.value })} /></div>
          <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field"><label>Telefone</label><input value={f.guestPhone} onChange={(e) => setF({ ...f, guestPhone: e.target.value })} inputMode="tel" /></div>
            <div className="field"><label>E-mail (opcional)</label><input value={f.guestEmail} onChange={(e) => setF({ ...f, guestEmail: e.target.value })} inputMode="email" /></div>
          </div>
          <div className="row" style={{ display: 'flex', alignItems: 'center', margin: '8px 0 12px' }}>
            <span className="muted">{nights} noite(s){room ? ` · ${room.name}` : ''}</span><span style={{ flex: 1 }} />
            <strong style={{ fontSize: 18 }}>{formatKz(estimate)}</strong>
          </div>
          <button className="btn lg block" onClick={submit} disabled={busy || !f.roomId}>{busy ? 'A reservar…' : 'Confirmar reserva'}</button>
        </>
      )}
    </Sheet>
  );
}

function ServiceRequestModal({ code, prefill, onClose }: { code: string; prefill?: { name?: string; phone?: string; email?: string }; onClose(): void }) {
  const [f, setF] = useState({ customerName: prefill?.name || '', customerPhone: prefill?.phone || '', customerEmail: prefill?.email || '', equipmentType: 'OTHER', equipmentLabel: '', equipmentRef: '', problem: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = async () => {
    if (!f.problem.trim() || f.problem.trim().length < 3) { setErr('Descreva o que precisa.'); return; }
    if (!f.customerName.trim() || !f.customerPhone.trim()) { setErr('Indique o seu nome e telefone.'); return; }
    setBusy(true); setErr(null);
    try {
      await api.serviceRequest(code, {
        customerName: f.customerName.trim(), customerPhone: f.customerPhone.trim(), customerEmail: f.customerEmail.trim() || undefined,
        equipmentType: f.equipmentType, equipmentLabel: f.equipmentLabel.trim() || undefined, equipmentRef: f.equipmentRef.trim() || undefined,
        problem: f.problem.trim(),
      });
      setDone(true);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível enviar o pedido.'); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Pedir serviço / orçamento" onClose={onClose}>
      {done ? (
        <div className="empty"><div style={{ fontSize: 40 }}>✅</div><p>Pedido enviado! Vamos analisar e entrar em contacto consigo.</p>
          <button className="btn lg" style={{ marginTop: 10 }} onClick={onClose}>Concluir</button></div>
      ) : (
        <>
          {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
          <div className="field"><label>Tipo</label>
            <select value={f.equipmentType} onChange={(e) => setF({ ...f, equipmentType: e.target.value })}>
              <option value="VEHICLE">Viatura</option><option value="DEVICE">Aparelho / Equipamento</option><option value="OTHER">Outro</option>
            </select>
          </div>
          <div className="field"><label>Equipamento (opcional)</label><input value={f.equipmentLabel} onChange={(e) => setF({ ...f, equipmentLabel: e.target.value })} placeholder="ex.: Toyota Corolla / Portátil HP" /></div>
          <div className="field"><label>Matrícula / Nº de série (opcional)</label><input value={f.equipmentRef} onChange={(e) => setF({ ...f, equipmentRef: e.target.value })} /></div>
          <div className="field"><label>O que precisa</label><textarea value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} rows={3} style={{ width: '100%', resize: 'vertical' }} placeholder="Descreva a avaria/serviço…" /></div>
          <div className="field"><label>O seu nome</label><input value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} /></div>
          <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field"><label>Telefone</label><input value={f.customerPhone} onChange={(e) => setF({ ...f, customerPhone: e.target.value })} inputMode="tel" /></div>
            <div className="field"><label>E-mail (opcional)</label><input value={f.customerEmail} onChange={(e) => setF({ ...f, customerEmail: e.target.value })} inputMode="email" /></div>
          </div>
          <button className="btn lg block" onClick={submit} disabled={busy}>{busy ? 'A enviar…' : 'Enviar pedido'}</button>
        </>
      )}
    </Sheet>
  );
}

function AppointmentModal({ code, prefill, onClose }: { code: string; prefill?: { name?: string; phone?: string; email?: string }; onClose(): void }) {
  const [f, setF] = useState({ patientName: prefill?.name || '', patientPhone: prefill?.phone || '', patientEmail: prefill?.email || '', professional: '', specialty: '', date: today(), time: '09:00', reason: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Portal do Paciente: escolher o médico REAL por especialidade (fallback a texto).
  const [docs, setDocs] = useState<{ name: string; specialty: string | null }[]>([]);
  useEffect(() => { api.professionals(code).then((r) => setDocs(r.professionals || [])).catch(() => setDocs([])); }, [code]);
  const specialties = Array.from(new Set(docs.map((d) => d.specialty).filter(Boolean))) as string[];
  const docsInSpecialty = f.specialty ? docs.filter((d) => d.specialty === f.specialty) : docs;
  const submit = async () => {
    if (!f.patientName.trim() || !f.patientPhone.trim()) { setErr('Indique o seu nome e telefone.'); return; }
    setBusy(true); setErr(null);
    try {
      await api.appointment(code, {
        patientName: f.patientName.trim(), patientPhone: f.patientPhone.trim(), patientEmail: f.patientEmail.trim() || undefined,
        professional: f.professional.trim() || undefined, scheduledAt: new Date(`${f.date}T${f.time}:00`).toISOString(), reason: f.reason.trim() || undefined,
      });
      setDone(true);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível marcar.'); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Marcar consulta" onClose={onClose}>
      {done ? (
        <div className="empty"><div style={{ fontSize: 40 }}>✅</div><p>Marcação enviada! Vamos confirmar a sua consulta e contactá-lo.</p>
          <button className="btn lg" style={{ marginTop: 10 }} onClick={onClose}>Concluir</button></div>
      ) : (
        <>
          {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
          <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field"><label>Dia</label><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
            <div className="field"><label>Hora</label><input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></div>
          </div>
          {docs.length > 0 ? (
            <>
              {specialties.length > 0 ? (
                <div className="field"><label>Especialidade</label>
                  <select value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value, professional: '' })}>
                    <option value="">Todas as especialidades</option>
                    {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select></div>
              ) : null}
              <div className="field"><label>Médico</label>
                <select value={f.professional} onChange={(e) => setF({ ...f, professional: e.target.value })}>
                  <option value="">Sem preferência</option>
                  {docsInSpecialty.map((d) => <option key={d.name} value={d.name}>{d.name}{d.specialty ? ` — ${d.specialty}` : ''}</option>)}
                </select></div>
            </>
          ) : (
            <div className="field"><label>Profissional (opcional)</label><input value={f.professional} onChange={(e) => setF({ ...f, professional: e.target.value })} placeholder="Dr(a). …" /></div>
          )}
          <div className="field"><label>Motivo (opcional)</label><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="ex.: consulta geral" /></div>
          <div className="field"><label>O seu nome</label><input value={f.patientName} onChange={(e) => setF({ ...f, patientName: e.target.value })} /></div>
          <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field"><label>Telefone</label><input value={f.patientPhone} onChange={(e) => setF({ ...f, patientPhone: e.target.value })} inputMode="tel" /></div>
            <div className="field"><label>E-mail (opcional)</label><input value={f.patientEmail} onChange={(e) => setF({ ...f, patientEmail: e.target.value })} inputMode="email" /></div>
          </div>
          <button className="btn lg block" onClick={submit} disabled={busy}>{busy ? 'A marcar…' : 'Confirmar marcação'}</button>
        </>
      )}
    </Sheet>
  );
}
