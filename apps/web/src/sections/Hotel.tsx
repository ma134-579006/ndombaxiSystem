import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { HotelReservationDetail, HotelReservationRow, HotelRoomMapRow, ManagerProduct } from '../api/types';
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
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

/** Hotelaria — mapa de quartos, reservas e conta do hóspede (folio). */
export function Hotel() {
  const [tab, setTab] = useState<'rooms' | 'reservations'>('rooms');
  const [rooms, setRooms] = useState<HotelRoomMapRow[]>([]);
  const [reservations, setReservations] = useState<HotelReservationRow[]>([]);
  const [filter, setFilter] = useState('');
  const [newRoom, setNewRoom] = useState(false);
  const [booking, setBooking] = useState<HotelRoomMapRow | null>(null);
  const [detail, setDetail] = useState<HotelReservationDetail | null>(null);

  const loadRooms = useCallback(async () => { try { setRooms(await api.hotel.roomMap()); } catch { /* */ } }, []);
  const loadRes = useCallback(async () => { try { setReservations(await api.hotel.reservations(filter || undefined)); } catch { /* */ } }, [filter]);
  useEffect(() => { void loadRooms(); }, [loadRooms]);
  useEffect(() => { if (tab === 'reservations') void loadRes(); }, [tab, loadRes]);

  const openRes = async (id: string) => { try { setDetail(await api.hotel.reservation(id)); } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha.'); } };
  const refresh = async () => { await loadRooms(); if (tab === 'reservations') await loadRes(); };

  return (
    <>
      <div className="content-head">
        <h2>🏨 Hotelaria</h2>
        <span className="spacer" />
        {tab === 'rooms'
          ? <button className="btn ghost" onClick={() => setNewRoom(true)}><IconPlus size={17} /> Quarto</button>
          : null}
      </div>

      <div className="card toolbar-sticky" style={{ display: 'flex', gap: 6, padding: '8px 10px' }}>
        <button className={`chip${tab === 'rooms' ? ' active' : ''}`} onClick={() => setTab('rooms')}>🛏️ Quartos</button>
        <button className={`chip${tab === 'reservations' ? ' active' : ''}`} onClick={() => setTab('reservations')}>📅 Reservas</button>
      </div>

      {tab === 'rooms' ? (
        <div className="pgrid">
          {rooms.length === 0 ? <div className="empty" style={{ padding: 26, gridColumn: '1/-1' }}><p>Sem quartos. Crie o primeiro com “Quarto”.</p></div>
            : rooms.map((r) => {
              const occupied = !!r.reservation_id;
              return (
                <button key={r.id} className="pcard" onClick={() => occupied ? void openRes(r.reservation_id!) : setBooking(r)}
                  style={{ cursor: 'pointer', textAlign: 'left', borderLeft: `4px solid ${occupied ? 'var(--warn,#e0a800)' : 'var(--ok,#16a34a)'}` }}>
                  <div className="pinfo">
                    <div className="pname" style={{ fontSize: 14 }}>{occupied ? '🟠' : '🟢'} {r.name}</div>
                    <div className="pcode">{r.room_type || 'Quarto'} · {r.capacity}p · {KZ(r.rate)}/noite</div>
                    {occupied ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>👤 {r.guest_name || 'Hóspede'} · saída {r.check_out}</div>
                      : <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Livre — toque para reservar</div>}
                  </div>
                </button>
              );
            })}
        </div>
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
      {detail ? <ResDetail detail={detail} onClose={() => setDetail(null)} onChanged={async () => { setDetail(await api.hotel.reservation(detail.reservation.id)); await refresh(); }} /> : null}
    </>
  );
}

function NewRoom({ onClose, onCreated }: { onClose(): void; onCreated(): void }) {
  const [f, setF] = useState({ code: '', name: '', roomType: 'Duplo', capacity: '2', rate: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.name.trim()) { toast.warning('Indique o nome do quarto.'); return; }
    setBusy(true);
    try {
      await api.hotel.createRoom({ code: f.code.trim() || undefined, name: f.name.trim(), roomType: f.roomType.trim(), capacity: Number(f.capacity) || 2, rate: Number(f.rate) || 0 });
      toast.success('Quarto criado.'); onCreated();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha.'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Novo quarto" onClose={onClose}>
      <div className="grid-2">
        <div className="field"><label>Nº / Código</label><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="101" /></div>
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
        {r.status === 'CHECKED_IN' ? <button className="btn" onClick={() => void setStatus('CHECKED_OUT')}>🧾 Check-out</button> : null}
        {(r.status === 'BOOKED' || r.status === 'CHECKED_IN') ? <button className="btn ghost" onClick={() => void setStatus('CANCELLED')}>Cancelar</button> : null}
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
