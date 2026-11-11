import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { AdminNote } from '../api/types';
import { confirmDialog } from './feedback';
import { pollEvery, stopPoll } from '../poll';

/**
 * Sino da EMPRESA: no topo os pedidos pendentes (encomendas, serviços, reservas, férias);
 * por baixo a central de notificações (encomendas da loja online, pedidos e mensagens dos
 * associados do LPS Kwanza, saques…) com seleção, marcar lida/não lida e eliminar.
 */
export function NotificationCenter({ onGo }: { onGo(section: string): void }) {
  const [orders, setOrders] = useState(0);
  const [services, setServices] = useState(0);
  const [rooms, setRooms] = useState(0);
  const [leaves, setLeaves] = useState(0);
  const [notes, setNotes] = useState<AdminNote[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement | null>(null);
  const loadNotes = () => api.adminNotes.list().then((r) => { setNotes(r.items); setUnread(r.unread); }).catch(() => undefined);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      api.leave.summary().then((r) => { if (alive) setLeaves(r.pending); }).catch(() => undefined);
      api.orders.pendingCount().then((r) => { if (alive) setOrders(r.count); }).catch(() => undefined);
      api.serviceOrders.pendingOnline().then((r) => { if (alive) setServices(r.count); }).catch(() => undefined);
      api.hotel.pendingOnline().then((r) => { if (alive) setRooms(r.count); }).catch(() => undefined);
      api.adminNotes.list().then((r) => { if (alive) { setNotes(r.items); setUnread(r.unread); } }).catch(() => undefined);
    };
    tick();
    const t = pollEvery(tick, 15000);
    const onFocus = () => tick();
    window.addEventListener('focus', onFocus);
    return () => { alive = false; stopPoll(t); window.removeEventListener('focus', onFocus); };
  }, []);

  useEffect(() => {
    if (!open) { setSel(new Set()); return; }
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pending = orders + services + rooms + leaves;
  const total = pending + unread;
  const act = async (fn: () => Promise<unknown>) => { await fn().catch(() => undefined); setSel(new Set()); await loadNotes(); };
  const go = (it: AdminNote) => {
    if (!it.read) void api.adminNotes.read([it.id]).then(loadNotes).catch(() => undefined);
    if (it.ref && it.section === 'kwanza') { try { sessionStorage.setItem('ndombaxi.kwanza.ref', it.ref); window.setTimeout(() => window.dispatchEvent(new Event('ndombaxi:kwanza-ref')), 0); } catch { /* sem armazenamento */ } }
    setOpen(false);
    if (it.section) onGo(it.section);
  };
  const toggle = (id: string) => setSel((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const ids = [...sel];
  const rows: Array<[number, string, string]> = [
    [orders, 'encomenda(s) por tratar', 'orders'], [services, 'pedido(s) de serviço', 'service-orders'],
    [rooms, 'reserva(s) online', 'hotel'], [leaves, 'pedido(s) de férias/ausência', 'leave'],
  ];
  const removeAll = async () => { if (await confirmDialog({ message: 'Eliminar todas as notificações?', danger: true })) await act(() => api.adminNotes.removeAll()); };

  return (
    <div className="noti-wrap" ref={ref}>
      <button className="icon-btn noti-btn" onClick={() => setOpen((v) => !v)} title="Notificações" aria-label="Notificações" aria-expanded={open}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {total > 0 ? <span className="noti-badge">{total > 99 ? '99+' : total}</span> : null}
      </button>
      {open ? (
        <div className="noti-pop nc-pop" role="dialog" aria-label="Notificações">
          <div className="nc-head">
            <strong>Notificações</strong>
            {unread ? <span className="noti-badge inline">{unread}</span> : null}
            <span style={{ flex: 1 }} />
            {notes.length ? <button className="nc-link" onClick={() => void act(() => api.adminNotes.readAll())} disabled={!unread}>Marcar todas como lidas</button> : null}
          </div>
          {pending ? (
            <div className="nc-pending">
              {rows.filter((r) => r[0] > 0).map(([c, l, k]) => (
                <button key={k} className="nc-pend" onClick={() => { setOpen(false); onGo(k); }}><strong>{c}</strong> {l}</button>
              ))}
            </div>
          ) : null}
          {sel.size ? (
            <div className="nc-bulk">
              <span>{sel.size} selecionada(s)</span><span style={{ flex: 1 }} />
              <button className="nc-link" onClick={() => void act(() => api.adminNotes.read(ids))}>Marcar lidas</button>
              <button className="nc-link" onClick={() => void act(() => api.adminNotes.unread(ids))}>Marcar não lidas</button>
              <button className="nc-link danger" onClick={() => void act(() => api.adminNotes.remove(ids))}>Eliminar</button>
            </div>
          ) : null}
          <div className="nc-list">
            {!notes.length ? (pending ? null : <div className="noti-pop-empty">Sem notificações</div>) : notes.map((it) => (
              <div key={it.id} className={`nc-item${it.read ? '' : ' unread'}${sel.has(it.id) ? ' on' : ''}`}>
                <input type="checkbox" checked={sel.has(it.id)} onChange={() => toggle(it.id)} aria-label={`Selecionar: ${it.title}`} />
                <button className="nc-body" onClick={() => go(it)}>
                  <span className="nc-title">{it.title}</span>
                  {it.body ? <span className="nc-text">{it.body}</span> : null}
                  <span className="nc-time">{new Date(it.createdAt).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                </button>
                <div className="nc-acts">
                  <button title={it.read ? 'Marcar como não lida' : 'Marcar como lida'} aria-label={it.read ? 'Marcar como não lida' : 'Marcar como lida'}
                    onClick={() => void act(() => (it.read ? api.adminNotes.unread([it.id]) : api.adminNotes.read([it.id])))}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{it.read ? <circle cx="12" cy="12" r="5" /> : <path d="M20 6 9 17l-5-5" />}</svg>
                  </button>
                  <button title="Eliminar" aria-label="Eliminar" className="danger" onClick={() => void act(() => api.adminNotes.remove([it.id]))}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
          {notes.length ? (
            <div className="nc-foot">
              <label className="nc-all"><input type="checkbox" checked={sel.size === notes.length} onChange={(e) => setSel(e.target.checked ? new Set(notes.map((x) => x.id)) : new Set())} /> Selecionar todas</label>
              <span style={{ flex: 1 }} />
              <button className="nc-link danger" onClick={() => void removeAll()}>Eliminar todas</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
