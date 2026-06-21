import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { ChatContact, ChatMessage } from '../api/types';
import { IconClose } from './Icons';

const ROLE_LABEL: Record<string, string> = {
  COMPANY_ADMIN: 'Administrador', REGIONAL_MANAGER: 'Gerente regional', STORE_MANAGER: 'Gestor',
  SHIFT_SUPERVISOR: 'Supervisor', CASHIER: 'Caixa', ATTENDANT: 'Atendedor',
};
const time = (s: string) => { try { return new Date(s).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const seenLabel = (c: { online: boolean; last_seen_at: string | null }) => {
  if (c.online) return 'online';
  if (!c.last_seen_at) return 'offline';
  const m = Math.round((Date.now() - new Date(c.last_seen_at).getTime()) / 60000);
  if (m < 1) return 'visto agora'; if (m < 60) return `visto há ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `visto há ${h} h`;
  return `visto há ${Math.round(h / 24)} d`;
};

/** Chat 1:1 do caixa com o gerente: contactos com presença, conversa, e
 *  selecionar/eliminar mensagens (estilo rede social). Guardado no servidor. */
export function ChatModal({ meId, onClose, onRead }: { meId?: string; onClose(): void; onRead?(): void }) {
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [peer, setPeer] = useState<ChatContact | null>(null);
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [selMode, setSelMode] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement | null>(null);

  const loadContacts = async () => { try { setContacts(await api.chatContacts()); } catch { /* offline */ } };
  const loadMsgs = async (p: ChatContact) => { try { setMsgs(await api.chatMessages(p.id)); } catch { /* offline */ } };

  useEffect(() => { void loadContacts(); const t = window.setInterval(loadContacts, 5000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    if (!peer) return;
    void loadMsgs(peer);
    void api.chatMarkRead(peer.id).then(() => onRead?.()).catch(() => undefined);
    const t = window.setInterval(() => { if (peer) { void loadMsgs(peer); void loadContacts(); } }, 3000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peer?.id]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs]);
  useEffect(() => {
    if (!peer) return;
    const fresh = contacts.find((c) => c.id === peer.id);
    if (fresh && (fresh.online !== peer.online || fresh.last_seen_at !== peer.last_seen_at)) setPeer(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts]);

  const send = async () => {
    const body = text.trim();
    if (!body || !peer || busy) return;
    setBusy(true);
    try { await api.chatSend(peer.id, body); setText(''); await loadMsgs(peer); } catch { /* */ } finally { setBusy(false); }
  };
  const toggleMsg = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const delSelected = async () => {
    if (sel.size === 0) return;
    if (!window.confirm(`Eliminar ${sel.size} mensagem(ns)?`)) return;
    try { await api.chatDelete([...sel]); setSel(new Set()); setSelMode(false); if (peer) await loadMsgs(peer); } catch { /* */ }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100dvh - 40px)', overflow: 'hidden' }}>
        {!peer ? (
          <>
            <div className="row" style={{ alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
              <h2 style={{ margin: 0, fontSize: 17 }}>💬 Chat com o gerente</h2>
              <span className="spacer" style={{ flex: 1 }} />
              <button className="trash" onClick={onClose} aria-label="Fechar"><IconClose size={22} /></button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {contacts.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>Sem ninguém para conversar.</div>
              ) : contacts.map((c) => (
                <button key={c.id} onClick={() => { setSelMode(false); setSel(new Set()); setPeer(c); }}
                  style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text)' }}>
                  <span style={{ position: 'relative', width: 38, height: 38, borderRadius: 999, background: 'var(--surface-2, var(--bg-2))', display: 'grid', placeItems: 'center', fontWeight: 800, flex: 'none' }}>
                    {c.name.slice(0, 1).toUpperCase()}
                    <span style={{ position: 'absolute', right: 0, bottom: 0, width: 11, height: 11, borderRadius: 999, background: c.online ? 'var(--success)' : 'var(--muted)', boxShadow: '0 0 0 2px var(--bg-2, var(--bg))' }} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: 14 }}>{c.name}</strong>
                    <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{ROLE_LABEL[c.role] ?? c.role} · {seenLabel(c)}</div>
                  </div>
                  {c.unread > 0 ? <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: '#ef4444', color: '#fff', fontSize: 11, fontWeight: 800, display: 'inline-grid', placeItems: 'center' }}>{c.unread > 99 ? '99+' : c.unread}</span> : null}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="row" style={{ alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
              <button className="btn sm ghost" onClick={() => { setPeer(null); setSelMode(false); setSel(new Set()); }}>←</button>
              <span style={{ width: 9, height: 9, borderRadius: 999, background: peer.online ? 'var(--success)' : 'var(--muted)', flex: 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 14 }}>{peer.name}</strong>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{ROLE_LABEL[peer.role] ?? peer.role} · {seenLabel(peer)}</div>
              </div>
              {selMode ? (
                <>
                  <button className="btn sm danger" onClick={() => void delSelected()} disabled={sel.size === 0}>Eliminar ({sel.size})</button>
                  <button className="btn sm ghost" onClick={() => { setSelMode(false); setSel(new Set()); }}>Cancelar</button>
                </>
              ) : (
                <button className="btn sm ghost" onClick={() => setSelMode(true)} disabled={msgs.length === 0}>Selecionar</button>
              )}
            </div>
            <div ref={scroller} style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
              {msgs.length === 0 ? (
                <div style={{ margin: 'auto', color: 'var(--muted)', fontSize: 14, textAlign: 'center' }}>Sem mensagens. Escreve a primeira.</div>
              ) : msgs.map((m) => {
                const mine = !!meId && m.sender_id === meId;
                const checked = sel.has(m.id);
                return (
                  <div key={m.id} onClick={() => selMode && toggleMsg(m.id)} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', gap: 8, alignItems: 'center', cursor: selMode ? 'pointer' : 'default' }}>
                    {selMode ? <input type="checkbox" checked={checked} readOnly /> : null}
                    <div style={{ maxWidth: '80%' }}>
                      <div style={{ background: mine ? 'var(--primary)' : 'var(--surface-2, var(--bg-2))', color: mine ? '#fff' : 'var(--text)', padding: '8px 12px', borderRadius: 14, fontSize: 14, lineHeight: 1.4, wordBreak: 'break-word', outline: checked ? '2px solid var(--danger)' : 'none' }}>{m.body}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--muted)', textAlign: mine ? 'right' : 'left', marginTop: 2 }}>{time(m.created_at)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="row" style={{ gap: 8, alignItems: 'flex-end', padding: 12, borderTop: '1px solid var(--border)', flex: 'none' }}>
              <textarea value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                placeholder={`Mensagem para ${peer.name}…`} rows={1}
                style={{ flex: 1, resize: 'none', minHeight: 44, maxHeight: 120, padding: '11px 12px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14, fontFamily: 'inherit' }} />
              <button className="btn" onClick={() => void send()} disabled={busy || !text.trim()} style={{ height: 44 }}>Enviar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
