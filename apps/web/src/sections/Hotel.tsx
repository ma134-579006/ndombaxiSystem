import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { HotelHousekeepingRow, HotelMaintenanceRow, HotelReservationDetail, HotelReservationRow, HotelRoomMapRow, ManagerProduct } from '../api/types';
import { toast } from '../components/feedback';
import { IconPlus, IconSearch, IconTrash } from '../components/Icons';
import { Modal } from '../components/ui';
import { formatKz } from '../format';

const KZ = (n: string | number) => formatKz(Number(n) || 0);
const STATUS: { id: string; label: string }[] = [
  { id: 'BOOKED', label: 'Reservada' }, { id: 'CHECKED_IN', label: 'Hospedado' },
  { id: 'CHECKED_OUT', label: 'Saiu' }, { id: 'CANCELLED', label: 'Cancelada' },
];
const SL = (s: string) => STATUS.find((x) => x.id === s)?.label ?? s;
// Estado físico do quarto → rótulo + cor + emoji.
const ROOM_STATE: Record<string, { label: string; color: string; dot: string }> = {
  AVAILABLE: { label: 'Livre', color: '#16a34a', dot: '🟢' },
  RESERVED: { label: 'Reservado', color: '#2563eb', dot: '🔵' },
  OCCUPIED: { label: 'Ocupado', color: '#e0a800', dot: '🟠' },
  CLEANING: { label: 'Limpeza', color: '#7c3aed', dot: '🟣' },
  MAINTENANCE: { label: 'Manutenção', color: '#dc2626', dot: '🔧' },
  BLOCKED: { label: 'Bloqueado', color: '#6b7280', dot: '⛔' },
};
const TASK_L: Record<string, string> = { CLEAN: 'Limpar', CHANGE_LINEN: 'Trocar roupa', INSPECT: 'Inspecionar' };
const MT_L: Record<string, string> = { OPEN: 'Aberto', IN_REPAIR: 'Em reparação', DONE: 'Concluído' };
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

