import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { ChatContact, ChatMessage } from '../api/types';
import { ChatView } from './ChatView';

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
  const [search, setSearch] = useState('');
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

  const cvContacts = contacts.map((c) => ({ id: c.id, name: c.name, sub: `${ROLE_LABEL[c.role] ?? c.role} · ${seenLabel(c)}`, online: c.online, unread: c.unread }));
  const cvPeer = peer ? cvContacts.find((c) => c.id === peer.id) ?? { id: peer.id, name: peer.name, sub: '', online: peer.online, unread: 0 } : null;

  return (
    <ChatView
      title={'Chat com o gerente'} subtitle="Conversas da equipa" emptyText="Sem ninguém para conversar." searchPlaceholder="Pesquisar por nome ou função…"
      contacts={cvContacts} search={search} onSearch={setSearch}
      peer={cvPeer} peerStatus={peer ? `${ROLE_LABEL[peer.role] ?? peer.role} · ${seenLabel(peer)}` : ''}
      onOpen={(cv) => { const c = contacts.find((x) => x.id === cv.id); if (c) { setSelMode(false); setSel(new Set()); setPeer(c); }; }}
      onBack={() => { setPeer(null); setSelMode(false); setSel(new Set()); }}
      msgs={msgs.map((m) => ({ id: m.id, mine: !!meId && m.sender_id === meId, body: m.body, at: time(m.created_at), author: m.sender_name }))}
      selMode={selMode} sel={sel} onToggleSel={toggleMsg} onSelMode={(v) => { setSelMode(v); if (!v) setSel(new Set()); }} onDelete={() => void delSelected()}
      text={text} onText={setText} onSend={() => void send()} busy={busy} onClose={onClose}
    />
  );
}
