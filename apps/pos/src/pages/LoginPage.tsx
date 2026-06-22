import React, { useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { LoginShowcase } from '../components/LoginShowcase';
import { PasswordField } from '../components/PasswordField';

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

  const submit = async () => {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Indica o teu e-mail de funcionário.'); return; }
    if (!/^\d{4,8}$/.test(pin)) { setError('Digite o PIN (4 a 8 dígitos).'); return; }
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

  return (
    <div className="auth">
      <div className="auth-panel">
        <div className="auth-form">
          {resetToken ? (
            <>
              <h1 className="auth-title">Novo PIN</h1>
              <PinResetView token={resetToken} />
            </>
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

              <div className="auth-or"><span>ou</span></div>
              <div className="auth-google"><GoogleSignInButton onCredential={(t) => void onGoogle(t)} /></div>
            </>
          )}
        </div>
      </div>
      <div className="auth-media"><LoginShowcase /></div>
      {forgot ? <ForgotPinModal defaultEmail={email} onClose={() => setForgot(false)} /> : null}
    </div>
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
