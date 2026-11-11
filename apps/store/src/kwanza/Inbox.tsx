import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatDateTime } from '../format';
import { I, P } from '../members/parts';
import { kw, type KChat, type KMsg, type KNote } from './api';

/** Sino do associado: avisos de vendas, aprovações, saques e mensagens das empresas. */
export function NotesBell({ token, onUnread }: { token: string; onUnread?(n: number): void }) {
  const [notes, setNotes] = useState<KNote[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement | null>(null);
  const load = useCallback(() => kw.notes(token).then((r) => { setNotes(r.items); setUnread(r.unread); }).catch(() => undefined), [token]);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (!document.hidden) void load(); }, 20000);
    const f = () => void load();
    window.addEventListener('focus', f);
    return () => { window.clearInterval(t); window.removeEventListener('focus', f); };
  }, [load]);
  useEffect(() => { onUnread?.(unread); }, [unread, onUnread]);
  useEffect(() => {
    if (!open) { setSel(new Set()); return; }
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); };
  }, [open]);
  const act = async (fn: () => Promise<unknown>) => { await fn().catch(() => undefined); setSel(new Set()); await load(); };
  const openNote = (n: KNote) => {
    if (!n.read) void kw.notesRead(token, [n.id]).then(load).catch(() => undefined);
    setOpen(false);
    if (n.link) location.hash = n.link;
  };
  const toggle = (id: string) => setSel((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const ids = [...sel];
  return (
    <div className="kw-nb" ref={ref}>
      <button className="kw-head-ic" onClick={() => setOpen((v) => !v)} aria-label="Notificações" aria-expanded={open}>
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {unread ? <i className="kw-badge">{unread > 99 ? '99+' : unread}</i> : null}
      </button>
      {open ? (
        <div className="kw-nb-pop kw-pop" role="dialog" aria-label="Notificações">
          <div className="kw-nb-h">
            <b>Notificações</b><span style={{ flex: 1 }} />
            {notes.length ? <button className="kw-nb-l" disabled={!unread} onClick={() => void act(() => kw.notesReadAll(token))}>Marcar todas como lidas</button> : null}
          </div>
          {sel.size ? (
            <div className="kw-nb-bulk">
              <span>{sel.size} selecionada(s)</span><span style={{ flex: 1 }} />
              <button className="kw-nb-l" onClick={() => void act(() => kw.notesRead(token, ids, true))}>Lidas</button>
              <button className="kw-nb-l" onClick={() => void act(() => kw.notesRead(token, ids, false))}>Não lidas</button>
              <button className="kw-nb-l danger" onClick={() => void act(() => kw.notesDelete(token, ids))}>Eliminar</button>
            </div>
          ) : null}
          <div className="kw-nb-list">
            {!notes.length ? <div className="kw-nb-empty">Sem notificações</div> : notes.map((n) => (
              <div key={n.id} className={`kw-nb-it${n.read ? '' : ' unread'}${sel.has(n.id) ? ' on' : ''}`}>
                <input type="checkbox" checked={sel.has(n.id)} onChange={() => toggle(n.id)} aria-label={`Selecionar: ${n.title}`} />
                <button className="kw-nb-b" onClick={() => openNote(n)}>
                  <b>{n.title}</b>{n.body ? <span>{n.body}</span> : null}<small>{formatDateTime(n.createdAt)}</small>
                </button>
                <span className="kw-nb-acts">
                  <button aria-label={n.read ? 'Marcar como não lida' : 'Marcar como lida'} title={n.read ? 'Marcar como não lida' : 'Marcar como lida'} onClick={() => void act(() => kw.notesRead(token, [n.id], !n.read))}>
                    {n.read ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5" /></svg> : <I d={P.check} size={15} />}
                  </button>
                  <button className="danger" aria-label="Eliminar" title="Eliminar" onClick={() => void act(() => kw.notesDelete(token, [n.id]))}><I d={P.trash} size={15} /></button>
                </span>
              </div>
            ))}
          </div>
          {notes.length ? (
            <div className="kw-nb-f">
              <label><input type="checkbox" checked={sel.size === notes.length} onChange={(e) => setSel(e.target.checked ? new Set(notes.map((x) => x.id)) : new Set())} /> Selecionar todas</label>
              <span style={{ flex: 1 }} />
              <button className="kw-nb-l danger" onClick={() => { if (window.confirm('Eliminar todas as notificações?')) void act(() => kw.notesDeleteAll(token)); }}>Eliminar todas</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Mensagens do associado com as empresas cujos produtos vende. */
export function Messages({ token, company, companies, go }: { token: string; company?: string; companies: Array<{ code: string; name: string }>; go(code?: string): void }) {
  const [chats, setChats] = useState<KChat[] | null>(null);
  const [msgs, setMsgs] = useState<KMsg[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const body = useRef<HTMLDivElement | null>(null);
  const loadChats = useCallback(() => kw.chats(token).then(setChats).catch(() => setChats([])), [token]);
  useEffect(() => { void loadChats(); }, [loadChats]);
  useEffect(() => {
    if (!company) { setMsgs([]); return; }
    let alive = true;
    const pull = () => kw.chat(token, company).then((m) => { if (alive) setMsgs(m); }).catch(() => undefined);
    void pull().then(loadChats);
    const t = window.setInterval(() => { if (!document.hidden) void pull(); }, 6000);
    return () => { alive = false; window.clearInterval(t); };
  }, [company, token, loadChats]);
  useEffect(() => { body.current?.scrollTo({ top: body.current.scrollHeight }); }, [msgs]);
  const send = async () => {
    if (!company || !text.trim()) return;
    setBusy(true); setErr(null);
    try { setMsgs(await kw.send(token, company, text.trim())); setText(''); void loadChats(); }
    catch { setErr('Não foi possível enviar.'); } finally { setBusy(false); }
  };
  // Empresas com quem ainda não há conversa (das afiliações) aparecem para iniciar.
  const known = new Set((chats ?? []).map((c) => c.companyCode));
  const others = companies.filter((c) => !known.has(c.code));
  const name = (chats ?? []).find((c) => c.companyCode === company)?.companyName ?? companies.find((c) => c.code === company)?.name ?? company;
  return (
    <div className={`kw-chatbox${company ? ' has' : ''}`}>
      <aside className="kw-chatbox-list">
        <div className="kw-chatbox-h"><b>Mensagens</b></div>
        {chats === null ? <div className="kw-nb-empty">…</div> : null}
        {(chats ?? []).map((c) => (
          <button key={c.companyCode} className={company === c.companyCode ? 'on' : ''} onClick={() => go(c.companyCode)}>
            <i className="kw-chatbox-av">{c.companyName.slice(0, 1).toUpperCase()}</i>
            <span><b>{c.companyName}</b><small>{c.last}</small></span>
            {c.unread ? <em className="kw-chatbox-n">{c.unread}</em> : null}
          </button>
        ))}
        {others.map((c) => (
          <button key={c.code} className={company === c.code ? 'on' : ''} onClick={() => go(c.code)}>
            <i className="kw-chatbox-av">{c.name.slice(0, 1).toUpperCase()}</i>
            <span><b>{c.name}</b><small>Nova conversa</small></span>
          </button>
        ))}
        {chats !== null && !chats.length && !others.length ? <div className="kw-nb-empty">Sem conversas</div> : null}
      </aside>
      <section className="kw-chatbox-main">
        {company ? (
          <>
            <header><button className="kw-x kw-chatbox-back" onClick={() => go()} aria-label="Voltar"><I d={P.back} size={18} /></button><b>{name}</b></header>
            <div className="kw-chatbox-body" ref={body}>
              {msgs.map((m) => <div key={m.id} className={`kw-chatbox-m${m.sender === 'ASSOCIATE' ? ' me' : ''}`}><span>{m.body}</span><small>{m.sender === 'COMPANY' ? `${m.senderName} · ` : ''}{formatDateTime(m.createdAt)}</small></div>)}
            </div>
            {err ? <div className="kw-chatbox-err" role="alert">{err}</div> : null}
            <form className="kw-chatbox-comp" onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreva a mensagem…" aria-label="Mensagem" maxLength={2000} />
              <button className="kw-btn kw-btn-primary" disabled={busy || !text.trim()} aria-label="Enviar"><I d={P.next} size={18} /></button>
            </form>
          </>
        ) : <div className="kw-chatbox-none"><I d={P.chat} size={40} /></div>}
      </section>
    </div>
  );
}
