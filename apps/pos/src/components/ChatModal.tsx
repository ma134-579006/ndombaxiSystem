import React, { useEffect, useRef, useState } from 'react';
import { Button, Dialog, EmptyState } from '@nexus/ui';
import { api } from '../api/client';
import type { ChatContact, ChatMessage } from '../api/types';

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

  const q = search.trim().toLowerCase();
  const shownContacts = q
    ? contacts.filter((c) => c.name.toLowerCase().includes(q) || (ROLE_LABEL[c.role] ?? c.role).toLowerCase().includes(q))
    : contacts;

  /* ── Lista de contactos ───────────────────────────────── */
  if (!peer) {
    return (
      <Dialog open onClose={onClose} title="💬 Chat com o gerente" size="sm" flush>
        <div className="chat-search">
          <div className="chat-search-box">
            <span aria-hidden style={{ opacity: .7 }}>🔎</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar por nome…"
              aria-label="Pesquisar contacto"
            />
            {search ? (
              <button onClick={() => setSearch('')} aria-label="Limpar procura" className="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon">✕</button>
            ) : null}
          </div>
        </div>

        <div aria-live="polite">
          {shownContacts.length === 0 ? (
            <EmptyState
              title={contacts.length === 0 ? 'Sem ninguém para conversar' : 'Ninguém com esse nome'}
              text={contacts.length === 0 ? 'Assim que o gestor entrar, aparece aqui.' : 'Tente outro nome ou função.'}
            />
          ) : shownContacts.map((c) => (
            <button key={c.id} className="chat-contact" onClick={() => { setSelMode(false); setSel(new Set()); setPeer(c); }}>
              <span className="chat-avatar">
                {c.name.slice(0, 1).toUpperCase()}
                {/* A presença é dita por texto ("online", "visto há 5 min")
                    além do ponto verde — o ponto sozinho não chega. */}
                <span className={`chat-dot${c.online ? ' on' : ''}`} aria-hidden="true" />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong className="nx-body-sm">{c.name}</strong>
                <div className="nx-caption">{ROLE_LABEL[c.role] ?? c.role} · {seenLabel(c)}</div>
              </div>
              {c.unread > 0 ? (
                <span className="chat-unread" aria-label={`${c.unread} por ler`}>{c.unread > 99 ? '99+' : c.unread}</span>
              ) : null}
            </button>
          ))}
        </div>
      </Dialog>
    );
  }

  /* ── Conversa ─────────────────────────────────────────── */
  return (
    <Dialog
      open
      onClose={onClose}
      title={peer.name}
      description={`${ROLE_LABEL[peer.role] ?? peer.role} · ${seenLabel(peer)}`}
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
            <Button variant="ghost" size="sm" aria-label="Voltar aos contactos" onClick={() => { setPeer(null); setSelMode(false); setSel(new Set()); }}>
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
      {/* `aria-live` para as mensagens que chegam de 3 em 3 s serem anunciadas. */}
      <div ref={scroller} className="chat-scroller" aria-live="polite">
        {msgs.length === 0 ? (
          <EmptyState title="Sem mensagens" text="Escreve a primeira." />
        ) : msgs.map((m) => {
          const mine = !!meId && m.sender_id === meId;
          const checked = sel.has(m.id);
          return (
            <div
              key={m.id}
              className={`chat-msg${mine ? ' mine' : ''}${selMode ? ' pick' : ''}`}
              onClick={() => selMode && toggleMsg(m.id)}
            >
              {selMode ? <input type="checkbox" checked={checked} readOnly aria-label="Selecionar mensagem" /> : null}
              <div className={`chat-bubble${checked ? ' sel' : ''}`}>
                <div className="body">{m.body}</div>
                <div className="at">{time(m.created_at)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
