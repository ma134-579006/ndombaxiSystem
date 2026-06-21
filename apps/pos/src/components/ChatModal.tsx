import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { ChatMessage } from '../api/types';
import { IconClose } from './Icons';

const ROLE_LABEL: Record<string, string> = {
  COMPANY_ADMIN: 'Administrador', REGIONAL_MANAGER: 'Gerente regional', STORE_MANAGER: 'Gestor',
  SHIFT_SUPERVISOR: 'Supervisor', CASHIER: 'Caixa', ATTENDANT: 'Atendedor',
};
const fmt = (s: string) => { try { return new Date(s).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

/** Chat do operador de caixa com o gerente/gestor. Guardado no servidor. */
export function ChatModal({ meId, onClose, onRead }: { meId?: string; onClose(): void; onRead?(): void }) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);

  const load = async () => { try { setMsgs(await api.chatList()); } catch { /* offline */ } };
  useEffect(() => {
    void load();
    void api.chatMarkRead().then(() => onRead?.()).catch(() => undefined);
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try { await api.chatSend(body); setText(''); await load(); } catch { /* tenta depois */ } finally { setBusy(false); }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100dvh - 40px)', overflow: 'hidden' }}>
        <div className="row" style={{ alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>💬 Chat com o gerente</h2>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="trash" onClick={onClose} aria-label="Fechar"><IconClose size={22} /></button>
        </div>

        <div ref={scroller} style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: 14 }}>
          {msgs.length === 0 ? (
            <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
              Sem mensagens.<br />Escreve ao gerente.
            </div>
          ) : msgs.map((m) => {
            const mine = !!meId && m.sender_id === meId;
            return (
              <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '84%' }}>
                {!mine ? <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '0 0 2px 4px' }}>{m.sender_name} · {ROLE_LABEL[m.sender_role] ?? m.sender_role}</div> : null}
                <div style={{ background: mine ? 'var(--primary)' : 'var(--surface-2, var(--bg-2))', color: mine ? '#fff' : 'var(--text)', padding: '8px 12px', borderRadius: 14, fontSize: 14, lineHeight: 1.4, wordBreak: 'break-word' }}>
                  {m.body}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)', textAlign: mine ? 'right' : 'left', margin: '2px 4px 0' }}>{fmt(m.created_at)}</div>
              </div>
            );
          })}
        </div>

        <div className="row" style={{ gap: 8, alignItems: 'flex-end', padding: 12, borderTop: '1px solid var(--border)', flex: 'none' }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder="Escreve uma mensagem…"
            rows={1}
            style={{ flex: 1, resize: 'none', minHeight: 44, maxHeight: 120, padding: '11px 12px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14, fontFamily: 'inherit' }}
          />
          <button className="btn" onClick={() => void send()} disabled={busy || !text.trim()} style={{ height: 44 }}>Enviar</button>
        </div>
      </div>
    </div>
  );
}
