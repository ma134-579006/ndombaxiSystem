import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { SupportMsg } from '../api/types';

const LS_CHAT = 'ndombaxi.support.chat';
const LS_MSGS = 'ndombaxi.support.msgs';
const LS_HUMAN = 'ndombaxi.support.human';

/** PRIVACIDADE: o servidor não guarda conversas do bot — o histórico vive
 *  apenas aqui, no navegador do visitante. */
function loadLocalMsgs(): SupportMsg[] {
  try {
    const raw = localStorage.getItem(LS_MSGS);
    const arr = raw ? (JSON.parse(raw) as SupportMsg[]) : [];
    return Array.isArray(arr) ? arr.slice(-120) : [];
  } catch { return []; }
}
function saveLocalMsgs(msgs: SupportMsg[]) {
  try { localStorage.setItem(LS_MSGS, JSON.stringify(msgs.slice(-120))); } catch { /* ignora */ }
}

/** O corpo pode trazer um guia visual: texto + [[SVG]]…[[/SVG]].
 *  O conteúdo é um SCREENSHOT REAL do sistema com marcações (URL /guides/…)
 *  ou, em versões antigas, um SVG inline (vem da NOSSA API — fonte confiável). */
export function MsgBody({ body }: { body: string }) {
  const m = body.match(/^([\s\S]*?)\[\[SVG\]\]([\s\S]*?)\[\[\/SVG\]\]/);
  if (!m) return <>{body}</>;
  const guide = m[2].trim();
  return (
    <>
      {m[1].trim()}
      {guide.startsWith('/guides/') ? (
        <span className="sc-img"><img src={guide} alt="Guia visual do sistema" loading="lazy" /></span>
      ) : guide.startsWith('<svg') ? (
        <span className="sc-img" dangerouslySetInnerHTML={{ __html: guide }} />
      ) : null}
    </>
  );
}

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
  const [msgs, setMsgsRaw] = useState<SupportMsg[]>(() => loadLocalMsgs());
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [human, setHuman] = useState(() => {
    try { return localStorage.getItem(LS_HUMAN) === '1'; } catch { return false; }
  });
  const scroller = useRef<HTMLDivElement | null>(null);

  // Guarda o histórico SEMPRE no navegador (o servidor não o guarda).
  const setMsgs = (updater: React.SetStateAction<SupportMsg[]>) => {
    setMsgsRaw((prev) => {
      const next = typeof updater === 'function' ? (updater as (p: SupportMsg[]) => SupportMsg[])(prev) : updater;
      saveLocalMsgs(next);
      return next;
    });
  };

  const markHuman = () => {
    setHuman(true);
    try { localStorage.setItem(LS_HUMAN, '1'); } catch { /* ignora */ }
  };

  const scrollDown = () => {
    window.setTimeout(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }), 60);
  };

  // Abre/recupera a conversa quando o painel abre (histórico vem do navegador).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      if (chatId) { scrollDown(); return; }
      try {
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

  // Quando a conversa está com humanos, vai buscando respostas da EQUIPA (polling).
  useEffect(() => {
    if (!open || !chatId || !human) return;
    const t = window.setInterval(async () => {
      try {
        const last = msgs[msgs.length - 1]?.created_at;
        const news = (await api.support.messages(chatId, last)).filter((n) => n.sender === 'ADMIN');
        if (news.length) { setMsgs((p) => [...p, ...news.filter((n) => !p.some((x) => x.id === n.id))]); scrollDown(); }
      } catch { /* offline — tenta no próximo tick */ }
    }, 6000);
    return () => window.clearInterval(t);
  }, [open, chatId, human, msgs]);

  const send = async () => {
    const text = input.trim();
    if (!text || !chatId || busy) return;
    setInput('');
    // Contexto para a IA: últimos turnos guardados APENAS no navegador.
    const history = msgs
      .filter((m) => m.sender === 'VISITOR' || m.sender === 'BOT')
      .slice(-10)
      .map((m) => ({
        role: m.sender === 'VISITOR' ? ('user' as const) : ('assistant' as const),
        content: m.body.replace(/\[\[SVG\]\][\s\S]*?\[\[\/SVG\]\]/g, '').trim().slice(0, 600),
      }))
      .filter((t) => t.content.length > 0);
    setMsgs((p) => [...p, { id: `v${Date.now()}`, sender: 'VISITOR', body: text, created_at: new Date().toISOString() }]);
    scrollDown();
    setBusy(true);
    try {
      const r = await api.support.send(chatId, text, history);
      if (r.reply) {
        const body = r.imageSvg ? `${r.reply}\n[[SVG]]${r.imageSvg}[[/SVG]]` : r.reply;
        setMsgs((p) => [...p, { id: `b${Date.now()}`, sender: 'BOT', body, created_at: new Date().toISOString() }]);
      } else if (r.escalated && !human) {
        // 1.ª vez em modo humano: explica o silêncio do bot (a equipa responde aqui).
        setMsgs((p) => [...p, { id: `h${Date.now()}`, sender: 'BOT', body: '✅ A nossa equipa foi chamada e vai responder aqui mesmo. Se preferires voltar ao assistente automático, toca em ⟳ (nova conversa) no topo.', created_at: new Date().toISOString() }]);
      }
      if (r.escalated) markHuman();
      scrollDown();
    } catch {
      setMsgs((p) => [...p, { id: `e${Date.now()}`, sender: 'BOT', body: 'Falha ao enviar. Verifica a internet e tenta de novo.', created_at: new Date().toISOString() }]);
    } finally { setBusy(false); }
  };

  /** Recomeça do zero: novo chat com o BOT (sai do modo humano). */
  const resetChat = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setHuman(false);
      try { localStorage.removeItem(LS_HUMAN); localStorage.removeItem(LS_CHAT); localStorage.removeItem(LS_MSGS); } catch { /* ignora */ }
      const r = await api.support.start();
      setChatId(r.chatId);
      try { localStorage.setItem(LS_CHAT, r.chatId); } catch { /* ignora */ }
      setMsgs([{ id: 'g', sender: 'BOT', body: r.greeting, created_at: new Date().toISOString() }]);
      scrollDown();
    } catch {
      setMsgs([{ id: 'e', sender: 'BOT', body: 'Não consegui ligar ao suporte agora. Tenta novamente daqui a pouco.', created_at: new Date().toISOString() }]);
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
            <button className="sc-reset" onClick={() => void resetChat()} title="Nova conversa (volta ao assistente)" aria-label="Nova conversa">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
            </button>
          </div>
          <div className="sc-body" ref={scroller}>
            {msgs.map((m) => (
              <div key={m.id} className={`sc-msg ${m.sender === 'VISITOR' ? 'me' : m.sender === 'ADMIN' ? 'adm' : 'bot'}`}>
                {m.sender === 'ADMIN' ? <span className="sc-who">Equipa Ndombaxi</span> : null}
                <MsgBody body={m.body} />
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
