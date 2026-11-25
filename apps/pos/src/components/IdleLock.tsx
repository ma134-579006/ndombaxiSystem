import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { UserAvatar, displayName } from './UserAvatar';
import { LOGO_SRC, SYSTEM_NAME } from '../brand';
import { useAuth } from '../auth/AuthContext';
import { isNativeApp } from '../config';
import { verifyOffline } from '../offline/session';

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

  // Bloqueia ao MINIMIZAR a app (nunca faz logout; a venda em curso fica em
  // memória e é preservada). Só na APP instalada — no navegador, trocar de
  // separador não deve bloquear a Caixa. Ao voltar, pede o PIN (que funciona
  // offline, ver unlock).
  useEffect(() => {
    if (!isNativeApp()) return;
    const onHide = () => { if (document.hidden) setLocked(true); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
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
        try {
          await loginPin(companyCode, user.sub, pin);
        } catch (e) {
          // SEM REDE → valida o PIN OFFLINE (mesmo cofre do login offline da Caixa)
          // e desbloqueia localmente. A sessão em memória é preservada; nunca há
          // logout. Só cai aqui em falha de rede (status 0).
          if (e instanceof ApiError && (e.status === 0 || e.status === 408 || (e.status >= 502 && e.status <= 504)) && user?.email) {
            const off = await verifyOffline(user.email, pin, companyCode);
            if (!off.ok) {
              throw new ApiError(off.reason === 'wrong-pin' ? 401 : 0,
                off.reason === 'wrong-pin' ? 'PIN incorreto. Tenta novamente.'
                  : 'Sem ligação e sem sessão offline. Ligue-se à internet uma vez.');
            }
          } else {
            throw e;
          }
        }
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
    const dateLabel = `${WEEKDAYS[now.getDay()]}, ${now.getDate()} de ${MONTHS[now.getMonth()]} de ${now.getFullYear()}`;

  return (
    <div className="lock-screen v3" role="dialog" aria-modal="true" aria-label="Ecrã bloqueado">
      <div className="lock-bg" aria-hidden="true" />
      <header className="lock-top">
        <span className="lock-brand"><img className="lock-logo" src={LOGO_SRC} alt="" /><span>{SYSTEM_NAME}</span></span>
        <span className="lock-state">
          <svg width="14" height="14" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M17 8h-1V6.11a4 4 0 1 0-8 0V8H7a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-8a3 3 0 0 0-3-3zm-7-1.89A2.06 2.06 0 0 1 12 4a2.06 2.06 0 0 1 2 2.11V8h-4zM18 19a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1z" /><path d="M12 12a3 3 0 1 0 3 3 3 3 0 0 0-3-3zm0 4a1 1 0 1 1 1-1 1 1 0 0 1-1 1z" /></svg>
          Sessão bloqueada
        </span>
      </header>

      <div className="lock-clock" aria-live="off">
        <div className="lock-time">{hh}:{mm}</div>
        <div className="lock-date">{dateLabel}</div>
      </div>

      <div className="lock-card" onClick={(e) => e.stopPropagation()}>
        <UserAvatar photo={photo} name={displayName(name)} size={72} className="lock-av" />
        <div className="lock-name">{name}</div>
        <div className="lock-role">{role}</div>

        <form className="lock-form" onSubmit={(e) => { e.preventDefault(); void unlock(); }}>
          <div className={`lock-field${err ? ' bad' : ''}`}>
            <input
              ref={inputRef}
              className="lock-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="PIN" aria-label="PIN"
              value={pin}
              maxLength={8}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
            <button className="lock-go" type="submit" disabled={busy} aria-label="Desbloquear" title="Desbloquear">
              {busy
                ? <span className="lock-spin" aria-hidden="true" />
                : <svg width="18" height="18" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M5 13h11.86l-3.63 4.36a1 1 0 0 0 1.54 1.28l5-6a1.19 1.19 0 0 0 .09-.15c0-.05.05-.08.07-.13A1 1 0 0 0 20 12a1 1 0 0 0-.07-.36c0-.05-.05-.08-.07-.13a1.19 1.19 0 0 0-.09-.15l-5-6A1 1 0 0 0 14 5a1 1 0 0 0-.64.23 1 1 0 0 0-.13 1.41L16.86 11H5a1 1 0 0 0 0 2z" /></svg>}
            </button>
          </div>
        </form>
        {err ? <div className="lock-err" role="alert">{err}</div> : null}
        <button className="lock-other" type="button" onClick={() => { setLocked(false); logout(); }}>
          <svg width="15" height="15" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M7 6a1 1 0 0 0 0-2H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h2a1 1 0 0 0 0-2H6V6z" /><path d="M20.82 11.42l-2.82-4a1 1 0 0 0-1.39-.24 1 1 0 0 0-.24 1.4L18.09 11H10a1 1 0 0 0 0 2h8l-1.8 2.4a1 1 0 0 0 .2 1.4 1 1 0 0 0 .6.2 1 1 0 0 0 .8-.4l3-4a1 1 0 0 0 .02-1.18z" /></svg>
          Terminar sessão
        </button>
      </div>

      <div className="lock-hint">Bloqueado por inatividade · introduza a PIN para continuar</div>
    </div>
  );
}
