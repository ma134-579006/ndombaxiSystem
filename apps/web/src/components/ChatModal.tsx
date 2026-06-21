import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { ChatMessage } from '../api/types';
import { Modal } from './ui';

const ROLE_LABEL: Record<string, string> = {
  COMPANY_ADMIN: 'Administrador', REGIONAL_MANAGER: 'Gerente regional', STORE_MANAGER: 'Gestor',
  SHIFT_SUPERVISOR: 'Supervisor', CASHIER: 'Caixa', ATTENDANT: 'Atendedor',
};
const fmt = (s: string) => { try { return new Date(s).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

/**
 * Chat interno de equipa (gestor ↔ caixa). Mensagens guardadas no servidor;
 * atualiza em tempo real (polling) e marca como lido ao abrir.
 */
export function ChatModal({ meId, title, onClose, onRead }: { meId?: string; title: string; onClose(): void; onRead?(): void }) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);

  const load = async () => { try { setMsgs(await api.chat.list()); } catch { /* offline */ } };
  useEffect(() => {
    void load();
    void api.chat.markRead().then(() => onRead?.()).catch(() => undefined);
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try { await api.chat.send(body); setText(''); await load(); } catch { /* tenta depois */ } finally { setBusy(false); }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div ref={scroller} style={{ height: '52vh', maxHeight: '52vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 2px 8px' }}>
        {msgs.length === 0 ? (
          <div className="empty" style={{ margin: 'auto', textAlign: 'center', color: 'var(--muted)' }}>
            <p>Sem mensagens ainda.<br />Escreve a primeira para a equipa.</p>
          </div>
        ) : msgs.map((m) => {
          const mine = !!meId && m.sender_id === meId;
          return (
            <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
              {!mine ? <div className="muted" style={{ fontSize: 11.5, margin: '0 0 2px 4px' }}>{m.sender_name} · {ROLE_LABEL[m.sender_role] ?? m.sender_role}</div> : null}
              <div style={{ background: mine ? 'var(--primary)' : 'var(--surface-2)', color: mine ? '#fff' : 'var(--text)', padding: '8px 12px', borderRadius: 14, fontSize: 14, lineHeight: 1.4, wordBreak: 'break-word' }}>
                {m.body}
              </div>
              <div className="muted" style={{ fontSize: 10.5, textAlign: mine ? 'right' : 'left', margin: '2px 4px 0' }}>{fmt(m.created_at)}</div>
            </div>
          );
        })}
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end', marginTop: 10 }}>
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
    </Modal>
  );
}
