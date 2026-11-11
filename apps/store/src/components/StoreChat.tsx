import React, { useEffect, useRef, useState } from 'react';
import './storechat.css';
import { api } from '../api/client';
import type { StoreChatMessage } from '../api/types';
import { useCustomer } from '../store/customer';
import { useStore } from '../state/StoreContext';

const time = (s: string) => { try { return new Date(s).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

/* Ícones do mensageiro (os mesmos traços do chat da landing). */
const Ico = {
  close: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>,
  search: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>,
  phone: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>,
  mail: <svg width="20" height="20" viewBox="0 0 38 30" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" aria-hidden><rect x="2" y="2" width="34" height="26" rx="2" /><path d="m2.5 3 16.5 14L35.5 3" /></svg>,
  help: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.6-3 4.5M12 17.5h.01" /></svg>,
  back: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18 9 12l6-6" /></svg>,
  home: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden><path d="M3.5 10.2 12 4l8.5 6.2V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19z" /><path d="M8.5 14.5c1 1 2.2 1.5 3.5 1.5s2.5-.5 3.5-1.5" strokeLinecap="round" /></svg>,
  msgs: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden><path d="M4 4.5h16v12H9.5L5 20v-3.5H4z" /><path d="M8 9h8M8 12.5h5" strokeLinecap="round" /></svg>,
  chev: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>,
  sendFill: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M3.4 20.4 21 12 3.4 3.6l.1 6.5L15 12 3.5 13.9z" /></svg>,
  up: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg>,
};

/** Perguntas rápidas: só abrem a conversa com a pergunta já escrita (a loja responde). */
const QUICK = ['Onde está a minha encomenda?', 'Quais são as formas de pagamento?', 'Este produto está disponível?', 'Fazem entregas na minha zona?'];

/**
 * Chat flutuante do cliente com a loja — mesmo desenho do mensageiro da landing:
 * lançador (balão com sorriso → seta), cartão com Início · Mensagens · Ajuda e a
 * conversa com a equipa da loja (online/offline, atualização a cada 4 s).
 * Só aparece com sessão do cliente.
 */
export function StoreChat({ code }: { code: string }) {
  const session = useCustomer(code);
  const { data } = useStore();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [view, setView] = useState<'home' | 'chat' | 'help'>('home');
  const [msgs, setMsgs] = useState<StoreChatMessage[]>([]);
  const [online, setOnline] = useState(false);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const token = session?.token;
  const storeName = data?.settings.brand_name || data?.storeName || 'Loja';
  const logo = data?.settings.logo_url || '/logo-mark.png';
  const phone = data?.settings.contact_phone || null;
  const email = data?.settings.contact_email || null;

  const load = async () => {
    if (!token) return;
    try { const r = await api.chatThread(code, token); setMsgs(r.messages); setOnline(r.staffOnline); } catch { /* offline */ }
  };
  useEffect(() => {
    if (!open || !token) return;
    void load();
    const t = window.setInterval(load, 4000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token]);
  useEffect(() => { if (view === 'chat') scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [msgs, view]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (view !== 'home') setView('home'); else close(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, view]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!token) return null;

  const close = () => { setClosing(true); window.setTimeout(() => { setOpen(false); setClosing(false); setView('home'); }, 200); };
  const toggle = () => { if (open) close(); else { setView('home'); setOpen(true); } };
  const send = async (override?: string) => {
    const body = (override ?? text).trim();
    if (!body || busy) return;
    setBusy(true);
    try { await api.chatSend(code, token, body); setText(''); await load(); } catch { /* */ } finally { setBusy(false); }
  };
  const openChat = (q?: string) => { setView('chat'); if (q) setText(q); };
  const ql = query.trim().toLowerCase();
  const questions = ql ? QUICK.filter((x) => x.toLowerCase().includes(ql)) : QUICK;

  const tabs = (
    <nav className="hd-tabs" aria-label="Ajuda">
      <button type="button" className={view === 'home' ? 'on' : ''} onClick={() => setView('home')}>{Ico.home}<span>Início</span></button>
      <button type="button" className={view === 'chat' ? 'on' : ''} onClick={() => openChat()}>{Ico.msgs}<span>Mensagens</span></button>
      <button type="button" className={view === 'help' ? 'on' : ''} onClick={() => setView('help')}>{Ico.help}<span>Ajuda</span></button>
    </nav>
  );

  return (
    <>
      <button className={`sc-fab store-chat-fab${open && !closing ? ' on' : ''}`} onClick={toggle} aria-label={open ? 'Fechar' : 'Falar com a loja'} aria-expanded={open}>
        <svg className="sc-fab-ic sc-fab-open" width="24" height="27" viewBox="0 0 28 32" aria-hidden="true">
          <path fill="currentColor" d="M4 0h20a4 4 0 0 1 4 4v18.6L28 32l-8.6-3.4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z" />
          <path className="sc-fab-smile" fill="none" strokeWidth="2.2" strokeLinecap="round" d="M6.2 19.4c1.9 1.7 4.6 2.8 7.8 2.8s5.9-1.1 7.8-2.8" />
        </svg>
        <svg className="sc-fab-ic sc-fab-min" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M18.6 8.4a.85.85 0 0 0-1.2 0L12 13.8 6.6 8.4a.85.85 0 1 0-1.2 1.2l6 6a.85.85 0 0 0 1.2 0l6-6a.85.85 0 0 0 0-1.2z" />
        </svg>
      </button>

      {open ? (
        <section className={`hd-msgr${closing ? ' out' : ''}`} role="dialog" aria-label="Falar com a loja">
          {view === 'home' ? (
            <div className="hd-view hd-home" key="home">
              <div className="hd-scroll">
                <div className="hd-home-top">
                  <img className="hd-logo" src={logo} alt={storeName} />
                  <button type="button" className="hd-x" onClick={close} aria-label="Fechar">{Ico.close}</button>
                </div>
                <h2 className="hd-hello">Olá <span aria-hidden>👋</span><br />Como podemos ajudar?</h2>
                <div className="hd-cards">
                  <button type="button" className="hd-card" onClick={() => openChat()}>
                    <span>Envie-nos uma mensagem<small className={`hd-status${online ? ' on' : ''}`}>{online ? 'Online agora' : 'Respondemos assim que possível'}</small></span>
                    <i className="hd-card-ic">{Ico.sendFill}</i>
                  </button>
                  <button type="button" className="hd-card" onClick={() => setView('help')}>
                    <span>Procure ajuda</span><i className="hd-card-ic">{Ico.search}</i>
                  </button>
                  {phone || email ? (
                    <div className="hd-card hd-contacts">
                      {phone ? <a href={`tel:${phone.replace(/\s+/g, '')}`}>{Ico.phone}<span>{phone}</span></a> : null}
                      {email ? <a href={`mailto:${email}`}>{Ico.mail}<span>{email}</span></a> : null}
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
                    onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) openChat(query.trim()); }} />
                  {Ico.search}
                </label>
              </div>
              <div className="hd-scroll hd-list">
                {questions.map((x) => (
                  <button key={x} type="button" className="hd-item" onClick={() => openChat(x)}>
                    <span className="hd-item-txt"><b>{x}</b><small>Perguntar à loja</small></span>
                    <i className="hd-chev">{Ico.chev}</i>
                  </button>
                ))}
                {ql && questions.length === 0 ? (
                  <button type="button" className="hd-item" onClick={() => openChat(query.trim())}>
                    <span className="hd-item-txt"><b>{query.trim()}</b><small>Perguntar à loja</small></span>
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
                <span className="hd-avatar-wrap"><img className="hd-avatar" src={logo} alt="" /><i className={online ? 'on' : ''} /></span>
                <span className="hd-chat-title"><b>{storeName}</b><small>{online ? 'Online agora' : 'Respondemos assim que possível'}</small></span>
                <button type="button" className="hd-icbtn" onClick={close} aria-label="Fechar">{Ico.close}</button>
              </div>
              <div className="hd-body" ref={scroller}>
                {msgs.length === 0 ? <div className="sc-msg bot">Olá! 👋 Escreva a sua mensagem — a loja responde aqui.</div> : msgs.map((m) => {
                  const mine = m.sender_type === 'CUSTOMER';
                  return (
                    <div key={m.id} className={`sc-msg ${mine ? 'me' : 'adm'}`}>
                      {!mine ? <span className="sc-who">{m.sender_name}</span> : null}
                      <span className="sc-txt">{m.body}</span>
                      <small className="sc-time">{time(m.created_at)}</small>
                    </div>
                  );
                })}
                {msgs.length === 0 && !text ? (
                  <div className="hd-quick">{QUICK.map((x) => <button key={x} type="button" onClick={() => void send(x)}>{x}</button>)}</div>
                ) : null}
              </div>
              <div className="hd-composer">
                <input value={text} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} placeholder="Envie uma mensagem…" />
                <button type="button" onClick={() => void send()} disabled={busy || !text.trim()} aria-label="Enviar">{Ico.up}</button>
              </div>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
