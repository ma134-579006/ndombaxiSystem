import React, { useEffect, useRef } from 'react';

export interface CvContact { id: string; name: string; sub: string; online: boolean; unread: number }
export interface CvMsg { id: string; mine: boolean; body: string; at: string; author?: string }

const initials = (n: string) => (n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/**
 * Janela de chat profissional (lista de contactos + conversa), partilhada pelos
 * chats de equipa e de clientes. Só desenha; quem a usa trata dos dados.
 */
export function ChatView(p: {
  title: string; subtitle: string; contacts: CvContact[]; emptyText: string;
  search: string; onSearch(v: string): void; searchPlaceholder: string;
  peer: CvContact | null; peerStatus: string; onOpen(c: CvContact): void; onBack(): void;
  msgs: CvMsg[]; selMode: boolean; sel: Set<string>; onToggleSel(id: string): void; onSelMode(v: boolean): void; onDelete(): void;
  text: string; onText(v: string): void; onSend(): void; busy: boolean; onClose(): void;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [p.msgs.length, p.peer?.id]);
  const q = p.search.trim().toLowerCase();
  const list = q ? p.contacts.filter((c) => `${c.name} ${c.sub}`.toLowerCase().includes(q)) : p.contacts;
  const totalUnread = p.contacts.reduce((s, c) => s + c.unread, 0);

  return (
    <div className="modal-bg" onClick={p.onClose}>
      <div className="cv-sheet" onClick={(e) => e.stopPropagation()}>
        {!p.peer ? (
          <>
            <div className="cv-head">
              <span className="cv-hic" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z" /></svg>
              </span>
              <div className="cv-htx"><h3>{p.title}</h3><small>{p.subtitle}{totalUnread ? ` · ${totalUnread} por ler` : ''}</small></div>
              <button className="cv-x" onClick={p.onClose} aria-label="Fechar">✕</button>
            </div>
            <div className="cv-search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input value={p.search} onChange={(e) => p.onSearch(e.target.value)} placeholder={p.searchPlaceholder} />
              {p.search ? <button onClick={() => p.onSearch('')} aria-label="Limpar">✕</button> : null}
            </div>
            <div className="cv-list">
              {list.length === 0 ? <div className="cv-empty">{p.contacts.length === 0 ? p.emptyText : 'Nenhum resultado.'}</div>
                : list.map((c) => (
                  <button key={c.id} className="cv-contact" onClick={() => p.onOpen(c)}>
                    <span className="cv-av">{initials(c.name)}<i className={c.online ? 'on' : ''} /></span>
                    <span className="cv-ct">
                      <strong>{c.name}</strong>
                      <small>{c.sub}</small>
                    </span>
                    {c.unread > 0 ? <span className="cv-badge">{c.unread > 99 ? '99+' : c.unread}</span> : null}
                  </button>
                ))}
            </div>
          </>
        ) : (
          <>
            <div className="cv-head cv-conv">
              <button className="cv-back" onClick={p.onBack} aria-label="Voltar">←</button>
              <span className="cv-av sm">{initials(p.peer.name)}<i className={p.peer.online ? 'on' : ''} /></span>
              <div className="cv-htx"><h3>{p.peer.name}</h3><small className={p.peer.online ? 'on' : ''}>{p.peerStatus}</small></div>
              {p.selMode ? (
                <div className="cv-selact">
                  <button className="btn sm danger" onClick={p.onDelete} disabled={p.sel.size === 0}>Eliminar ({p.sel.size})</button>
                  <button className="btn sm ghost" onClick={() => p.onSelMode(false)}>Cancelar</button>
                </div>
              ) : <button className="btn sm ghost" onClick={() => p.onSelMode(true)} disabled={p.msgs.length === 0}>Selecionar</button>}
            </div>
            <div className="cv-msgs" ref={scroller}>
              {p.msgs.length === 0 ? <div className="cv-empty">Sem mensagens. Escreva a primeira.</div>
                : p.msgs.map((m, i) => {
                  const prev = p.msgs[i - 1];
                  const first = !prev || prev.mine !== m.mine || prev.author !== m.author;
                  return (
                    <div key={m.id} className={`cv-row${m.mine ? ' mine' : ''}${first ? ' first' : ''}${p.selMode ? ' sm' : ''}`} onClick={() => p.selMode && p.onToggleSel(m.id)}>
                      {p.selMode ? <input type="checkbox" checked={p.sel.has(m.id)} readOnly /> : null}
                      <div className="cv-bw">
                        {!m.mine && first && m.author ? <div className="cv-au">{m.author}</div> : null}
                        <div className="cv-bub">{m.body}</div>
                        <div className="cv-tm">{m.at}</div>
                      </div>
                    </div>
                  );
                })}
            </div>
            <div className="cv-comp">
              <textarea value={p.text} onChange={(e) => p.onText(e.target.value)} rows={1}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); p.onSend(); } }}
                placeholder={`Mensagem para ${p.peer.name}…`} />
              <button className="cv-send" onClick={p.onSend} disabled={p.busy || !p.text.trim()} aria-label="Enviar">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
