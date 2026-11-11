import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { SupportMsg } from '../api/types';
import { pollEvery, stopPoll } from '../poll';
import { LOGO_ROUND, LOGO_WIDE } from '../brand';
import '../helpdesk.css';

/** Perguntas rápidas (lista "Perguntas frequentes" da gaveta e atalhos do chat). */
const QUICK = ['Quanto custa?', 'Funciona com a AGT?', 'Como começar?'];

const Ico = {
  close: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>,
  search: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>,
  chat: <svg width="40" height="34" viewBox="0 0 40 34" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden><path d="M3 4.5A2.5 2.5 0 0 1 5.5 2h18A2.5 2.5 0 0 1 26 4.5v11a2.5 2.5 0 0 1-2.5 2.5H12l-6 5v-5h-.5A2.5 2.5 0 0 1 3 15.5z" /><path d="M14 22h12l6 5v-5h.5a2.5 2.5 0 0 0 2.5-2.5v-9A2.5 2.5 0 0 0 32.5 8H30" /><path d="M9 8h11M9 12h7" strokeLinecap="round" /></svg>,
  phone: <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /><path d="M15 3a7 7 0 0 1 6 6M15 6.5A3.5 3.5 0 0 1 17.5 9" /></svg>,
  mail: <svg width="38" height="30" viewBox="0 0 38 30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden><rect x="2" y="2" width="34" height="26" rx="2" /><path d="m2.5 3 16.5 14L35.5 3M2.5 27.5 14 14M35.5 27.5 24 14" /></svg>,
  help: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.6-3 4.5M12 17.5h.01" /></svg>,
  ok: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="10" /><path d="m8 12.5 2.6 2.5L16 9.5" /></svg>,
  team: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20a6.5 6.5 0 0 0-4-6" /></svg>,
  back: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18 9 12l6-6" /></svg>,
  reset: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>,
  home: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden><path d="M3.5 10.2 12 4l8.5 6.2V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19z" /><path d="M8.5 14.5c1 1 2.2 1.5 3.5 1.5s2.5-.5 3.5-1.5" strokeLinecap="round" /></svg>,
  msgs: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden><path d="M4 4.5h16v12H9.5L5 20v-3.5H4z" /><path d="M8 9h8M8 12.5h5" strokeLinecap="round" /></svg>,
  chev: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>,
  sendFill: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M3.4 20.4 21 12 3.4 3.6l.1 6.5L15 12 3.5 13.9z" /></svg>,
  up: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg>,
  send: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></svg>,
};

/** `/guides/…` relativo à base do build (nas apps o módulo é servido de subpasta). */
const assetUrl = (p: string) => `${import.meta.env.BASE_URL || '/'}${p.replace(/^\//, '')}`;

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

/** LIGHTBOX: clica no guia visual → abre maximizado por cima de tudo
 *  (fundo escuro, fecha com clique, ✕ ou tecla Esc). */
function GuideLightbox({ src, onClose }: { src: string; onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="sc-lightbox" onClick={onClose} role="dialog" aria-label="Guia visual ampliado">
      <button className="sc-lightbox-x" onClick={onClose} aria-label="Fechar">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
      <img src={src} alt="Guia visual do sistema (ampliado)" onClick={(e) => e.stopPropagation()} />
      <div className="sc-lightbox-hint">Toca fora da imagem para fechar</div>
    </div>
  );
}

/** O corpo pode trazer um guia visual: texto + [[SVG]]…[[/SVG]].
 *  O conteúdo é um SCREENSHOT REAL do sistema com marcações (URL /guides/…)
 *  ou, em versões antigas, um SVG inline (vem da NOSSA API — fonte confiável). */
