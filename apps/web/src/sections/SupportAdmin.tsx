import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { AdminChat, SupportMsg } from '../api/types';
import { IconRefresh } from '../components/Icons';
import { MsgBody } from '../components/SupportChat';

const STATUS_LABEL: Record<string, string> = { BOT: 'Com o bot', HUMAN: '🔔 Aguarda equipa', CLOSED: 'Fechada' };

/** Suporte (Super Admin): conversas do site — o bot atende; as escaladas
 *  aparecem primeiro e o Super Admin responde aqui mesmo. */
export function SupportAdmin() {
  const [chats, setChats] = useState<AdminChat[]>([]);
  const [active, setActive] = useState<AdminChat | null>(null);
  const [msgs, setMsgs] = useState<SupportMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try { setChats(await api.support.admin.chats()); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar.'); }
  }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 15000); return () => window.clearInterval(t); }, [load]);

  const open = async (c: AdminChat) => {
    setActive(c);
    try {
      setMsgs(await api.support.admin.messages(c.id));
      await api.support.admin.read(c.id);
      void load();
      window.setTimeout(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }), 60);
    } catch { /* mantém lista */ }
  };

  const reply = async () => {
    const text = input.trim();
    if (!text || !active || busy) return;
    setBusy(true);
    try {
      await api.support.admin.reply(active.id, text);
      setInput('');
      setMsgs(await api.support.admin.messages(active.id));
      window.setTimeout(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }), 60);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao responder.'); }
    finally { setBusy(false); }
  };

  const close = async () => {
    if (!active || !window.confirm('Fechar esta conversa?')) return;
    await api.support.admin.close(active.id).catch(() => undefined);
    setActive(null); void load();
  };

  return (
    <>
      <div className="content-head">
        <h2>Suporte do site</h2>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => void load()}><IconRefresh size={15} /> Atualizar</button>
      </div>
      {error ? <div className="banner danger">{error}</div> : null}

      <div className="support-grid">
        {/* Lista de conversas */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {chats.length === 0 ? <div className="empty" style={{ padding: 30 }}><p>Sem conversas ainda.</p></div>
            : chats.map((c) => (
              <button key={c.id} className={`chat-row${active?.id === c.id ? ' on' : ''}`} onClick={() => void open(c)}>
                <span className="fb-avatar">{(c.visitor_name || 'V').slice(0, 1).toUpperCase()}</span>
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <strong style={{ fontSize: 14 }}>{c.visitor_name || 'Visitante'}</strong>
                    <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>{new Date(c.last_msg_at).toLocaleString('pt-PT')}</span>
                  </span>
                  <span className="muted" style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.last_body || '—'}
                  </span>
                  <span className="pill" style={{ marginTop: 4, display: 'inline-block', color: c.status === 'HUMAN' ? 'var(--warning)' : undefined }}>
                    {STATUS_LABEL[c.status] ?? c.status}
                  </span>
                </span>
                {c.unread_admin > 0 ? <span className="noti-badge">{c.unread_admin}</span> : null}
              </button>
            ))}
        </div>

        {/* Conversa */}
        <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column', minHeight: 420 }}>
          {!active ? (
            <div className="empty" style={{ margin: 'auto' }}><p>Escolhe uma conversa à esquerda.</p></div>
          ) : (
            <>
              <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', gap: 10 }}>
                <strong>{active.visitor_name || 'Visitante'}</strong>
                <span className="pill">{STATUS_LABEL[active.status] ?? active.status}</span>
                <span className="spacer" />
                <button className="btn sm ghost" onClick={() => void close()}>Fechar conversa</button>
              </div>
              <div ref={scroller} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg-2)' }}>
                {msgs.map((m) => (
                  <div key={m.id} className={`sc-msg ${m.sender === 'ADMIN' ? 'me' : m.sender === 'VISITOR' ? 'bot' : 'adm'}`}
                    style={{ alignSelf: m.sender === 'ADMIN' ? 'flex-end' : 'flex-start' }}>
                    <span className="sc-who" style={{ color: m.sender === 'ADMIN' ? '#fff' : undefined }}>
                      {m.sender === 'ADMIN' ? 'Eu (Super Admin)' : m.sender === 'BOT' ? 'Bot 🤖' : active.visitor_name || 'Visitante'}
                    </span>
                    <MsgBody body={m.body} />
                  </div>
                ))}
              </div>
              <div className="row" style={{ gap: 8, padding: 12, borderTop: '1px solid var(--border)' }}>
                <input
                  style={{ flex: 1, minWidth: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11, padding: '11px 13px', color: 'var(--text)', fontSize: 14 }}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void reply(); }}
                  placeholder="Responder ao visitante…"
                />
                <button className="btn" onClick={() => void reply()} disabled={busy || !input.trim()}>Enviar</button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
