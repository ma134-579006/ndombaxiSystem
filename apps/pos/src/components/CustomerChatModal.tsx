import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { CustomerChatMessage, CustomerContact } from '../api/types';
import { Button, Dialog, EmptyState } from '@nexus/ui';

const time = (s: string) => { try { return new Date(s).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const seenLabel = (c: { online: boolean; last_seen_at: string | null }) => {
  if (c.online) return 'online';
  if (!c.last_seen_at) return 'offline';
  const m = Math.round((Date.now() - new Date(c.last_seen_at).getTime()) / 60000);
  if (m < 1) return 'visto agora'; if (m < 60) return `visto há ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `visto há ${h} h`;
  return `visto há ${Math.round(h / 24)} d`;
};

/** Chat do caixa com os CLIENTES da loja (livre). Presença + selecionar/eliminar. */
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

  const loadContacts = async () => { try { setContacts(await api.custChatContacts()); } catch { /* */ } };
  const loadMsgs = async (p: CustomerContact) => { try { setMsgs(await api.custChatMessages(p.id)); } catch { /* */ } };
  useEffect(() => { void loadContacts(); const t = window.setInterval(loadContacts, 6000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    if (!peer) return;
    void loadMsgs(peer);
    void api.custChatMarkRead(peer.id).then(() => onRead?.()).catch(() => undefined);
    const t = window.setInterval(() => { if (peer) { void loadMsgs(peer); void loadContacts(); } }, 3500);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peer?.id]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs]);
  useEffect(() => { if (!peer) return; const f = contacts.find((c) => c.id === peer.id); if (f && (f.online !== peer.online || f.last_seen_at !== peer.last_seen_at)) setPeer(f); /* eslint-disable-next-line */ }, [contacts]);

  const send = async () => {
    const body = text.trim();
    if (!body || !peer || busy) return;
    setBusy(true);
    try { await api.custChatSend(peer.id, body); setText(''); await loadMsgs(peer); } catch { /* */ } finally { setBusy(false); }
  };
  const toggleMsg = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const delSelected = async () => {
    if (sel.size === 0) return;
    if (!window.confirm(`Eliminar ${sel.size} mensagem(ns)?`)) return;
    try { await api.custChatDelete([...sel]); setSel(new Set()); setSelMode(false); if (peer) await loadMsgs(peer); } catch { /* */ }
  };
  const filtered = q.trim() ? contacts.filter((c) => `${c.name} ${c.email ?? ''} ${c.phone ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())) : contacts;

  return (
    <>
        {!peer ? (
          <Dialog open onClose={onClose} title="🛍️ Chat com clientes" size="sm" flush>
            <div className="chat-search">
              <div className="chat-search-box">
                <span aria-hidden style={{ opacity: .7 }}>🔎</span>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar cliente…" aria-label="Procurar cliente" />
              </div>
            </div>
            <div aria-live="polite">
              {filtered.length === 0 ? (
                <EmptyState title="Sem clientes" text="Ainda não há conversas com clientes da loja online." />
              ) : filtered.map((c) => (
                <button key={c.id} className="chat-contact" onClick={() => { setSelMode(false); setSel(new Set()); setPeer(c); }}>
                  <span className="chat-avatar">
                    {c.name.slice(0, 1).toUpperCase()}
                    <span className={`chat-dot${c.online ? ' on' : ''}`} aria-hidden="true" />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong className="nx-body-sm">{c.name}</strong>
                    <div className="nx-caption sub">{[c.email, c.phone].filter(Boolean).join(' · ') || 'cliente'} · {seenLabel(c)}</div>
                  </div>
                  {c.unread > 0 ? (
                    <span className="chat-unread" aria-label={`${c.unread} por ler`}>{c.unread > 99 ? '99+' : c.unread}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </Dialog>
        ) : (
          <Dialog
            open
            onClose={onClose}
            title={peer.name}
            description={`${[peer.email, peer.phone].filter(Boolean).join(' · ')} · ${seenLabel(peer)}`}
            size="sm"
            flush
            headerActions={
              selMode ? (
                <>
                  <Button variant="danger" size="sm" onClick={() => void delSelected()} disabled={sel.size === 0}>
                    Eliminar ({sel.size})
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setSelMode(false); setSel(new Set()); }}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" size="sm" aria-label="Voltar aos clientes" onClick={() => { setPeer(null); setSelMode(false); setSel(new Set()); }}>
                    ←
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelMode(true)} disabled={msgs.length === 0}>
                    Selecionar
                  </Button>
                </>
              )
            }
            footer={
              <div className="chat-compose">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  placeholder={`Mensagem para ${peer.name}…`}
                  aria-label={`Mensagem para ${peer.name}`}
                  rows={1}
                />
                <Button variant="primary" onClick={() => void send()} loading={busy} disabled={!text.trim()}>
                  Enviar
                </Button>
              </div>
            }
          >
            <div ref={scroller} className="chat-scroller" aria-live="polite">
              {msgs.length === 0 ? (
                <EmptyState title="Sem mensagens" text="Escreve a primeira." />
              ) : msgs.map((m) => {
                const mine = m.sender_type === 'STAFF';
                const checked = sel.has(m.id);
                return (
                  <div
                    key={m.id}
                    className={`chat-msg${mine ? ' mine' : ''}${selMode ? ' pick' : ''}`}
                    onClick={() => selMode && toggleMsg(m.id)}
                  >
                    {selMode ? <input type="checkbox" checked={checked} readOnly aria-label="Selecionar mensagem" /> : null}
                    <div className={`chat-bubble${checked ? ' sel' : ''}`}>
                      {!mine ? <div className="from">{m.sender_name}</div> : null}
                      <div className="body">{m.body}</div>
                      <div className="at">{time(m.created_at)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Dialog>
        )}
    </>
  );
}
