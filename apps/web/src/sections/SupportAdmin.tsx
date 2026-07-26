import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { AdminChat, SupportMsg } from '../api/types';
import { confirmDialog, toast } from '../components/feedback';
import { IconRefresh } from '../components/Icons';
import { MsgBody } from '../components/SupportChat';

const STATUS_LABEL: Record<string, string> = { BOT: 'Com o bot', HUMAN: 'Aguarda equipa', CLOSED: 'Fechada' };

/** "há 5 min", "ontem", "10/06" — estilo Messenger. */
function ago(iso: string): string {
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 172800) return 'ontem';
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
}

/**
 * Suporte do site (Super Admin) — LÓGICA MESSENGER:
 *   • ecrã 1: SÓ a lista de conversas (não se mistura com nenhuma aberta);
 *   • tocar numa conversa → abre o ECRÃ PRÓPRIO do chat (com ← voltar);
 *   • 100% responsivo (telemóvel → desktop).
 */
export function SupportAdmin() {
  const [chats, setChats] = useState<AdminChat[]>([]);
  const [active, setActive] = useState<AdminChat | null>(null);
  const [msgs, setMsgs] = useState<SupportMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<AdminChat | null>(null);
  activeRef.current = active;

  const load = useCallback(async () => {
    try { setChats(await api.support.admin.chats()); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar.'); }
  }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 15000); return () => window.clearInterval(t); }, [load]);

  const scrollDown = (smooth = false) =>
    window.setTimeout(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }), 60);

  const open = async (c: AdminChat) => {
    setActive(c);
    setMsgs([]);
    try {
      setMsgs(await api.support.admin.messages(c.id));
      await api.support.admin.read(c.id);
      void load();
      scrollDown();
    } catch { /* mantém a lista */ }
  };

  // Dentro do chat: vai buscando mensagens novas do visitante (polling).
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(async () => {
      const cur = activeRef.current;
      if (!cur) return;
      try {
        const all = await api.support.admin.messages(cur.id);
        setMsgs((prev) => (all.length !== prev.length ? (scrollDown(true), all) : prev));
      } catch { /* offline */ }
    }, 6000);
    return () => window.clearInterval(t);
  }, [active]);

  const reply = async () => {
    const text = input.trim();
    if (!text || !active || busy) return;
    setBusy(true);
    try {
      await api.support.admin.reply(active.id, text);
      setInput('');
      setMsgs(await api.support.admin.messages(active.id));
      scrollDown(true);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao responder.'); }
    finally { setBusy(false); }
  };

  const close = async () => {
    if (!active || !(await confirmDialog({ message: 'Fechar esta conversa?' }))) return;
    await api.support.admin.close(active.id).catch(() => undefined);
    toast.success('Conversa fechada.');
    setActive(null); void load();
  };

  // ── ECRÃ 2: página própria do chat (estilo Messenger) ────────
  if (active) {
    return (
      <div className="msgr-chat">
        <div className="msgr-chat-head">
          <button className="msgr-back" onClick={() => { setActive(null); void load(); }} aria-label="Voltar às conversas">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span className="fb-avatar">{(active.visitor_name || 'V').slice(0, 1).toUpperCase()}</span>
          <div className="msgr-chat-who">
            <strong>{active.visitor_name || 'Visitante'}</strong>
            <span className={`msgr-status${active.status === 'HUMAN' ? ' hot' : ''}`}>{STATUS_LABEL[active.status] ?? active.status}</span>
          </div>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => void close()}>Fechar conversa</button>
        </div>
        <div ref={scroller} className="msgr-chat-body">
          {msgs.length === 0 ? <div className="empty" style={{ margin: 'auto' }}><p>A carregar…</p></div> : null}
          {msgs.map((m) => (
            <div key={m.id} className={`sc-msg ${m.sender === 'ADMIN' ? 'me' : m.sender === 'VISITOR' ? 'bot' : 'adm'}`}
              style={{ alignSelf: m.sender === 'ADMIN' ? 'flex-end' : 'flex-start' }}>
              <span className="sc-who" style={{ color: m.sender === 'ADMIN' ? '#fff' : undefined }}>
                {m.sender === 'ADMIN' ? 'Eu (Super Admin)' : m.sender === 'BOT' ? 'Bot 🤖' : active.visitor_name || 'Visitante'}
              </span>
              <MsgBody body={m.body} sender={m.sender} />
            </div>
          ))}
        </div>
        <div className="msgr-chat-foot">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void reply(); }}
            placeholder="Responder ao visitante…"
          />
          <button className="btn" onClick={() => void reply()} disabled={busy || !input.trim()} aria-label="Enviar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
          </button>
        </div>
      </div>
    );
  }

  // ── ECRÃ 1: lista de conversas (só a lista) ──────────────────
  return (
    <>
      <div className="content-head">
        <h2>Suporte do site</h2>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => void load()}><IconRefresh size={15} /> Atualizar</button>
      </div>
      {error ? <div className="banner danger">{error}</div> : null}

      <div className="card msgr-list">
        {chats.length === 0 ? <div className="empty" style={{ padding: 30 }}><p>Sem conversas ainda.</p></div>
          : chats.map((c) => (
            <button key={c.id} className="msgr-row" onClick={() => void open(c)}>
              <span className={`fb-avatar${c.status === 'HUMAN' ? ' hot' : ''}`}>{(c.visitor_name || 'V').slice(0, 1).toUpperCase()}</span>
              <span className="msgr-row-main">
                <span className="msgr-row-top">
                  <strong className={c.unread_admin > 0 ? 'unread' : ''}>{c.visitor_name || 'Visitante'}</strong>
                  <span className="msgr-when">{ago(c.last_msg_at)}</span>
                </span>
                <span className={`msgr-snippet${c.unread_admin > 0 ? ' unread' : ''}`}>
                  {c.status === 'HUMAN' ? '🔔 ' : ''}{(c.last_body || '—').replace(/\[\[SVG\]\][\s\S]*$/, ' 📷')}
                </span>
              </span>
              {c.unread_admin > 0 ? <span className="noti-badge inline">{c.unread_admin}</span> : null}
            </button>
          ))}
      </div>
    </>
  );
}
