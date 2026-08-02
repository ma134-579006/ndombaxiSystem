import React, { useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { LoginShowcase } from '../components/LoginShowcase';
import { PasswordField } from '../components/PasswordField';
import { ScreenKeyboard } from '../components/ScreenKeyboard';
import { nativeGoogleAvailable, nativeGoogleSignIn } from '../offline/nativeGoogle';

/**
 * Login da CAIXA — mesmo design escuro do gestor. O FUNCIONÁRIO entra com o seu
 * e-mail + PIN num único ecrã; o sistema descobre a empresa e a loja a que
 * pertence (sem escolher empresa nem operador). Google mantém a mesma lógica.
 */
export function LoginPage() {
  const { loginStaff, loginGoogle } = useAuth();
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

  const onGoogle = async (idToken: string) => {
    setError(null); setLoading(true);
    try { await loginGoogle(idToken); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível entrar com Google.'); }
    finally { setLoading(false); }
  };

  // App instalada: Google NATIVO (o botão web não funciona em WebView).
  const onGoogleNative = async () => {
    setError(null);
    if (!nativeGoogleAvailable()) {
      setError('Entrar com Google ainda não está disponível nesta versão da app. Atualize para a versão mais recente.');
      return;
    }
    setLoading(true);
    try {
      const idToken = await nativeGoogleSignIn();
      if (idToken) await loginGoogle(idToken);
      else setError('Entrada com Google cancelada.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível entrar com Google.');
    } finally { setLoading(false); }
  };

  // Site (navegador) vs app; e app MÓVEL (Capacitor) vs DESKTOP (Electron). O
  // Google nativo só existe no móvel; no desktop o OAuth é outro fluxo (à parte).
  const nw = window as unknown as {
    ndombaxi?: unknown; __NDOMBAXI_NATIVE__?: boolean;
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  const isNativeApp = window.location.protocol === 'ndombaxi:'
    || typeof nw.ndombaxi !== 'undefined'
    || nw.__NDOMBAXI_NATIVE__ === true
    || !!nw.Capacitor?.isNativePlatform?.();
  // "Móvel" = app nativa E não-desktop. NÃO dependemos de window.Capacitor (nem
  // sempre chega ao frontend na app); o desktop expõe window.ndombaxi, o móvel não.
  const isDesktopApp = window.location.protocol === 'ndombaxi:' || typeof nw.ndombaxi !== 'undefined';
  const isMobileApp = isNativeApp && !isDesktopApp;

  return (
    <div className="auth">
      <ScreenKeyboard />
      <div className="auth-panel">
        <div className="auth-form">
          {resetToken ? (
            <>
              <h1 className="auth-title">Novo PIN</h1>
              <PinResetView token={resetToken} />
            </>
          ) : handoff ? (
            <OpenCashHandoff email={handoff.email} name={handoff.name} />
          ) : (
            <>
              <h1 className="auth-title">Entrar na Caixa</h1>
              {error ? <div className="auth-error">{error}</div> : null}

              <label className="auth-label">E-mail do funcionário</label>
              <input className="auth-input" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.ao" inputMode="email" type="text"
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                name="ndx_field_acct" id="ndx_field_acct"
                data-lpignore="true" data-1p-ignore data-form-type="other" data-bwignore="true"
                readOnly={emailRO} onFocus={() => setEmailRO(false)} onPointerDown={() => setEmailRO(false)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />

              <label className="auth-label">PIN</label>
              <PasswordField value={pin} onChange={setPin} placeholder="••••" digitsOnly
                inputMode="numeric" maxLength={8} autoComplete="off" onEnter={() => void submit()} />

              <div className="auth-sublinks">
                <label className="auth-remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Lembrar-me</label>
                <a onClick={() => setForgot(true)}>Esqueci o PIN</a>
              </div>

              <button className="auth-btn" onClick={() => void submit()} disabled={loading}>
                {loading ? 'A entrar…' : 'Entrar'}
              </button>

              {/* Google: no SITE o botão web (GIS); na app MÓVEL o botão nativo
                  (o GIS não funciona em WebView); no DESKTOP nada por agora. */}
              {!isNativeApp ? (
                <>
                  <div className="auth-or"><span>ou</span></div>
                  <div className="auth-google"><GoogleSignInButton onCredential={(t) => void onGoogle(t)} /></div>
                </>
              ) : isMobileApp ? (
                <>
                  <div className="auth-or"><span>ou</span></div>
                  <button type="button" onClick={() => void onGoogleNative()} disabled={loading}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, height: 46, borderRadius: 999, border: '1px solid #dadce0', background: '#fff', color: '#3c4043', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.9 6.1 29.7 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 18.9 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.9 6.1 29.7 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.6 0 10.7-2.1 14.6-5.6l-6.7-5.7C29.8 34.6 27 36 24 36c-5.2 0-9.6-3.3-11.2-8l-6.6 5.1C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.7 5.7c-.5.4 7.1-5.2 7.1-15.3 0-1.3-.1-2.3-.4-3.5z"/></svg>
                    Continuar com Google
                  </button>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
      <div className="auth-media"><LoginShowcase /></div>
      {forgot ? <ForgotPinModal defaultEmail={email} onClose={() => setForgot(false)} /> : null}
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
  const initials = (name || email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '👤';

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
        <div className="handoff-avatar" aria-hidden>{initials}</div>
        <h1 className="auth-title" style={{ marginBottom: 2 }}>Abrir caixa</h1>
        <div className="handoff-name">{name || email}</div>
        {name ? <div className="handoff-email">{email}</div> : null}
      </div>

      {error ? <div className="auth-error">{error}</div> : null}

      <label className="auth-label">PIN da caixa</label>
      <PasswordField value={pin} onChange={setPin} placeholder="••••" digitsOnly
        inputMode="numeric" maxLength={8} autoComplete="off" onEnter={() => void submit()} />

      <button className="auth-btn" onClick={() => void submit()} disabled={loading} style={{ marginTop: 14 }}>
        {loading ? 'A entrar…' : 'Entrar na caixa'}
      </button>

      <div className="auth-sublinks" style={{ justifyContent: 'center', marginTop: 14 }}>
        <a onClick={otherAccount}>Entrar com outra conta</a>
      </div>
    </>
  );
}

/** Pede o e-mail e envia o link de recuperação do PIN. */
function ForgotPinModal({ defaultEmail, onClose }: { defaultEmail?: string; onClose(): void }) {
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
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="mh"><h3>Recuperar PIN</h3><span className="spacer" /><button className="btn sm ghost" onClick={onClose}>Fechar</button></div>
        <div className="mb">
          {done ? (
            <div className="banner success"><div>Se existir uma conta com esse e-mail, enviámos um link para definires um novo PIN. Vê a tua caixa de entrada.</div></div>
          ) : (
            <>
              {warn ? <div className="banner danger" style={{ marginBottom: 12 }}>{warn}</div> : null}
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Escreve o teu e-mail. Enviamos um link (1 hora) para definires um novo PIN.</p>
              <div className="field"><label>E-mail</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@empresa.ao" inputMode="email" /></div>
              <button className="btn lg block" onClick={() => void submit()} disabled={busy}>{busy ? 'A enviar…' : 'Enviar link'}</button>
            </>
          )}
        </div>
      </div>
    </div>
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
        <div>✅ PIN definido. Já podes <a style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 700 }} onClick={() => location.assign(location.pathname)}>entrar na caixa</a>.</div>
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
