import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { SupportMsg } from '../api/types';

const LS_CHAT = 'ndombaxi.support.chat';

/**
 * Chat de suporte flutuante (landing): balão no canto → conversa com o
 * assistente IA do sistema; se o bot não souber (ou o visitante pedir),
 * escala para o Super Admin, que responde na mesma conversa.
 */
export function SupportChat() {
  const [open, setOpen] = useState(false);
  const [chatId, setChatId] = useState<string | null>(() => {
    try { return localStorage.getItem(LS_CHAT); } catch { return null; }
  });
  const [msgs, setMsgs] = useState<SupportMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [human, setHuman] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);

  const scrollDown = () => {
    window.setTimeout(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }), 60);
  };

  // Abre/recupera a conversa quando o painel abre.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      try {
        if (chatId) {
          const m = await api.support.messages(chatId);
          if (alive) { setMsgs(m); scrollDown(); }
          return;
        }
        const r = await api.support.start();
        if (!alive) return;
        setChatId(r.chatId);
        try { localStorage.setItem(LS_CHAT, r.chatId); } catch { /* ignora */ }
        setMsgs([{ id: 'g', sender: 'BOT', body: r.greeting, created_at: new Date().toISOString() }]);
      } catch {
        if (alive) setMsgs([{ id: 'e', sender: 'BOT', body: 'Não consegui ligar ao suporte agora. Tenta novamente daqui a pouco.', created_at: new Date().toISOString() }]);
      }
    })();
    return () => { alive = false; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quando a conversa está com humanos, vai buscando respostas novas (polling).
  useEffect(() => {
    if (!open || !chatId || !human) return;
    const t = window.setInterval(async () => {
      try {
        const last = msgs[msgs.length - 1]?.created_at;
        const news = await api.support.messages(chatId, last);
        if (news.length) { setMsgs((p) => [...p, ...news.filter((n) => !p.some((x) => x.id === n.id))]); scrollDown(); }
      } catch { /* offline — tenta no próximo tick */ }
    }, 6000);
    return () => window.clearInterval(t);
  }, [open, chatId, human, msgs]);

  const send = async () => {
    const text = input.trim();
    if (!text || !chatId || busy) return;
    setInput('');
    setMsgs((p) => [...p, { id: `v${Date.now()}`, sender: 'VISITOR', body: text, created_at: new Date().toISOString() }]);
    scrollDown();
    setBusy(true);
    try {
      const r = await api.support.send(chatId, text);
      if (r.reply) setMsgs((p) => [...p, { id: `b${Date.now()}`, sender: 'BOT', body: r.reply, created_at: new Date().toISOString() }]);
      if (r.escalated) setHuman(true);
      scrollDown();
    } catch {
      setMsgs((p) => [...p, { id: `e${Date.now()}`, sender: 'BOT', body: 'Falha ao enviar. Verifica a internet e tenta de novo.', created_at: new Date().toISOString() }]);
    } finally { setBusy(false); }
  };

  return (
    <>
      {/* Balão flutuante */}
      <button className={`sc-fab${open ? ' on' : ''}`} onClick={() => setOpen((v) => !v)} aria-label="Falar connosco">
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        )}
      </button>

      {open ? (
        <div className="sc-panel">
          <div className="sc-head">
            <span className="sc-dot" />
            <div>
              <div className="sc-title">Assistente Ndombaxi</div>
              <div className="sc-sub">{human ? 'Equipa chamada — respondemos aqui' : 'Responde na hora · IA'}</div>
            </div>
          </div>
          <div className="sc-body" ref={scroller}>
            {msgs.map((m) => (
              <div key={m.id} className={`sc-msg ${m.sender === 'VISITOR' ? 'me' : m.sender === 'ADMIN' ? 'adm' : 'bot'}`}>
                {m.sender === 'ADMIN' ? <span className="sc-who">Equipa Ndombaxi</span> : null}
                {m.body}
              </div>
            ))}
            {busy ? <div className="sc-msg bot sc-typing">a escrever…</div> : null}
          </div>
          <div className="sc-foot">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
              placeholder="Escreve a tua pergunta…"
            />
            <button onClick={() => void send()} disabled={busy || !input.trim()} aria-label="Enviar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></svg>
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