/** Hotelaria — mapa de quartos, reservas e conta do hóspede (folio). */
export function Hotel() {
  const [tab, setTab] = useState<'rooms' | 'reservations' | 'housekeeping' | 'maintenance'>('rooms');
  const [rooms, setRooms] = useState<HotelRoomMapRow[]>([]);
  const [reservations, setReservations] = useState<HotelReservationRow[]>([]);
  const [hk, setHk] = useState<HotelHousekeepingRow[]>([]);
  const [mt, setMt] = useState<HotelMaintenanceRow[]>([]);
  const [filter, setFilter] = useState('');
  const [newRoom, setNewRoom] = useState(false);
  const [booking, setBooking] = useState<HotelRoomMapRow | null>(null);
  const [roomMenu, setRoomMenu] = useState<HotelRoomMapRow | null>(null);
  const [detail, setDetail] = useState<HotelReservationDetail | null>(null);

  const loadRooms = useCallback(async () => { try { setRooms(await api.hotel.roomMap()); } catch { /* */ } }, []);
  const loadRes = useCallback(async () => { try { setReservations(await api.hotel.reservations(filter || undefined)); } catch { /* */ } }, [filter]);
  const loadHk = useCallback(async () => { try { setHk(await api.hotel.housekeeping()); } catch { /* */ } }, []);
  const loadMt = useCallback(async () => { try { setMt(await api.hotel.maintenance()); } catch { /* */ } }, []);
  useEffect(() => { void loadRooms(); }, [loadRooms]);
  useEffect(() => { if (tab === 'reservations') void loadRes(); if (tab === 'housekeeping') void loadHk(); if (tab === 'maintenance') void loadMt(); }, [tab, loadRes, loadHk, loadMt]);

  const openRes = async (id: string) => { try { setDetail(await api.hotel.reservation(id)); } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha.'); } };
  const refresh = async () => { await loadRooms(); if (tab === 'reservations') await loadRes(); if (tab === 'housekeeping') await loadHk(); if (tab === 'maintenance') await loadMt(); };
  const pendHk = hk.filter((h) => h.status === 'PENDING').length;
  const openMt = mt.filter((m) => m.status !== 'DONE').length;

  return (
    <>
      <div className="content-head">
        <h2>🏨 Hotelaria</h2>
        <span className="spacer" />
        {tab === 'rooms'
          ? <button className="btn ghost" onClick={() => setNewRoom(true)}><IconPlus size={17} /> Quarto</button>
          : null}
      </div>

      <div className="card toolbar-sticky" style={{ display: 'flex', gap: 6, padding: '8px 10px', flexWrap: 'wrap' }}>
        <button className={`chip${tab === 'rooms' ? ' active' : ''}`} onClick={() => setTab('rooms')}>🛏️ Quartos</button>
        <button className={`chip${tab === 'reservations' ? ' active' : ''}`} onClick={() => setTab('reservations')}>📅 Reservas</button>
        <button className={`chip${tab === 'housekeeping' ? ' active' : ''}`} onClick={() => setTab('housekeeping')}>🧹 Limpeza{pendHk ? ` (${pendHk})` : ''}</button>
        <button className={`chip${tab === 'maintenance' ? ' active' : ''}`} onClick={() => setTab('maintenance')}>🔧 Manutenção{openMt ? ` (${openMt})` : ''}</button>
      </div>

      {tab === 'rooms' ? (
        <div className="pgrid">
          {rooms.length === 0 ? <div className="empty" style={{ padding: 26, gridColumn: '1/-1' }}><p>Sem quartos. Crie o primeiro com “Quarto”.</p></div>
            : rooms.map((r) => {
              const occupied = !!r.reservation_id;
              const st = ROOM_STATE[r.status] ?? ROOM_STATE.AVAILABLE;
              return (
                <button key={r.id} className="pcard"
                  onClick={() => { if (occupied) void openRes(r.reservation_id!); else if (r.status === 'AVAILABLE' || r.status === 'RESERVED') setBooking(r); else setRoomMenu(r); }}
                  style={{ cursor: 'pointer', textAlign: 'left', borderLeft: `4px solid ${st.color}` }}>
                  <div className="pinfo">
                    <div className="pname" style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {st.dot} {r.name}
                      <span className="pill" style={{ marginLeft: 'auto', color: st.color, borderColor: st.color, fontSize: 11 }}>{st.label}</span>
                    </div>
                    <div className="pcode">{r.category || r.room_type || 'Quarto'}{r.floor ? ` · ${r.floor}º` : ''} · {r.capacity}p · {KZ(r.rate)}/noite</div>
                    {occupied ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>👤 {r.guest_name || 'Hóspede'} · saída {r.check_out}</div>
                      : <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                          {r.status === 'AVAILABLE' || r.status === 'RESERVED' ? 'Toque para reservar' : 'Toque para gerir estado'}
                        </div>}
                    <div style={{ marginTop: 6 }}>
                      <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); setRoomMenu(r); }}>Estado</button>
                    </div>
                  </div>
                </button>
              );
            })}
        </div>
      ) : tab === 'housekeeping' ? (
        <HousekeepingTab rows={hk} rooms={rooms} onChanged={refresh} />
      ) : tab === 'maintenance' ? (
        <MaintenanceTab rows={mt} rooms={rooms} onChanged={refresh} />
      ) : (
        <>
          <div className="card toolbar-sticky" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 10px', top: 52 }}>
            <button className={`chip${filter === '' ? ' active' : ''}`} onClick={() => setFilter('')}>Todas</button>
            {STATUS.map((s) => <button key={s.id} className={`chip${filter === s.id ? ' active' : ''}`} onClick={() => setFilter(s.id)}>{s.label}</button>)}
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {reservations.length === 0 ? <div className="empty" style={{ padding: 26 }}><p>Sem reservas.</p></div>
              : reservations.map((r) => (
                <button key={r.id} className="list-row" onClick={() => void openRes(r.id)} style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', padding: '12px 16px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: 14 }}>{r.number} · {r.guest_name || 'Hóspede'}{r.source === 'ONLINE' && r.status === 'BOOKED' ? <span className="pill" style={{ marginLeft: 6, background: 'var(--primary)', color: '#fff' }}>🌐 Online</span> : null}</strong>
                    <div className="muted" style={{ fontSize: 12.5 }}>{r.room_name || '—'} · {r.check_in} → {r.check_out} ({r.nights} noites)</div>
                  </div>
                  <span style={{ fontWeight: 700, marginRight: 8 }}>{KZ(r.total)}</span>
                  <span className={`pill ${r.status === 'CHECKED_OUT' ? 'on' : r.status === 'CANCELLED' ? 'off' : ''}`}>{SL(r.status)}</span>
                </button>
              ))}
          </div>
        </>
      )}

      {newRoom ? <NewRoom onClose={() => setNewRoom(false)} onCreated={async () => { setNewRoom(false); await loadRooms(); }} /> : null}
      {booking ? <BookRoom room={booking} onClose={() => setBooking(null)} onCreated={async (id) => { setBooking(null); await refresh(); await openRes(id); }} /> : null}
      {roomMenu ? <RoomMenuModal room={roomMenu} onClose={() => setRoomMenu(null)} onChanged={async () => { setRoomMenu(null); await loadRooms(); }} /> : null}
      {detail ? <ResDetail detail={detail} onClose={() => setDetail(null)} onChanged={async () => { setDetail(await api.hotel.reservation(detail.reservation.id)); await refresh(); }} /> : null}
    </>
  );
}

