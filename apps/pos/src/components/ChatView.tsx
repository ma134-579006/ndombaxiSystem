import { VWindow } from './VWindow';
import React, { useEffect, useRef } from 'react';
import { NeedsNetwork, useNetwork } from './NeedsNetwork';

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
  const online = useNetwork();
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [p.msgs.length, p.peer?.id]);
  const q = p.search.trim().toLowerCase();
  const list = q ? p.contacts.filter((c) => `${c.name} ${c.sub}`.toLowerCase().includes(q)) : p.contacts;
  const totalUnread = p.contacts.reduce((s, c) => s + c.unread, 0);

  return (
    <VWindow title={p.peer ? p.peer.name : p.title} onClose={p.onClose} narrow>
      <div className="cv-sheet in-vw">
        {!online ? (
          <>
            <div className="cv-head">
              <span className="cv-hic" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="1" /><circle cx="16" cy="12" r="1" /><circle cx="8" cy="12" r="1" /><path d="M19.07 4.93a10 10 0 0 0-16.28 11 1.06 1.06 0 0 1 .09.64L2 20.8a1 1 0 0 0 .27.91A1 1 0 0 0 3 22h.2l4.28-.86a1.26 1.26 0 0 1 .64.09 10 10 0 0 0 11-16.28zm.83 8.36a8 8 0 0 1-11 6.08 3.26 3.26 0 0 0-1.25-.26 3.43 3.43 0 0 0-.56.05l-2.82.57.57-2.82a3.09 3.09 0 0 0-.21-1.81 8 8 0 0 1 6.08-11 8 8 0 0 1 9.19 9.19z" /></svg>
              </span>
              <div className="cv-htx"><h3>{p.title}</h3><small>Sem ligação</small></div>
              <button className="cv-x" onClick={p.onClose} aria-label="Fechar">✕</button>
            </div>
            <NeedsNetwork what="O chat" />
          </>
        ) : !p.peer ? (
          <>
            <div className="cv-head">
              <span className="cv-hic" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="1" /><circle cx="16" cy="12" r="1" /><circle cx="8" cy="12" r="1" /><path d="M19.07 4.93a10 10 0 0 0-16.28 11 1.06 1.06 0 0 1 .09.64L2 20.8a1 1 0 0 0 .27.91A1 1 0 0 0 3 22h.2l4.28-.86a1.26 1.26 0 0 1 .64.09 10 10 0 0 0 11-16.28zm.83 8.36a8 8 0 0 1-11 6.08 3.26 3.26 0 0 0-1.25-.26 3.43 3.43 0 0 0-.56.05l-2.82.57.57-2.82a3.09 3.09 0 0 0-.21-1.81 8 8 0 0 1 6.08-11 8 8 0 0 1 9.19 9.19z" /></svg>
              </span>
              <div className="cv-htx"><h3>{p.title}</h3><small>{p.subtitle}{totalUnread ? ` · ${totalUnread} por ler` : ''}</small></div>
              <button className="cv-x" onClick={p.onClose} aria-label="Fechar">✕</button>
            </div>
            <div className="cv-search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.71 19.29l-3.4-3.39A7.92 7.92 0 0 0 19 11a8 8 0 1 0-8 8 7.92 7.92 0 0 0 4.9-1.69l3.39 3.4a1 1 0 0 0 1.42 0 1 1 0 0 0 0-1.42zM5 11a6 6 0 1 1 6 6 6 6 0 0 1-6-6z" /></svg>
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
                <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M21 4a1.31 1.31 0 0 0-.06-.27v-.09a1 1 0 0 0-.2-.3 1 1 0 0 0-.29-.19h-.09a.86.86 0 0 0-.31-.15H20a1 1 0 0 0-.3 0l-18 6a1 1 0 0 0 0 1.9l8.53 2.84 2.84 8.53a1 1 0 0 0 1.9 0l6-18A1 1 0 0 0 21 4zm-4.7 2.29l-5.57 5.57L5.16 10zM14 18.84l-1.86-5.57 5.57-5.57z" /></svg>
              </button>
            </div>
          </>
        )}
      </div>
    </VWindow>
  );
}