export function MsgBody({ body, sender }: { body: string; sender?: string }) {
  const [zoom, setZoom] = useState(false);
  const m = body.match(/^([\s\S]*?)\[\[SVG\]\]([\s\S]*?)\[\[\/SVG\]\]/);
  if (!m) return <>{body}</>;
  const guide = m[2].trim();
  return (
    <>
      {m[1].trim()}
      {guide.startsWith('/guides/') ? (
        <>
          <span className="sc-img zoomable" onClick={() => setZoom(true)} title="Toca para ampliar">
            <img src={assetUrl(guide)} alt="Guia visual do sistema" loading="lazy" />
            <span className="sc-img-zoom" aria-hidden>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3M11 8v6M8 11h6" /></svg>
            </span>
          </span>
          {zoom ? <GuideLightbox src={assetUrl(guide)} onClose={() => setZoom(false)} /> : null}
        </>
      ) : guide.startsWith('<svg') && sender === 'BOT' ? (
        // SEGURANÇA: o SVG inline só é injetado para mensagens do BOT — o guia
        // gerado pela NOSSA IA (`imageSvg` da API), a única fonte confiável. Uma
        // mensagem de VISITANTE (não autenticado) com `[[SVG]]<svg onload=…>` é
        // guardada crua e vista pelo Super Admin; sem esta guarda, executaria no
        // browser dele (XSS armazenado → escalada de privilégio). Conteúdo não-BOT
        // nunca chega ao `dangerouslySetInnerHTML`.
        <span className="sc-img" dangerouslySetInnerHTML={{ __html: guide }} />
      ) : null}
    </>
  );
}

/**
 * Botão flutuante de mensagens (landing, gestão e super admin): círculo azul
 * com balão cheio e sorriso, no estilo do lançador do sistema de referência.
 */
export function SupportFab({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button className="sc-fab" onClick={onClick} aria-label={label} title={label}>
      <svg className="sc-fab-ic" width="24" height="27" viewBox="0 0 28 32" aria-hidden="true">
        <path fill="currentColor" d="M4 0h20a4 4 0 0 1 4 4v18.6L28 32l-8.6-3.4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z" />
        <path className="sc-fab-smile" fill="none" strokeWidth="2.2" strokeLinecap="round" d="M6.2 19.4c1.9 1.7 4.6 2.8 7.8 2.8s5.9-1.1 7.8-2.8" />
      </svg>
    </button>
  );
}

/**
 * Ajuda / chat de suporte (landing e gestão) no formato do mensageiro do
 * sistema de referência: o lançador abre um cartão flutuante por cima dele com
 * as abas Início (saudação, "Envie-nos uma mensagem", "Procure ajuda"),
 * Mensagens (conversa) e Ajuda (pesquisa + perguntas frequentes). A conversa é
 * com o assistente IA; se o bot não souber (ou o visitante pedir), escala para
 * o Super Admin, que responde na mesma conversa.
 */
