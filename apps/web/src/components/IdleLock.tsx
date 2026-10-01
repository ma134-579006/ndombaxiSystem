import React, { useCallback, useEffect, useRef, useState } from 'react';
import { UserAvatar, displayName } from './UserAvatar';
import { api, ApiError } from '../api/client';
import { LOGO_SRC, SYSTEM_NAME } from '../brand';
import { LS_PREV_ACCESS, LS_PREV_REFRESH, useAuth } from '../auth/AuthContext';
import { API_URL } from '../config';

const IDLE_MS = 10 * 60 * 1000; // 10 min no PAINEL DE GESTÃO (leitura demora; a caixa mantém o bloqueio curto)
const WEEKDAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
/**
 * Em MODO SHADOW quem está ao teclado é o Super Admin (não sabe a senha do
 * gestor da empresa): valida a senha DELE com a sessão de plataforma guardada,
 * renovando-a se tiver expirado (as mesmas APIs de sempre).
 */
async function verifyPlatformPassword(password: string): Promise<boolean> {
  const call = (token: string) => fetch(`${API_URL}/auth/verify-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password }),
  });
  let res: Response | null = null;
  const access = sessionStorage.getItem(LS_PREV_ACCESS);
  if (access) res = await call(access);
  if (!res || res.status === 401) {
    const refresh = sessionStorage.getItem(LS_PREV_REFRESH);
    if (!refresh) return false;
    const pair = await api.refresh(refresh);
    sessionStorage.setItem(LS_PREV_ACCESS, pair.accessToken);
    sessionStorage.setItem(LS_PREV_REFRESH, pair.refreshToken);
    res = await call(pair.accessToken);
  }
  if (!res.ok) return false;
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean };
  return !!j.ok;
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/**
 * Bloqueio de ecrã do painel (estilo Windows 11, enterprise): após 10 min sem
 * rato/teclado (o timer reinicia a cada interação real), hiberna num ecrã com
 * o logo do sistema, data/hora em tempo real
 * e o perfil do gestor. Para voltar, pede a PALAVRA-PASSE do próprio utilizador
 * (re-verificada no servidor) — o estado do painel é preservado.
 */
export function IdleLock({ photo, name, role }: { photo: string | null; name: string; role: string }) {
  const { logout, shadow } = useAuth();
  const [locked, setLocked] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const arm = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLocked(true), IDLE_MS);
  }, []);

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

  // Bloqueia ao MINIMIZAR a app (nunca faz logout; o painel fica preservado). Só
  // na APP instalada — no navegador, trocar de separador não deve bloquear. Ao
  // voltar, pede a palavra-passe.
  useEffect(() => {
    const nw = window as unknown as {
      ndombaxi?: unknown; __NDOMBAXI_NATIVE__?: boolean;
      Capacitor?: { isNativePlatform?: () => boolean };
    };
    const native = window.location.protocol === 'ndombaxi:'
      || typeof nw.ndombaxi !== 'undefined'
      || nw.__NDOMBAXI_NATIVE__ === true
      || !!nw.Capacitor?.isNativePlatform?.();
    if (!native) return;
    const onHide = () => { if (document.hidden) setLocked(true); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  useEffect(() => {
    if (!locked) return;
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, [locked]);

  useEffect(() => {
    if (locked) { setPw(''); setErr(null); setTimeout(() => inputRef.current?.focus(), 120); }
  }, [locked]);

  const unlock = async () => {
    if (busy) return;
    if (!pw) { setErr('Introduz a tua palavra-passe.'); return; }
    setBusy(true); setErr(null);
    try {
      const ok = shadow ? await verifyPlatformPassword(pw) : (await api.verifyPassword(pw)).ok;
      if (ok) { setLocked(false); setPw(''); }
      else { setErr('Senha incorreta. Tenta novamente.'); setPw(''); inputRef.current?.focus(); }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível validar. Tenta de novo.');
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
        <UserAvatar photo={shadow ? null : photo} name={shadow ? 'Super Admin' : displayName(name)} size={72} className="lock-av" />
        <div className="lock-name">{shadow ? 'Super Admin' : displayName(name)}</div>
        <div className="lock-role">{shadow ? `Modo shadow · ${shadow}` : role}</div>

        <form className="lock-form" onSubmit={(e) => { e.preventDefault(); void unlock(); }}>
          <input
            ref={inputRef}
            className="lock-pin"
            type="password"
            autoComplete="current-password"
            placeholder={shadow ? 'Senha do Super Admin' : 'Senha'} aria-label={shadow ? 'Senha do Super Admin' : 'Senha'}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          <button className="lock-btn" type="submit" disabled={busy}>{busy ? 'A validar…' : 'Desbloquear'}</button>
        </form>
        {err ? <div className="lock-err">{err}</div> : null}
        <button className="lock-other" type="button" onClick={() => { setLocked(false); logout(); }}>
          Terminar sessão
        </button>
      </div>

      <div className="lock-hint">Sessão bloqueada por inatividade · introduz a palavra-passe para continuar</div>
    </div>
  );
}
