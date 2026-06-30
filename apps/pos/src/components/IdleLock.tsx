import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { LOGO_SRC, SYSTEM_NAME } from '../brand';
import { useAuth } from '../auth/AuthContext';

const IDLE_MS = 2.5 * 60 * 1000; // 2 min e meio sem atividade → bloqueia (não faz logout)
const WEEKDAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/**
 * Bloqueio de ecrã do POS (estilo Windows 11, enterprise): após 5 min sem rato/
 * teclado, hiberna num ecrã bonito com o logo do sistema, data/hora em tempo real
 * e o perfil do operador. Para voltar, pede APENAS o PIN do próprio operador
 * (re-verificado no servidor) — o estado da app (venda em curso) é preservado.
 */
export function IdleLock({ photo, name, role }: { photo: string | null; name: string; role: string }) {
  const { logout, loginPin, companyCode, user } = useAuth();
  const [locked, setLocked] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const arm = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLocked(true), IDLE_MS);
  }, []);

  // Re-arma o temporizador a cada interação — exceto quando já está bloqueado.
  useEffect(() => {
    if (locked) return;
    arm();
    const reset = () => arm();
    const evs: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      evs.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [locked, arm]);

  // Bloqueio manual (sub-botão "Bloquear" do perfil) via evento global.
  useEffect(() => {
    const lockNow = () => setLocked(true);
    window.addEventListener('ndx-lock', lockNow);
    return () => window.removeEventListener('ndx-lock', lockNow);
  }, []);

  // Relógio em tempo real (só corre enquanto bloqueado).
  useEffect(() => {
    if (!locked) return;
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, [locked]);

  useEffect(() => {
    if (locked) { setPin(''); setErr(null); setTimeout(() => inputRef.current?.focus(), 120); }
  }, [locked]);

  const unlock = async () => {
    if (busy) return;
    if (!/^\d{4,8}$/.test(pin)) { setErr('Introduz o teu PIN.'); return; }
    setBusy(true); setErr(null);
    try {
      // RE-AUTENTICA com o PIN (a credencial do operador). Devolve SEMPRE o acesso
      // e renova a sessão, mesmo que o token de 15min tenha expirado durante o
      // bloqueio — NUNCA faz logout. (Antes usava verifyPin: com o token expirado
      // caía no fluxo de refresh→logout ao fim de >15 min.)
      if (companyCode && user?.sub) {
        await loginPin(companyCode, user.sub, pin);
      } else {
        const r = await api.verifyPin(pin); // sem dados p/ re-login → verifica na sessão atual
        if (!r.ok) throw new ApiError(401, 'PIN incorreto. Tenta novamente.');
      }
      setLocked(false); setPin('');
    } catch (e) {
      const m = e instanceof ApiError
        ? (e.status === 401 || e.status === 400 ? 'PIN incorreto. Tenta novamente.'
           : e.status === 0 ? 'Sem ligação. Tenta de novo.' : e.message)
        : 'Não foi possível validar. Tenta de novo.';
      setErr(m); setPin(''); inputRef.current?.focus();
    } finally { setBusy(false); }
  };

  if (!locked) return null;

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const dateLabel = `${WEEKDAYS[now.getDay()]}, ${now.getDate()} de ${MONTHS[now.getMonth()]} de ${now.getFullYear()}`;

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="Ecrã bloqueado">
      <div className="lock-aurora" aria-hidden />
      <header className="lock-top">
        <img className="lock-logo" src={LOGO_SRC} alt={SYSTEM_NAME} />
        <span className="lock-sys">{SYSTEM_NAME}</span>
      </header>

      <div className="lock-clock">
        <div className="lock-time">{hh}:{mm}<span className="lock-secs">:{ss}</span></div>
        <div className="lock-date">{dateLabel}</div>
      </div>

      <div className="lock-card" onClick={(e) => e.stopPropagation()}>
        {photo ? <img className="lock-av" src={photo} alt={name} />
          : <span className="lock-av lock-av-ph">{(name || '?').slice(0, 1).toUpperCase()}</span>}
        <div className="lock-name">{name}</div>
        <div className="lock-role">{role}</div>

        <form className="lock-form" onSubmit={(e) => { e.preventDefault(); void unlock(); }}>
          <input
            ref={inputRef}
            className="lock-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder="PIN"
            value={pin}
            maxLength={8}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
          <button className="lock-btn" type="submit" disabled={busy}>{busy ? 'A validar…' : 'Desbloquear'}</button>
        </form>
        {err ? <div className="lock-err">{err}</div> : null}
        <button className="lock-other" type="button" onClick={() => { setLocked(false); logout(); }}>
          Terminar sessão
        </button>
      </div>

      <div className="lock-hint">Sessão bloqueada por inatividade · introduz o PIN para continuar</div>
    </div>
  );
}