function NewRoom({ onClose, onCreated }: { onClose(): void; onCreated(): void }) {
  const [f, setF] = useState({ code: '', name: '', roomType: 'Duplo', category: 'Standard', floor: '', capacity: '2', rate: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.name.trim()) { toast.warning('Indique o nome do quarto.'); return; }
    setBusy(true);
    try {
      await api.hotel.createRoom({ code: f.code.trim() || undefined, name: f.name.trim(), roomType: f.roomType.trim(), category: f.category.trim(), floor: f.floor.trim() || undefined, capacity: Number(f.capacity) || 2, rate: Number(f.rate) || 0 });
      toast.success('Quarto criado.'); onCreated();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha.'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Novo quarto" onClose={onClose}>
      <div className="grid-2">
        <div className="field"><label>Nº / Código</label><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="101" /></div>
        <div className="field"><label>Andar</label><input value={f.floor} onChange={(e) => setF({ ...f, floor: e.target.value })} placeholder="1" /></div>
      </div>
      <div className="grid-2">
        <div className="field"><label>Categoria</label>
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            <option>Standard</option><option>Executivo</option><option>Luxo</option><option>Suite</option><option>VIP</option>
          </select></div>
        <div className="field"><label>Tipo</label>
          <select value={f.roomType} onChange={(e) => setF({ ...f, roomType: e.target.value })}>
            <option>Individual</option><option>Duplo</option><option>Twin</option><option>Suite</option><option>Família</option>
          </select></div>
      </div>
      <div className="field"><label>Nome</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Quarto 101" /></div>
      <div className="grid-2">
        <div className="field"><label>Capacidade</label><input value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value.replace(/\D/g, '') })} inputMode="numeric" /></div>
        <div className="field"><label>Preço / noite (Kz)</label><input value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" placeholder="0" /></div>
      </div>
      <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A criar…' : 'Criar quarto'}</button>
    </Modal>
  );
}

