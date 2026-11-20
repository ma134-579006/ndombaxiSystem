import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { LOGO_WIDE } from '../brand';
import { useAuth } from '../auth/AuthContext';
import { PasswordField } from '../components/PasswordField';
import { cachedPhoto, rememberPhoto } from '../photoCache';
import { LangPicker } from '../components/LangPicker';
import {
  btnStyle, FacebookSquare, facebookToken, GoogleGlyph, googleToken, lookVars, useAuthPublic, useFitHeight, usePreloadSocial,
} from './vendusAuth';

export function LoginPage() {
  const { loginStaff, loginGoogle, loginFacebook } = useAuth();
  const [email, setEmail] = useState(() => { try { return localStorage.getItem('ndx:caixa_remember_email') ?? ''; } catch { return ''; } });
  const [remember, setRemember] = useState(() => { try { return !!localStorage.getItem('ndx:caixa_remember_email'); } catch { return false; } });
  const [pin, setPin] = useState('');
  const [emailRO, setEmailRO] = useState(true); // anti-autofill (editável após focar)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  // Link de recuperação do PIN: ?reset=<token>&k=pin
  const resetToken = useMemo(() => {
    try { const p = new URLSearchParams(window.location.search); return p.get('k') === 'pin' ? p.get('reset') : null; }
    catch { return null; }
  }, []);
  // «Abrir caixa» a partir do painel do gestor: ?staff=<email>&nome=<nome>.
  // O perfil já vem identificado; pede-se APENAS o PIN (sem login tradicional).
  const handoff = useMemo(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const em = (p.get('staff') || '').trim().toLowerCase();
      if (!em || !/^\S+@\S+\.\S+$/.test(em)) return null;
      return { email: em, name: (p.get('nome') || p.get('name') || '').trim() };
    } catch { return null; }
  }, []);

  const submit = async () => {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Indica o teu e-mail de funcionário.'); return; }
    if (!/^\d{4,8}$/.test(pin)) { setError('Digite o seu PIN de 6 dígitos.'); return; }
    try { if (remember) localStorage.setItem('ndx:caixa_remember_email', email.trim()); else localStorage.removeItem('ndx:caixa_remember_email'); } catch { /* */ }
    setLoading(true);
    try {
      await loginStaff(email, pin);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'E-mail ou PIN incorretos.');
      setPin('');
    } finally { setLoading(false); }
  };

  // Site (navegador) vs app; e app MÓVEL (Capacitor) vs DESKTOP (Electron). Em
  // cada uma o Google entra por uma porta diferente — o resto do fluxo é igual.
  const nw = window as unknown as {
    ndombaxi?: unknown; __NDOMBAXI_NATIVE__?: boolean;
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  const isNativeApp = window.location.protocol === 'ndombaxi:'
    || typeof nw.ndombaxi !== 'undefined'
    || nw.__NDOMBAXI_NATIVE__ === true
    || !!nw.Capacitor?.isNativePlatform?.();

  const pub = useAuthPublic();
  const look = pub?.look;
  usePreloadSocial(pub?.facebookAppId ?? null);
  const fitRef = useFitHeight<HTMLDivElement>();
  const g = look?.google; const f = look?.facebook;
  const showGoogle = g?.enabled !== false;
  const showFacebook = f?.enabled !== false && !isNativeApp;

  const startSocial = async (kind: 'google' | 'facebook') => {
    setError(null);
    try {
      const t = kind === 'google' ? await googleToken() : await facebookToken(pub?.facebookAppId ?? null);
      if (!t) { setError(`Entrada com ${kind === 'google' ? 'Google' : 'Facebook'} cancelada.`); return; }
      setLoading(true);
      if (kind === 'google') await loginGoogle(t); else await loginFacebook(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível entrar.');
    } finally { setLoading(false); }
  };

  return (
    <div className="va" style={lookVars(look)}>
      <div className="va-login">
        <div className="va-col" ref={fitRef}>
          <img className="va-logo" src={LOGO_WIDE} alt="LPS Vendas" />
          <div className="va-card">
            {resetToken ? (
              <>
                <h1 className="va-h1">Novo PIN</h1>
                <PinResetView token={resetToken} />
              </>
            ) : handoff ? (
              <OpenCashHandoff email={handoff.email} name={handoff.name} />
            ) : forgot ? (
              <ForgotPinView defaultEmail={email} />
            ) : (
              <>
                <h1 className="va-h1">Entrar na Caixa</h1>
                {error ? <div className="auth-error" role="alert">{error}</div> : null}

                <label className="va-label" htmlFor="ndx_field_acct">E-Mail:</label>
                <input className="va-input" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="E-Mail" inputMode="email" type="text"
                  autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                  name="ndx_field_acct" id="ndx_field_acct" aria-label="E-mail do funcionário"
                  data-lpignore="true" data-1p-ignore data-form-type="other" data-bwignore="true"
                  readOnly={emailRO} onFocus={() => setEmailRO(false)} onPointerDown={() => setEmailRO(false)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />

                <div className="va-row va-mt">
                  <label className="va-label">PIN:</label>
                  <a className="va-label va-link-sm" onClick={() => setForgot(true)}>Recuperar PIN</a>
                </div>
                <PasswordField value={pin} onChange={setPin} placeholder="PIN" digitsOnly
                  inputMode="numeric" maxLength={8} autoComplete="off" onEnter={() => void submit()} />

                <label className="va-remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Lembrar-me</label>

                <button className="va-btn" onClick={() => void submit()} disabled={loading}>
                  {loading ? 'A entrar…' : 'Iniciar Sessão'}
                </button>
              </>
            )}
          </div>

          {!resetToken && !handoff && !forgot && (showGoogle || showFacebook) ? (
            <>
              <div className="va-or"><span>Ou</span></div>
              {showGoogle ? (
                <button type="button" className="va-social g" style={btnStyle(g, true)} disabled={loading} onClick={() => void startSocial('google')}>
                  <GoogleGlyph />{g?.label || 'Entrar com Google'}
                </button>
              ) : null}
              {showFacebook ? (
                <button type="button" className="va-social f" style={btnStyle(f, true)} disabled={loading} onClick={() => void startSocial('facebook')}>
                  <FacebookSquare />{f?.label || 'Entrar com Facebook'}
                </button>
              ) : null}
            </>
          ) : null}

          {forgot ? <p className="va-back"><a onClick={() => setForgot(false)}>&lt; Voltar</a></p> : null}
          <div className="va-foot-tools"><LangPicker variant="topbar" /></div>
        </div>
      </div>
    </div>
  );
}

/**
 * «Abrir caixa» a partir do painel do gestor/gerente: o perfil já chega
 * identificado pela URL; pede-se APENAS o PIN. Sem escolher empresa nem digitar
 * o e-mail — entra direto na caixa com o próprio perfil. Bonito e responsivo.
 */
function OpenCashHandoff({ email, name }: { email: string; name: string }) {
  const { loginStaff } = useAuth();
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Foto do perfil: a guardada neste aparelho e, se não houver, a do servidor
  // (lista pública de operadores da empresa da URL, a mesma do ecrã de PIN).
  const [photo, setPhoto] = useState<string | null>(() => cachedPhoto(email));
  useEffect(() => {
    if (photo) return;
    const company = new URLSearchParams(window.location.search).get('empresa') ?? '';
    if (!company) return;
    let alive = true;
    const nm = (name || '').trim().toLowerCase();
    const local = email.split('@')[0].toLowerCase();
    api.operators(company).then((r) => {
      const op = r.operators.find((o) => o.name.trim().toLowerCase() === nm) ?? r.operators.find((o) => o.name.trim().toLowerCase() === local);
      if (alive && op?.photo_url) { setPhoto(op.photo_url); rememberPhoto(email, op.photo_url); }
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [email, name]); // eslint-disable-line react-hooks/exhaustive-deps
  const initials = (name || email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '?';

  const submit = async () => {
    setError(null);
    if (!/^\d{4,8}$/.test(pin)) { setError('Digite o seu PIN de 6 dígitos.'); return; }
    setLoading(true);
    try {
      await loginStaff(email, pin);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'PIN incorreto.');
      setPin('');
    } finally { setLoading(false); }
  };

  const otherAccount = () => { try { window.location.assign(window.location.pathname); } catch { /* */ } };

  return (
    <>
      <div className="handoff-card">
        {photo ? <img className="handoff-avatar" src={photo} alt="" style={{ objectFit: 'cover' }} /> : <div className="handoff-avatar" aria-hidden>{initials}</div>}
        <h1 className="va-h1" style={{ marginBottom: 2 }}>Abrir caixa</h1>
        <div className="handoff-name">{name || email}</div>
        {name ? <div className="handoff-email">{email}</div> : null}
      </div>

      {error ? <div className="auth-error">{error}</div> : null}

      <label className="auth-label">PIN da caixa</label>
      <PasswordField value={pin} onChange={setPin} placeholder="••••" digitsOnly
        inputMode="numeric" maxLength={8} autoComplete="off" onEnter={() => void submit()} />

      <button className="va-btn" onClick={() => void submit()} disabled={loading}>
        {loading ? 'A entrar…' : 'Entrar na caixa'}
      </button>

      <div className="auth-sublinks" style={{ justifyContent: 'center', marginTop: 14 }}>
        <a onClick={otherAccount}>Entrar com outra conta</a>
      </div>
    </>
  );
}

/** Pede o e-mail e envia o link de recuperação do PIN. */
/** "Recuperar PIN" dentro do cartão (como o "Recuperar Password" do Vendus). */
function ForgotPinView({ defaultEmail }: { defaultEmail?: string }) {
  const [email, setEmail] = useState(defaultEmail && /@/.test(defaultEmail) ? defaultEmail : '');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setWarn('Indica o teu e-mail.'); return; }
    setBusy(true); setWarn(null);
    try {
      const r = await api.forgotPin(email.trim().toLowerCase());
      if (!r.emailConfigured) setWarn('O envio de e-mail ainda não está configurado. Pede ao gestor para repor o teu PIN (Funcionários → Gerir acesso).');
      else setDone(true);
    } catch { setDone(true); }
    finally { setBusy(false); }
  };
  return (
    <>
      <h1 className="va-h1">Recuperar PIN</h1>
      {warn ? <div className="auth-error">{warn}</div> : null}
      {done ? (
        <div className="va-ok">Se existir uma conta com esse e-mail, enviámos um link para definir um novo PIN (válido 1 hora).</div>
      ) : (
        <>
          <label className="va-label" htmlFor="va-forgot-pin">E-Mail:</label>
          <input id="va-forgot-pin" className="va-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-Mail" inputMode="email" type="email"
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
          <button className="va-btn" onClick={() => void submit()} disabled={busy}>{busy ? 'A enviar…' : 'Recuperar PIN'}</button>
        </>
      )}
      <p className="va-muted">Receberá um e-mail do LPS Vendas com instruções para definir um novo PIN.</p>
    </>
  );
}

/** Define o novo PIN (6 dígitos) a partir do token do e-mail. */
function PinResetView({ token }: { token: string }) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const submit = async () => {
    setErr(null);
    if (!/^\d{6}$/.test(pin)) { setErr('O PIN tem de ter 6 dígitos.'); return; }
    if (pin !== confirm) { setErr('Os PIN não coincidem.'); return; }
    setBusy(true);
    try { await api.resetPin(token, pin); setOk(true); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível. Pede um novo link.'); }
    finally { setBusy(false); }
  };
  if (ok) {
    return (
      <div className="banner success">
        <div>PIN definido. Já podes <a style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 700 }} onClick={() => location.assign(location.pathname)}>entrar na caixa</a>.</div>
      </div>
    );
  }
  return (
    <>
      {err ? <div className="auth-error">{err}</div> : null}
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Define o teu novo PIN da caixa (6 dígitos).</p>
      <label className="auth-label">Novo PIN</label>
      <PasswordField value={pin} onChange={setPin} digitsOnly inputMode="numeric" maxLength={6} placeholder="••••••" />
      <label className="auth-label">Confirmar PIN</label>
      <PasswordField value={confirm} onChange={setConfirm} digitsOnly inputMode="numeric" maxLength={6} placeholder="••••••" />
      <button className="auth-btn" onClick={() => void submit()} disabled={busy}>{busy ? 'A guardar…' : 'Definir PIN'}</button>
    </>
  );
}
