import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { StoreChatMessage } from '../api/types';
import { useCustomer } from '../store/customer';

const time = (s: string) => { try { return new Date(s).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

/**
 * Chat flutuante do cliente com a loja (livre, sem precisar de encomenda).
 * Só aparece quando o cliente está autenticado. Mostra se a loja está online.
 */
export function StoreChat({ code }: { code: string }) {
  const session = useCustomer(code);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<StoreChatMessage[]>([]);
  const [online, setOnline] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const token = session?.token;

  const load = async () => {
    if (!token) return;
    try { const r = await api.chatThread(code, token); setMsgs(r.messages); setOnline(r.staffOnline); } catch { /* */ }
  };
  useEffect(() => {
    if (!open || !token) return;
    void load();
    const t = window.setInterval(load, 4000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs]);

  if (!token) return null;

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try { await api.chatSend(code, token, body); setText(''); await load(); } catch { /* */ } finally { setBusy(false); }
  };

  return (
    <>
      <button className="store-chat-fab" onClick={() => setOpen((v) => !v)} aria-label="Falar com a loja" title="Falar com a loja">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
        </svg>
      </button>

      {open ? (
        <div className="store-chat">
          <div className="store-chat-head">
            <span className="store-chat-dot" style={{ background: online ? 'var(--success, #16a34a)' : '#9aa3b2' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>Falar com a loja</strong>
              <div className="muted" style={{ fontSize: 12 }}>{online ? 'A loja está online' : 'A loja está offline — respondemos em breve'}</div>
            </div>
            <button className="store-chat-x" onClick={() => setOpen(false)} aria-label="Fechar">✕</button>
          </div>
          <div ref={scroller} className="store-chat-body">
            {msgs.length === 0 ? (
              <div className="muted" style={{ margin: 'auto', textAlign: 'center', fontSize: 14, padding: 16 }}>Escreve a tua mensagem — a loja responde aqui.</div>
            ) : msgs.map((m) => {
              const mine = m.sender_type === 'CUSTOMER';
              return (
                <div key={m.id} className={`store-msg${mine ? ' mine' : ''}`}>
                  {!mine ? <div className="store-msg-from">{m.sender_name}</div> : null}
                  <div className="store-msg-b">{m.body}</div>
                  <div className="store-msg-t">{time(m.created_at)}</div>
                </div>
              );
            })}
          </div>
          <div className="store-chat-foot">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder="Escreve uma mensagem…" />
            <button className="btn" onClick={() => void send()} disabled={busy || !text.trim()}>Enviar</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
