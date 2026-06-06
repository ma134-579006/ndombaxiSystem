import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { SubMessage, Subscription } from '../api/types';
import { IconLogout, IconReceipt } from '../components/Icons';

/**
 * Ecrã de ESPERA: a empresa concluiu o setup/pagamento mas aguarda APROVAÇÃO
 * do Super Admin. Mostra o estado e o CHAT com o administrador (via subscrição).
 * Faz polling: assim que for aprovada, entra automaticamente no painel.
 */
export function PendingApproval({ onApproved }: { onApproved(): void }) {
  const { logout, user } = useAuth();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [msgs, setMsgs] = useState<SubMessage[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Carrega a subscrição (a mais recente) e as mensagens.
  const refresh = async () => {
    try {
      const subs = await api.subscription.mine();
      const s = subs[0] ?? null;
      setSub(s);
      if (s) setMsgs(await api.subscription.messages(s.id).catch(() => []));
    } catch { /* mantém */ }
    // Verifica aprovação (status da empresa).
    try {
      const st = await api.onboarding.setupStatus();
      if (st.approved) onApproved();
    } catch { /* ignora */ }
  };

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 12000); // polling até aprovar
    return () => window.clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || !sub) return;
    setText(''); setErr(null);
    try {
      await api.subscription.send(sub.id, body);
      setMsgs(await api.subscription.messages(sub.id));
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao enviar.'); }
  };

  return (
    <div className="login">
      <div className="box" style={{ maxWidth: 560 }}>
        <div className="brand">
          <div style={{ width: 56, height: 56, borderRadius: 16, display: 'grid', placeItems: 'center', background: 'var(--surface-2)', border: '1px solid var(--border)', marginBottom: 10 }}>
            <IconReceipt size={26} />
          </div>
          <h1>Conta em aprovação</h1>
          <div className="tg">O administrador está a validar o seu pagamento</div>
        </div>
        <div className="card">
          <div className="banner info" style={{ marginBottom: 12 }}>
            A sua conta foi criada e o comprovativo enviado. Assim que o <strong>Super Admin</strong> aprovar,
            o painel desbloqueia automaticamente (esta página atualiza sozinha).
          </div>
          {sub ? (
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Subscrição: <strong>{sub.plan?.name ?? sub.planId}</strong> · estado <strong>{sub.status}</strong>
              {sub.reviewNote ? <> · nota: {sub.reviewNote}</> : null}
            </p>
          ) : null}

          <h3 style={{ margin: '6px 0 8px' }}>Conversa com o administrador</h3>
          <div className="chat-box">
            {msgs.length === 0 ? <div className="muted" style={{ fontSize: 13, padding: 8 }}>Sem mensagens. Escreva ao administrador se precisar.</div>
              : msgs.map((m) => (
                <div key={m.id} className={`chat-msg ${m.sender === 'COMPANY' ? 'me' : 'them'}`}>
                  <div className="cm-who">{m.sender === 'COMPANY' ? (user?.name || 'Eu') : (m.senderName || 'Administrador')}</div>
                  <div className="cm-body">{m.body}</div>
                </div>
              ))}
            <div ref={endRef} />
          </div>
          {err ? <div className="banner danger" style={{ margin: '8px 0' }}>{err}</div> : null}
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <input style={{ flex: 1, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 13px', color: 'var(--text)' }}
              value={text} onChange={(e) => setText(e.target.value)} placeholder="Escrever mensagem…"
              onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} disabled={!sub} />
            <button className="btn" onClick={() => void send()} disabled={!sub || !text.trim()}>Enviar</button>
          </div>
        </div>
        <p style={{ textAlign: 'center', marginTop: 12 }}>
          <a onClick={() => void logout()} style={{ color: 'var(--muted)', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconLogout size={15} /> Terminar sessão
          </a>
        </p>
      </div>
    </div>
  );
}