export function SupportChat() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [view, setView] = useState<'home' | 'chat' | 'help'>('home');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [contacts, setContacts] = useState<{ email: string | null; phone: string | null }>({ email: null, phone: null });
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

  const close = () => {
    setClosing(true);
    window.setTimeout(() => { setOpen(false); setClosing(false); setView('home'); }, 200);
  };

  // Esc fecha a gaveta (ou volta da conversa para a Ajuda).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.sc-lightbox')) return;
      if (view !== 'home') setView('home'); else close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // Contactos públicos da plataforma (Telefone / E-mail só aparecem se existirem).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api.publicLanding()
      .then((l) => { if (alive) setContacts({ email: l.contactEmail || null, phone: l.contactPhone || null }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [open]);

  // Abre/recupera a conversa quando se entra no Chat (histórico vem do navegador).
  useEffect(() => {
    if (!open || view !== 'chat') return;
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
  }, [open, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quando a conversa está com humanos, vai buscando respostas da EQUIPA (polling).
  useEffect(() => {
    if (!open || !chatId || !human) return;
    const t = pollEvery(async () => {
      try {
        const last = msgs[msgs.length - 1]?.created_at;
        const news = (await api.support.messages(chatId, last)).filter((n) => n.sender === 'ADMIN');
        if (news.length) { setMsgs((p) => [...p, ...news.filter((n) => !p.some((x) => x.id === n.id))]); scrollDown(); }
      } catch { /* offline — tenta no próximo tick */ }
    }, 6000);
    return () => stopPoll(t);
  }, [open, chatId, human, msgs]);

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
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
        setMsgs((p) => [...p, { id: `h${Date.now()}`, sender: 'BOT', body: 'A nossa equipa foi chamada e vai responder aqui mesmo. Se preferires voltar ao assistente automático, toca em ⟳ (nova conversa) no topo.', created_at: new Date().toISOString() }]);
      }
      if (r.escalated) markHuman();
      scrollDown();
    } catch {
      setMsgs((p) => [...p, { id: `e${Date.now()}`, sender: 'BOT', body: 'Falha ao enviar. Verifica a internet e tenta de novo.', created_at: new Date().toISOString() }]);
    } finally { setBusy(false); }
  };

  // Pergunta escolhida na Ajuda (pesquisa ou pergunta frequente): envia assim
  // que a conversa estiver pronta.
  useEffect(() => {
    if (view !== 'chat' || !pending || !chatId || busy) return;
    const q = pending; setPending(null);
    void send(q);
  }, [view, pending, chatId, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const openChat = (question?: string) => {
    if (question && question.trim()) setPending(question.trim());
    setQuery('');
    setView('chat');
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

  const q = query.trim().toLowerCase();
  const questions = q ? QUICK.filter((x) => x.toLowerCase().includes(q)) : QUICK;
  const subtitle = human ? 'Equipa chamada — respondemos aqui' : 'A equipa também pode ajudar';
  const toggle = () => { if (open) close(); else { setView('home'); setOpen(true); } };

  const tabs = (
    <nav className="hd-tabs" aria-label="Ajuda">
      <button type="button" className={view === 'home' ? 'on' : ''} onClick={() => setView('home')}>{Ico.home}<span>Início</span></button>
      <button type="button" onClick={() => openChat()}>{Ico.msgs}<span>Mensagens</span></button>
      <button type="button" className={view === 'help' ? 'on' : ''} onClick={() => setView('help')}>{Ico.help}<span>Ajuda</span></button>
    </nav>
  );

  return (
    <>
      {/* Lançador: fica sempre visível; aberto mostra a seta para baixo (fecha). */}
      <button className={`sc-fab${open && !closing ? ' on' : ''}`} onClick={toggle} aria-label={open ? 'Fechar' : 'Falar connosco'} aria-expanded={open}>
        <svg className="sc-fab-ic sc-fab-open" width="24" height="27" viewBox="0 0 28 32" aria-hidden="true">
          <path fill="currentColor" d="M4 0h20a4 4 0 0 1 4 4v18.6L28 32l-8.6-3.4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z" />
          <path className="sc-fab-smile" fill="none" strokeWidth="2.2" strokeLinecap="round" d="M6.2 19.4c1.9 1.7 4.6 2.8 7.8 2.8s5.9-1.1 7.8-2.8" />
        </svg>
        <svg className="sc-fab-ic sc-fab-min" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M18.6 8.4a.85.85 0 0 0-1.2 0L12 13.8 6.6 8.4a.85.85 0 1 0-1.2 1.2l6 6a.85.85 0 0 0 1.2 0l6-6a.85.85 0 0 0 0-1.2z" />
        </svg>
      </button>

      {open ? (
        <section className={`hd-msgr${closing ? ' out' : ''}`} role="dialog" aria-label="Ajuda">
          {view === 'home' ? (
            <div className="hd-view hd-home" key="home">
              <div className="hd-scroll">
                <div className="hd-home-top">
                  <img className="hd-logo" src={LOGO_WIDE} alt="LPS Vendas" />
                  <button type="button" className="hd-x" onClick={close} aria-label="Fechar">{Ico.close}</button>
                </div>
                <h2 className="hd-hello">Olá <span aria-hidden>👋</span><br />Como podemos ajudar?</h2>
                <div className="hd-cards">
                  <button type="button" className="hd-card" onClick={() => openChat()}>
                    <span>Envie-nos uma mensagem</span><i className="hd-card-ic">{Ico.sendFill}</i>
                  </button>
                  <button type="button" className="hd-card" onClick={() => setView('help')}>
                    <span>Procure ajuda</span><i className="hd-card-ic">{Ico.search}</i>
                  </button>
                  {contacts.phone || contacts.email ? (
                    <div className="hd-card hd-contacts">
                      {contacts.phone ? <a href={`tel:${contacts.phone.replace(/\s+/g, '')}`}>{Ico.phone}<span>{contacts.phone}</span></a> : null}
                      {contacts.email ? <a href={`mailto:${contacts.email}`}>{Ico.mail}<span>{contacts.email}</span></a> : null}
                    </div>
                  ) : null}
                </div>
              </div>
              {tabs}
            </div>
          ) : view === 'help' ? (
            <div className="hd-view hd-help" key="help">
              <div className="hd-bar">
                <span className="hd-bar-title">Ajuda</span>
                <button type="button" className="hd-x" onClick={close} aria-label="Fechar">{Ico.close}</button>
              </div>
              <div className="hd-searchwrap">
                <label className="hd-search">
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Procure ajuda"
                    onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) openChat(query); }} />
                  {Ico.search}
                </label>
              </div>
              <div className="hd-scroll hd-list">
                {questions.map((x) => (
                  <button key={x} type="button" className="hd-item" onClick={() => openChat(x)}>
                    <span className="hd-item-txt"><b>{x}</b><small>Perguntar ao assistente</small></span>
                    <i className="hd-chev">{Ico.chev}</i>
                  </button>
                ))}
                {q && questions.length === 0 ? (
                  <button type="button" className="hd-item" onClick={() => openChat(query)}>
                    <span className="hd-item-txt"><b>{query.trim()}</b><small>Perguntar ao assistente</small></span>
                    <i className="hd-chev">{Ico.chev}</i>
                  </button>
                ) : null}
              </div>
              {tabs}
            </div>
          ) : (
            <div className="hd-view hd-chat" key="chat">
              <div className="hd-chathead">
                <button type="button" className="hd-icbtn" onClick={() => setView('home')} aria-label="Voltar">{Ico.back}</button>
                <img className="hd-avatar" src={LOGO_ROUND} alt="" />
                <span className="hd-chat-title"><b>Assistente LPS</b><small>{subtitle}</small></span>
                <button type="button" className="hd-icbtn" onClick={() => void resetChat()} title="Nova conversa (volta ao assistente)" aria-label="Nova conversa">{Ico.reset}</button>
                <button type="button" className="hd-icbtn" onClick={close} aria-label="Fechar">{Ico.close}</button>
              </div>
              <div className="hd-body" ref={scroller}>
                {msgs.map((m) => (
                  <div key={m.id} className={`sc-msg ${m.sender === 'VISITOR' ? 'me' : m.sender === 'ADMIN' ? 'adm' : 'bot'}`}>
                    {m.sender === 'ADMIN' ? <span className="sc-who">Equipa LPS Vendas</span> : null}
                    <MsgBody body={m.body} sender={m.sender} />
                  </div>
                ))}
                {busy ? <div className="sc-msg bot sc-typing" aria-label="a escrever"><i /><i /><i /></div> : null}
                {msgs.length <= 1 && !busy && !pending ? (
                  <div className="hd-quick">
                    {QUICK.map((x) => <button key={x} type="button" onClick={() => void send(x)}>{x}</button>)}
                  </div>
                ) : null}
              </div>
              <div className="hd-composer">
                <input value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} placeholder="Envie uma mensagem…" />
                <button type="button" onClick={() => void send()} disabled={busy || !input.trim()} aria-label="Enviar">{Ico.up}</button>
              </div>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
