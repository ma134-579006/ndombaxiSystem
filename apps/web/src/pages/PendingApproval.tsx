import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { SubMessage, Subscription } from '../api/types';
import { IconLogout, IconReceipt } from '../components/Icons';
import { LOGO_WIDE } from '../brand';
import { LoginShowcase } from '../components/LoginShowcase';
import { ScreenKeyboard } from '../components/ScreenKeyboard';

/**
 * Ecrã de ESPERA: a empresa concluiu o setup/pagamento mas aguarda APROVAÇÃO
 * do Super Admin. Mostra o estado e o CHAT com o administrador (via subscrição).
 * Faz polling: assim que for aprovada, entra automaticamente no painel.
 */
export function PendingApproval({
  onApproved, title = 'Conta em aprovação', subtitle = 'O administrador está a validar a sua conta', intro,
}: {
  onApproved(): void;
  title?: string;
  subtitle?: string;
  intro?: React.ReactNode;
}) {
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
    // Resolve quando a empresa está aprovada E com plano válido (não expirado).
    try {
      const st = await api.onboarding.setupStatus();
      if (st.approved && !st.expired) onApproved();
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

  const statusLabel: Record<string, string> = {
    ACTIVE: 'Ativa', IN_REVIEW: 'Em análise', PENDING_PAYMENT: 'A aguardar pagamento', EXPIRED: 'Expirada', REJECTED: 'Rejeitada',
  };

  // Mesma identidade do login e da ativação: painel escuro à esquerda, vídeo à direita.
  return (
    <div className="auth auth-scroll">
      <ScreenKeyboard />
      <div className="auth-panel">
        <div className="auth-form">
          <img className="auth-logo-wide" src={LOGO_WIDE} alt="LPS Vendas" />
          <div className="auth-brandhead">
            <div className="ic"><IconReceipt size={24} /></div>
            <div>
              <h1>{title}</h1>
              <p className="sub">{subtitle}</p>
            </div>
          </div>

          <div className="auth-glass auth-stepanim">
            <div className="auth-note pa-note">
              <span className="pa-pulse" aria-hidden />
              <div>{intro ?? <>A sua conta foi criada. Assim que o <strong>administrador</strong> aprovar, o painel desbloqueia automaticamente.</>}</div>
            </div>
            {sub ? (
              <div className="pa-sub">
                <span>Plano <b>{sub.plan?.name ?? sub.planId}</b></span>
                <span className={`pa-chip s-${sub.status.toLowerCase()}`}>{statusLabel[sub.status] ?? sub.status}</span>
                {sub.reviewNote ? <small>{sub.reviewNote}</small> : null}
              </div>
            ) : null}

            <label className="auth-label">Conversa com o administrador</label>
            <div className="pa-chat">
              {msgs.length === 0 ? <div className="pa-empty">Sem mensagens</div>
                : msgs.map((m) => (
                  <div key={m.id} className={`pa-msg ${m.sender === 'COMPANY' ? 'me' : 'them'}`}>
                    <div className="pa-who">{m.sender === 'COMPANY' ? (user?.name || 'Eu') : (m.senderName || 'Administrador')}</div>
                    <div className="pa-body">{m.body}</div>
                  </div>
                ))}
              <div ref={endRef} />
            </div>
            {err ? <div className="auth-error">{err}</div> : null}
            <div className="pa-send">
              <input className="auth-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Escrever mensagem…"
                onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} disabled={!sub} />
              <button className="auth-btn" onClick={() => void send()} disabled={!sub || !text.trim()} aria-label="Enviar">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 2 11 13" /><path d="m22 2-7 20-4-9-9-4 20-7Z" /></svg>
              </button>
            </div>
          </div>

          <p className="auth-foot logout">
            <a onClick={() => void logout()}><IconLogout size={15} /> Terminar sessão</a>
          </p>
        </div>
      </div>
      <div className="auth-media"><LoginShowcase /></div>
    </div>
  );
}