/** Gestão do estado físico do quarto + abrir manutenção rápida. */
function RoomMenuModal({ room, onClose, onChanged }: { room: HotelRoomMapRow; onClose(): void; onChanged(): void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const setStatus = async (s: string) => {
    setBusy(true);
    try { await api.hotel.roomStatus(room.id, s); toast.success('Estado atualizado.'); onChanged(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha.'); setBusy(false); }
  };
  const openMaint = async () => {
    if (!problem.trim()) { toast.warning('Descreva o problema.'); return; }
    setBusy(true);
    try { await api.hotel.createMaintenance({ roomId: room.id, problem: problem.trim() }); toast.success('Manutenção aberta.'); onChanged(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha.'); setBusy(false); }
  };
  const st = ROOM_STATE[room.status] ?? ROOM_STATE.AVAILABLE;
  return (
    <Modal title={`${room.name} — ${st.label}`} onClose={onClose}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <button className="btn sm" disabled={busy} onClick={() => void setStatus('AVAILABLE')}>🟢 Livre</button>
        <button className="btn sm ghost" disabled={busy} onClick={() => void setStatus('CLEANING')}>🟣 Limpeza</button>
        <button className="btn sm ghost" disabled={busy} onClick={() => void setStatus('BLOCKED')}>⛔ Bloquear</button>
      </div>
      <div className="field"><label>Abrir manutenção (avaria)</label>
        <input value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="ex.: Ar condicionado avariado" /></div>
      <button className="btn lg block" disabled={busy} onClick={() => void openMaint()}>🔧 Abrir manutenção</button>
    </Modal>
  );
}

/** Lista de limpeza (housekeeping): tarefas pendentes/feitas + criar + concluir. */
function HousekeepingTab({ rows, rooms, onChanged }: { rows: HotelHousekeepingRow[]; rooms: HotelRoomMapRow[]; onChanged(): void }) {
  const [roomId, setRoomId] = useState('');
  const [task, setTask] = useState('CLEAN');
  const add = async () => {
    if (!roomId) { toast.warning('Escolha um quarto.'); return; }
    try { await api.hotel.createHousekeeping({ roomId, task }); toast.success('Tarefa criada.'); onChanged(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha.'); }
  };
  const done = async (id: string) => { try { await api.hotel.doneHousekeeping(id); onChanged(); } catch { /* */ } };
  return (
    <>
      <div className="card" style={{ display: 'flex', gap: 8, padding: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1, margin: 0, minWidth: 140 }}><label>Quarto</label>
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">—</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select></div>
        <div className="field" style={{ width: 150, margin: 0 }}><label>Tarefa</label>
          <select value={task} onChange={(e) => setTask(e.target.value)}>
            <option value="CLEAN">Limpar</option><option value="CHANGE_LINEN">Trocar roupa</option><option value="INSPECT">Inspecionar</option>
          </select></div>
        <button className="btn" onClick={() => void add()}>Adicionar</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {rows.length === 0 ? <div className="empty" style={{ padding: 24 }}><p>Sem tarefas de limpeza.</p></div>
          : rows.map((h) => (
            <div key={h.id} className="list-row" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 13.5 }}>{h.room_name || 'Quarto'} · {TASK_L[h.task] ?? h.task}</strong>
                {h.assigned_to ? <div className="muted" style={{ fontSize: 12 }}>👤 {h.assigned_to}</div> : null}
              </div>
              {h.status === 'PENDING'
                ? <button className="btn sm success" onClick={() => void done(h.id)}>✔ Concluir</button>
                : <span className="pill on">Feito</span>}
            </div>
          ))}
      </div>
    </>
  );
}

/** Lista de manutenção: avarias por quarto + estado (aberto/em reparação/concluído). */
function MaintenanceTab({ rows, rooms, onChanged }: { rows: HotelMaintenanceRow[]; rooms: HotelRoomMapRow[]; onChanged(): void }) {
  const [roomId, setRoomId] = useState('');
  const [problem, setProblem] = useState('');
  const add = async () => {
    if (!roomId || !problem.trim()) { toast.warning('Escolha o quarto e descreva o problema.'); return; }
    try { await api.hotel.createMaintenance({ roomId, problem: problem.trim() }); toast.success('Manutenção aberta.'); setProblem(''); onChanged(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha.'); }
  };
  const setStatus = async (id: string, s: string) => { try { await api.hotel.maintenanceStatus(id, s); onChanged(); } catch { /* */ } };
  return (
    <>
      <div className="card" style={{ display: 'flex', gap: 8, padding: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ width: 150, margin: 0 }}><label>Quarto</label>
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">—</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select></div>
        <div className="field" style={{ flex: 1, margin: 0, minWidth: 160 }}><label>Problema</label>
          <input value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="ex.: TV não liga" /></div>
        <button className="btn" onClick={() => void add()}>Abrir</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {rows.length === 0 ? <div className="empty" style={{ padding: 24 }}><p>Sem manutenções.</p></div>
          : rows.map((m) => (
            <div key={m.id} className="list-row" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 13.5 }}>{m.room_name || 'Quarto'}</strong>
                <div className="muted" style={{ fontSize: 12 }}>{m.problem}</div>
              </div>
              <select value={m.status} onChange={(e) => void setStatus(m.id, e.target.value)} style={{ fontSize: 12.5 }}>
                <option value="OPEN">{MT_L.OPEN}</option><option value="IN_REPAIR">{MT_L.IN_REPAIR}</option><option value="DONE">{MT_L.DONE}</option>
              </select>
            </div>
          ))}
      </div>
    </>
  );
}

function BookRoom({ room, onClose, onCreated }: { room: HotelRoomMapRow; onClose(): void; onCreated(id: string): void }) {
  const ci = today();
  const [f, setF] = useState({ guestName: '', guestPhone: '', checkIn: ci, checkOut: addDays(ci, 1), guests: '1' });
  const [busy, setBusy] = useState(false);
  const nights = Math.max(1, Math.round((new Date(f.checkOut + 'T00:00:00').getTime() - new Date(f.checkIn + 'T00:00:00').getTime()) / 86400000));
  const estimate = nights * Number(room.rate);
  const save = async () => {
    if (f.checkOut <= f.checkIn) { toast.warning('A saída deve ser depois da entrada.'); return; }
    setBusy(true);
    try {
      const r = await api.hotel.createReservation({ roomId: room.id, guestName: f.guestName.trim() || undefined, guestPhone: f.guestPhone.trim() || undefined, checkIn: f.checkIn, checkOut: f.checkOut, guests: Number(f.guests) || 1 });
      toast.success('Reserva criada.'); onCreated(r.id);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao reservar.'); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Reservar — ${room.name}`} onClose={onClose}>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{room.room_type || 'Quarto'} · {room.capacity}p · {KZ(room.rate)}/noite</div>
      <div className="grid-2">
        <div className="field"><label>Hóspede</label><input value={f.guestName} onChange={(e) => setF({ ...f, guestName: e.target.value })} placeholder="Nome" /></div>
        <div className="field"><label>Telefone</label><input value={f.guestPhone} onChange={(e) => setF({ ...f, guestPhone: e.target.value })} inputMode="tel" /></div>
      </div>
      <div className="grid-2">
        <div className="field"><label>Entrada</label><input type="date" value={f.checkIn} onChange={(e) => setF({ ...f, checkIn: e.target.value })} /></div>
        <div className="field"><label>Saída</label><input type="date" value={f.checkOut} min={addDays(f.checkIn, 1)} onChange={(e) => setF({ ...f, checkOut: e.target.value })} /></div>
      </div>
      <div className="field"><label>Nº de hóspedes</label><input value={f.guests} onChange={(e) => setF({ ...f, guests: e.target.value.replace(/\D/g, '') })} inputMode="numeric" /></div>
      <div className="row" style={{ alignItems: 'center', margin: '6px 0 12px' }}>
        <span className="muted">{nights} noite(s) × {KZ(room.rate)}</span><span className="spacer" style={{ flex: 1 }} />
        <strong style={{ fontSize: 18 }}>{KZ(estimate)}</strong>
      </div>
      <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A reservar…' : 'Confirmar reserva'}</button>
    </Modal>
  );
}

function ResDetail({ detail, onClose, onChanged }: { detail: HotelReservationDetail; onClose(): void; onChanged(): void }) {
  const r = detail.reservation;
  const [products, setProducts] = useState<ManagerProduct[]>([]);
  const [q, setQ] = useState('');
  const [extra, setExtra] = useState({ description: '', price: '' });
  useEffect(() => { api.products.list().then(setProducts).catch(() => undefined); }, []);

  const addProduct = async (code: string) => { await api.hotel.addFolio(r.id, { productCode: code, quantity: 1 }).catch((e) => toast.error(e instanceof ApiError ? e.message : 'Falha.')); onChanged(); };
  const addExtra = async () => {
    if (!extra.description.trim()) { toast.warning('Descreva o consumo.'); return; }
    await api.hotel.addFolio(r.id, { description: extra.description.trim(), unitPrice: Number(extra.price) || 0, quantity: 1 }).catch(() => undefined);
    setExtra({ description: '', price: '' }); onChanged();
  };
  const removeItem = async (id: string) => { await api.hotel.removeFolio(id).catch(() => undefined); onChanged(); };
  const setStatus = async (s: string) => { await api.hotel.status(r.id, s).catch(() => undefined); onChanged(); };
  const [billing, setBilling] = useState(false);
  const invoice = async () => {
    setBilling(true);
    try { const inv = await api.hotel.invoice(r.id); toast.success(`Fatura ${inv.invoiceNumber} emitida. Check-out feito.`); onClose(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao faturar.'); } finally { setBilling(false); }
  };
  const roomCharge = Number(r.nights) * Number(r.rate);
  const filtered = q.trim() ? products.filter((p) => `${p.name} ${p.code}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 20) : products.slice(0, 12);

  return (
    <Modal title={`${r.number} — ${SL(r.status)}`} onClose={onClose}>
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 13.5 }}><strong>{r.guest_name || 'Hóspede'}</strong>{r.guest_phone ? ` · ${r.guest_phone}` : ''}</div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>🛏️ {r.room_name || '—'} · {r.check_in} → {r.check_out} · {r.nights} noite(s) · {r.guests}p</div>
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {r.status === 'BOOKED' ? <button className="btn" onClick={() => void setStatus('CHECKED_IN')}>✅ Check-in</button> : null}
        {r.status === 'CHECKED_IN' ? <button className="btn success" onClick={() => void invoice()} disabled={billing}>🧾 {billing ? 'A faturar…' : 'Faturar (AGT) e check-out'}</button> : null}
        {r.status === 'CHECKED_IN' ? <button className="btn ghost" onClick={() => void setStatus('CHECKED_OUT')}>Check-out s/ fatura</button> : null}
        {(r.status === 'BOOKED' || r.status === 'CHECKED_IN') ? <button className="btn ghost" onClick={() => void setStatus('CANCELLED')}>Cancelar</button> : null}
        {r.status === 'CHECKED_OUT' ? <div className="banner success" style={{ width: '100%' }}>Reserva concluída.</div> : null}
      </div>

      {/* Consumos do stock */}
      <label className="auth-label" style={{ color: 'var(--muted)', fontSize: 13, fontWeight: 600, margin: '6px 0' }}>Adicionar consumo (stock)</label>
      <div className="card" style={{ padding: '2px 12px', marginBottom: 8 }}>
        <div className="row"><IconSearch size={18} /><input style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '10px 0', color: 'var(--text)' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar produto…" /></div>
      </div>
      <div className="pgrid" style={{ maxHeight: '16vh', overflowY: 'auto', marginBottom: 10 }}>
        {filtered.map((p) => (
          <button key={p.id} className="pcard" onClick={() => void addProduct(p.code)} style={{ cursor: 'pointer', textAlign: 'left' }}>
            <div className="pinfo"><div className="pname" style={{ fontSize: 13 }}>{p.name}</div><div className="pcode">{p.code}</div></div>
          </button>
        ))}
      </div>

      {/* Extra manual */}
      <div className="row" style={{ gap: 8, marginBottom: 12, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1, margin: 0 }}><label>Extra / serviço</label><input value={extra.description} onChange={(e) => setExtra({ ...extra, description: e.target.value })} placeholder="ex.: Lavandaria" /></div>
        <div className="field" style={{ width: 120, margin: 0 }}><label>Preço</label><input value={extra.price} onChange={(e) => setExtra({ ...extra, price: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" placeholder="0" /></div>
        <button className="btn" onClick={() => void addExtra()}>Adicionar</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
        <div className="list-row" style={{ padding: '10px 14px' }}>
          <div style={{ flex: 1, minWidth: 0 }}><strong style={{ fontSize: 13.5 }}>Estadia · {r.nights}× {KZ(r.rate)}</strong></div>
          <span style={{ fontWeight: 700 }}>{KZ(roomCharge)}</span>
        </div>
        {detail.folio.map((it) => (
          <div key={it.id} className="list-row" style={{ padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: 13.5 }}>{Number(it.quantity)}× {it.description}</strong>
              <div className="muted" style={{ fontSize: 12 }}>{KZ(it.unit_price)}</div>
            </div>
            <span style={{ fontWeight: 700, marginRight: 8 }}>{KZ(Number(it.unit_price) * Number(it.quantity))}</span>
            <button className="btn sm ghost" onClick={() => void removeItem(it.id)}><IconTrash size={14} /></button>
          </div>
        ))}
      </div>

      <div className="row" style={{ alignItems: 'center' }}>
        <strong style={{ fontSize: 16 }}>Total da conta</strong><span className="spacer" style={{ flex: 1 }} />
        <strong style={{ fontSize: 20 }}>{KZ(r.total)}</strong>
      </div>
    </Modal>
  );
}
