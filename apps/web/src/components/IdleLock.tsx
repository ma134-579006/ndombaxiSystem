import React, { useCallback, useEffect, useRef, useState } from 'react';
import { UserAvatar, displayName } from './UserAvatar';
import { api, ApiError } from '../api/client';
import { LOGO_SRC, SYSTEM_NAME } from '../brand';
import { LS_PREV_ACCESS, LS_PREV_REFRESH, useAuth } from '../auth/AuthContext';
import { API_URL } from '../config';
import { verifyOffline } from '../offline/session';

const IDLE_MS = 5 * 60 * 1000; // 5 min sem atividade no painel de gestão (empresa e super admin) → ecrã de bloqueio
const LOCK_KEY = 'ndombaxi.admin.idle';
type LockState = { who: string; last: number; locked: boolean };
function readLockState(who: string): LockState | null {
  if (!who) return null;
  try {
    const v = JSON.parse(sessionStorage.getItem(LOCK_KEY) ?? 'null') as LockState | null;
    if (!v || v.who !== who || typeof v.last !== 'number') return null;
    // Login novo depois da última atividade gravada → começa desbloqueado.
    const start = Number(sessionStorage.getItem('ndombaxi.web.session_start') ?? 0);
    return start > v.last ? null : v;
  } catch { return null; }
}
function writeLockState(who: string, v: { last: number; locked: boolean }): void {
  if (!who) return;
  try { sessionStorage.setItem(LOCK_KEY, JSON.stringify({ who, ...v })); } catch { /* sem armazenamento */ }
}
function clearLockState(): void { try { sessionStorage.removeItem(LOCK_KEY); } catch { /* ignora */ } }
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
 * Bloqueio de ecrã do painel (estilo Windows 11, enterprise): após 5 min sem
 * rato/teclado (o timer reinicia a cada interação real), hiberna num ecrã com
 * o logo do sistema, data/hora em tempo real
 * e o perfil do gestor. Para voltar, pede a PALAVRA-PASSE do próprio utilizador
 * (re-verificada no servidor) — o estado do painel é preservado.
 */
export function IdleLock({ photo, name, role }: { photo: string | null; name: string; role: string }) {
  const { logout, shadow, user, companyCode } = useAuth();
  // Estado guardado no separador (sessionStorage): recarregar a página (F5) não
  // pode desbloquear sem senha, e uma página reaberta depois de 5 min parada
  // abre já bloqueada. Associado ao utilizador, para um login novo começar limpo.
  const who = user?.sub ?? user?.email ?? '';
  const saved = readLockState(who);
  const [locked, setLockedRaw] = useState(() => !!saved && (saved.locked || Date.now() - saved.last >= IDLE_MS));
  const [now, setNow] = useState(() => new Date());
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Hora da última interação real. O temporizador sozinho falha quando o
  // computador suspende ou o separador fica em segundo plano (os timers param
  // ou atrasam): por isso confere-se também a hora real, a cada 15 s e ao voltar.
  const lastActivity = useRef(saved && !locked ? saved.last : Date.now());
  const setLocked = useCallback((v: boolean) => {
    setLockedRaw(v);
    if (!v) lastActivity.current = Date.now();
    writeLockState(who, { last: lastActivity.current, locked: v });
  }, [who]);
  const lastWrite = useRef(0);
  const arm = useCallback(() => {
    const t = Date.now();
    lastActivity.current = t;
    // Grava no máximo 1x/5 s (mousemove dispara dezenas de vezes por segundo).
    if (t - lastWrite.current > 5000) { lastWrite.current = t; writeLockState(who, { last: t, locked: false }); }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLocked(true), IDLE_MS);
  }, [who, setLocked]);

  useEffect(() => {
    if (locked) return;
    arm();
    const reset = () => arm();
    const check = () => { if (Date.now() - lastActivity.current >= IDLE_MS) setLocked(true); };
    const onVisible = () => { if (!document.hidden) check(); };
    const evs: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    const iv = window.setInterval(check, 15_000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      window.clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
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
      let ok: boolean;
      try {
        ok = shadow ? await verifyPlatformPassword(pw) : (await api.verifyPassword(pw)).ok;
      } catch (e) {
        // SEM SERVIDOR (app instalada sem rede, nuvem a acordar): valida a senha no
        // cofre offline do aparelho — o mesmo do login offline. Só em falha de rede;
        // uma recusa do servidor nunca cai aqui.
        const semRede = e instanceof TypeError
          || (e instanceof ApiError && (e.status === 0 || e.status === 408 || (e.status >= 502 && e.status <= 504)));
        if (!semRede || shadow || !user?.email) throw e;
        const off = await verifyOffline(user.email, pw, companyCode);
        if (!off.ok && off.reason !== 'wrong-password') {
          throw new ApiError(0, 'Sem ligação ao servidor e sem credencial offline neste aparelho.');
        }
        ok = off.ok;
      }
      if (ok) { setLocked(false); setPw(''); }
      else { setErr('Senha incorreta. Tenta novamente.'); setPw(''); inputRef.current?.focus(); }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível validar. Tenta de novo.');
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" /></svg>
          Sessão bloqueada
        </span>
      </header>

      <div className="lock-clock" aria-live="off">
        <div className="lock-time">{hh}:{mm}</div>
        <div className="lock-date">{dateLabel}</div>
      </div>

      <div className="lock-card" onClick={(e) => e.stopPropagation()}>
        <UserAvatar photo={shadow ? null : photo} name={shadow ? 'Super Admin' : displayName(name)} size={72} className="lock-av" />
        <div className="lock-name">{shadow ? 'Super Admin' : displayName(name)}</div>
        <div className="lock-role">{shadow ? `Modo shadow · ${shadow}` : role}</div>

        <form className="lock-form" onSubmit={(e) => { e.preventDefault(); void unlock(); }}>
          <div className={`lock-field${err ? ' bad' : ''}`}>
            <input
              ref={inputRef}
              className="lock-pin"
              type="password"
              autoComplete="current-password"
              placeholder={shadow ? 'Senha do Super Admin' : 'Senha'} aria-label={shadow ? 'Senha do Super Admin' : 'Senha'}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
            <button className="lock-go" type="submit" disabled={busy} aria-label="Desbloquear" title="Desbloquear">
              {busy
                ? <span className="lock-spin" aria-hidden="true" />
                : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>}
            </button>
          </div>
        </form>
        {err ? <div className="lock-err" role="alert">{err}</div> : null}
        <button className="lock-other" type="button" onClick={() => { clearLockState(); setLockedRaw(false); logout(); }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
          Terminar sessão
        </button>
      </div>

      <div className="lock-hint">Bloqueado por inatividade · introduza a palavra-passe para continuar</div>
    </div>
  );
}
