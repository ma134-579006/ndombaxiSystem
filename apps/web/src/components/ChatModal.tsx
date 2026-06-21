import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { ChatContact, ChatMessage } from '../api/types';
import { Modal } from './ui';
import { confirmDialog } from './feedback';

const ROLE_LABEL: Record<string, string> = {
  COMPANY_ADMIN: 'Administrador', REGIONAL_MANAGER: 'Gerente regional', STORE_MANAGER: 'Gestor',
  SHIFT_SUPERVISOR: 'Supervisor', CASHIER: 'Caixa', ATTENDANT: 'Atendedor',
};
const time = (s: string) => { try { return new Date(s).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const seenLabel = (c: { online: boolean; last_seen_at: string | null }) => {
  if (c.online) return 'online';
  if (!c.last_seen_at) return 'offline';
  const diff = Date.now() - new Date(c.last_seen_at).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'visto agora'; if (m < 60) return `visto há ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `visto há ${h} h`;
  return `visto há ${Math.round(h / 24)} d`;
};

/**
 * Chat de equipa 1:1 (gestor ↔ caixa): lista de contactos com presença
 * (online/offline) e não-lidas; conversa com o contacto escolhido; selecionar e
 * eliminar mensagens (estilo rede social). Tudo guardado no servidor.
 */
export function ChatModal({ meId, title, onClose, onRead }: { meId?: string; title: string; onClose(): void; onRead?(): void }) {
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [peer, setPeer] = useState<ChatContact | null>(null);
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [selMode, setSelMode] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement | null>(null);

  const loadContacts = async () => { try { setContacts(await api.chat.contacts()); } catch { /* offline */ } };
  const loadMsgs = async (p: ChatContact) => { try { setMsgs(await api.chat.messages(p.id)); } catch { /* offline */ } };

  useEffect(() => { void loadContacts(); const t = window.setInterval(loadContacts, 8000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    if (!peer) return;
    void loadMsgs(peer);
    void api.chat.markRead(peer.id).then(() => onRead?.()).catch(() => undefined);
    const t = window.setInterval(() => peer && loadMsgs(peer), 4000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peer?.id]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs]);

  const openPeer = (c: ChatContact) => { setSelMode(false); setSel(new Set()); setPeer(c); };
  const send = async () => {
    const body = text.trim();
    if (!body || !peer || busy) return;
    setBusy(true);
    try { await api.chat.send(peer.id, body); setText(''); await loadMsgs(peer); } catch { /* tenta depois */ } finally { setBusy(false); }
  };
  const toggleMsg = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const delSelected = async () => {
    if (sel.size === 0) return;
    if (!(await confirmDialog({ message: `Eliminar ${sel.size} mensagem(ns)?`, danger: true }))) return;
    try { await api.chat.remove([...sel]); setSel(new Set()); setSelMode(false); if (peer) await loadMsgs(peer); } catch { /* */ }
  };

  const Dot = ({ on }: { on: boolean }) => (
    <span style={{ width: 9, height: 9, borderRadius: 999, flex: 'none', background: on ? 'var(--success)' : 'var(--muted)', boxShadow: on ? '0 0 0 2px color-mix(in srgb, var(--success) 30%, transparent)' : 'none' }} />
  );

  return (
    <Modal title={peer ? '' : title} onClose={onClose}>
      {!peer ? (
        <div style={{ height: '56vh', maxHeight: '56vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {contacts.length === 0 ? (
            <div className="empty" style={{ margin: 'auto', textAlign: 'center', color: 'var(--muted)' }}><p>Sem membros na equipa para conversar.</p></div>
          ) : contacts.map((c) => (
            <button key={c.id} className="list-row" onClick={() => openPeer(c)} style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', padding: '11px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="fb-avatar" style={{ position: 'relative' }}>{c.name.slice(0, 1).toUpperCase()}
                <span style={{ position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: 999, background: c.online ? 'var(--success)' : 'var(--muted)', boxShadow: '0 0 0 2px var(--surface)' }} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 14 }}>{c.name}</strong>
                <div className="muted" style={{ fontSize: 12.5 }}>{ROLE_LABEL[c.role] ?? c.role} · {seenLabel(c)}</div>
              </div>
              {c.unread > 0 ? <span className="acct-item-badge">{c.unread > 99 ? '99+' : c.unread}</span> : null}
            </button>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', height: '60vh', maxHeight: '60vh' }}>
          {/* Cabeçalho da conversa */}
          <div className="row" style={{ gap: 10, alignItems: 'center', paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
            <button className="btn sm ghost" onClick={() => { setPeer(null); setSelMode(false); setSel(new Set()); }} title="Voltar">←</button>
            <Dot on={peer.online} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: 14 }}>{peer.name}</strong>
              <div className="muted" style={{ fontSize: 12 }}>{ROLE_LABEL[peer.role] ?? peer.role} · {seenLabel(peer)}</div>
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

          <div ref={scroller} style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 2px' }}>
            {msgs.length === 0 ? (
              <div style={{ margin: 'auto', color: 'var(--muted)', fontSize: 14, textAlign: 'center' }}>Sem mensagens. Escreve a primeira.</div>
            ) : msgs.map((m) => {
              const mine = !!meId && m.sender_id === meId;
              const checked = sel.has(m.id);
              return (
                <div key={m.id} onClick={() => selMode && toggleMsg(m.id)}
                  style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', gap: 8, alignItems: 'center', cursor: selMode ? 'pointer' : 'default' }}>
                  {selMode ? <input type="checkbox" checked={checked} readOnly /> : null}
                  <div style={{ maxWidth: '78%' }}>
                    <div style={{ background: mine ? 'var(--primary)' : 'var(--surface-2)', color: mine ? '#fff' : 'var(--text)', padding: '8px 12px', borderRadius: 14, fontSize: 14, lineHeight: 1.4, wordBreak: 'break-word', outline: checked ? '2px solid var(--danger)' : 'none' }}>{m.body}</div>
                    <div className="muted" style={{ fontSize: 10.5, textAlign: mine ? 'right' : 'left', marginTop: 2 }}>{time(m.created_at)}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="row" style={{ gap: 8, alignItems: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
            <textarea value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder={`Mensagem para ${peer.name}…`} rows={1}
              style={{ flex: 1, resize: 'none', minHeight: 44, maxHeight: 120, padding: '11px 12px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14, fontFamily: 'inherit' }} />
            <button className="btn" onClick={() => void send()} disabled={busy || !text.trim()} style={{ height: 44 }}>Enviar</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
