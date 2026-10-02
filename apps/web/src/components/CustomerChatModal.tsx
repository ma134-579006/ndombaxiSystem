import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { CustomerChatMessage, CustomerContact } from '../api/types';
import { ChatView } from './ChatView';
import { confirmDialog } from './feedback';
import { pollEvery, stopPoll } from '../poll';

const time = (s: string) => { try { return new Date(s).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const seenLabel = (c: { online: boolean; last_seen_at: string | null }) => {
  if (c.online) return 'online';
  if (!c.last_seen_at) return 'offline';
  const m = Math.round((Date.now() - new Date(c.last_seen_at).getTime()) / 60000);
  if (m < 1) return 'visto agora'; if (m < 60) return `visto há ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `visto há ${h} h`;
  return `visto há ${Math.round(h / 24)} d`;
};

/**
 * Chat da equipa com os CLIENTES da loja online (livre, sem encomenda). Lista de
 * clientes com presença + não-lidas; conversa; selecionar/eliminar mensagens.
 */
export function CustomerChatModal({ onClose, onRead }: { onClose(): void; onRead?(): void }) {
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [peer, setPeer] = useState<CustomerContact | null>(null);
  const [msgs, setMsgs] = useState<CustomerChatMessage[]>([]);
  const [q, setQ] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [selMode, setSelMode] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement | null>(null);

  const loadContacts = async () => { try { setContacts(await api.customerChat.contacts()); } catch { /* */ } };
  const loadMsgs = async (p: CustomerContact) => { try { setMsgs(await api.customerChat.messages(p.id)); } catch { /* */ } };
  useEffect(() => { void loadContacts(); const t = pollEvery(loadContacts, 6000); return () => stopPoll(t); }, []);
  useEffect(() => {
    if (!peer) return;
    void loadMsgs(peer);
    void api.customerChat.markRead(peer.id).then(() => onRead?.()).catch(() => undefined);
    const t = pollEvery(() => { if (peer) { void loadMsgs(peer); void loadContacts(); } }, 3500);
    return () => stopPoll(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peer?.id]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs]);
  useEffect(() => { if (!peer) return; const f = contacts.find((c) => c.id === peer.id); if (f && (f.online !== peer.online || f.last_seen_at !== peer.last_seen_at)) setPeer(f); /* eslint-disable-next-line */ }, [contacts]);

  const send = async () => {
    const body = text.trim();
    if (!body || !peer || busy) return;
    setBusy(true);
    try { await api.customerChat.send(peer.id, body); setText(''); await loadMsgs(peer); } catch { /* */ } finally { setBusy(false); }
  };
  const toggleMsg = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const delSelected = async () => {
    if (sel.size === 0) return;
    if (!(await confirmDialog({ message: `Eliminar ${sel.size} mensagem(ns)?`, danger: true }))) return;
    try { await api.customerChat.remove([...sel]); setSel(new Set()); setSelMode(false); if (peer) await loadMsgs(peer); } catch { /* */ }
  };

  const filtered = q.trim() ? contacts.filter((c) => `${c.name} ${c.email ?? ''} ${c.phone ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())) : contacts;

  const cvContacts = contacts.map((c) => ({ id: c.id, name: c.name, sub: [c.email, c.phone].filter(Boolean).join(' · ') || seenLabel(c), online: c.online, unread: c.unread }));
  const cvPeer = peer ? cvContacts.find((c) => c.id === peer.id) ?? { id: peer.id, name: peer.name, sub: '', online: peer.online, unread: 0 } : null;

  return (
    <ChatView
      title="Chat com clientes" subtitle="Clientes da loja online" emptyText="Sem clientes." searchPlaceholder="Procurar cliente…"
      contacts={cvContacts} search={q} onSearch={setQ}
      peer={cvPeer} peerStatus={peer ? `${[peer.email, peer.phone].filter(Boolean).join(' · ')}${peer.email || peer.phone ? ' · ' : ''}${seenLabel(peer)}` : ''}
      onOpen={(cv) => { const c = contacts.find((x) => x.id === cv.id); if (c) { setSelMode(false); setSel(new Set()); setPeer(c); } }}
      onBack={() => { setPeer(null); setSelMode(false); setSel(new Set()); }}
      msgs={msgs.map((m) => ({ id: m.id, mine: m.sender_type === 'STAFF', body: m.body, at: time(m.created_at), author: m.sender_name }))}
      selMode={selMode} sel={sel} onToggleSel={toggleMsg} onSelMode={(v) => { setSelMode(v); if (!v) setSel(new Set()); }} onDelete={() => void delSelected()}
      text={text} onText={setText} onSend={() => void send()} busy={busy} onClose={onClose}
    />
  );
}
