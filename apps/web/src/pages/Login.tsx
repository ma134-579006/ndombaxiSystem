import React, { useMemo, useState } from 'react';
import { Button, Dialog } from '@nexus/ui';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { LoginShowcase } from '../components/LoginShowcase';
import { PasswordField } from '../components/PasswordField';
import { ScreenKeyboard } from '../components/ScreenKeyboard';
import { openCaixaTerminal } from '../config';
import { nativeGoogleAvailable, nativeGoogleSignIn } from '../nativeGoogle';

/** Lista de empresas devolvida quando o e-mail existe em várias. */
interface CompanyChoice { code: string; name: string }
function choicesFrom(e: unknown): CompanyChoice[] | null {
  if (e instanceof ApiError && e.data && typeof e.data === 'object') {
    const d = e.data as { error?: string; companies?: CompanyChoice[] };
    if (d.error === 'ChooseCompany' && Array.isArray(d.companies) && d.companies.length) return d.companies;
  }
  return null;
}

/**
 * Login ÚNICO (escuro, fixo): gestor de empresa E super admin entram no mesmo
 * formulário — o sistema descobre sozinho quem é (tenta empresa pelo e-mail e,
 * se não for, tenta plataforma). Sem escolher perfil. A Caixa abre-se por um
 * link próprio. Vídeo enterprise à direita.
 */
export function Login({ onBack, onRegister }: { onBack?: () => void; onRegister?: () => void }) {
  const { loginTenant, loginPlatform, loginGoogle } = useAuth();
  const resetToken = useMemo(() => {
    const p = new URLSearchParams(location.search);
    return p.get('k') !== 'pin' ? p.get('reset') : null;
  }, []);
  const [forgot, setForgot] = useState(false);
  const [email, setEmail] = useState(() => { try { return localStorage.getItem('ndx:remember_email') ?? ''; } catch { return ''; } });
  const [remember, setRemember] = useState(() => { try { return !!localStorage.getItem('ndx:remember_email'); } catch { return false; } });
  const [emailRO, setEmailRO] = useState(true); // anti-autofill (editável após focar)
  const [password, setPassword] = useState('');
  const [twoFa, setTwoFa] = useState('');
  const [show2fa, setShow2fa] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<CompanyChoice[] | null>(null);
  const [pending, setPending] = useState<{ kind: 'password' | 'google'; idToken?: string } | null>(null);

  const onGoogle = async (idToken: string, companyCode?: string) => {
    setError(null); setLoading(true);
    try {
      await loginGoogle(idToken, companyCode);
    } catch (e) {
      const c = choicesFrom(e);
      if (c) { setChoices(c); setPending({ kind: 'google', idToken }); return; }
      setError(e instanceof ApiError ? e.message : 'Não foi possível entrar com Google.');
    } finally { setLoading(false); }
  };

  // App instalada: Google NATIVO (o botão web GIS não funciona em WebView).
  const onGoogleNative = async () => {
    setError(null);
    if (!nativeGoogleAvailable()) {
      setError('Entrar com Google ainda não está disponível nesta versão da app. Atualize para a versão mais recente.');
      return;
    }
    setLoading(true);
    try {
      const idToken = await nativeGoogleSignIn();
      if (idToken) await onGoogle(idToken);
      else setError('Entrada com Google cancelada.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível entrar com Google.');
    } finally { setLoading(false); }
  };

  /** Entra discernindo o perfil: 1) tenta como empresa (gestor) pelo e-mail;
   *  2) se não houver empresa, tenta como super admin (plataforma). */
  const submit = async (companyCode?: string) => {
    setError(null); setChoices(null);
    if (!email.trim() || !password) { setError('Indica o e-mail e a palavra-passe.'); return; }
    // "Lembrar-me": guarda só o e-mail (nunca a senha) para pré-preencher.
    try { if (remember) localStorage.setItem('ndx:remember_email', email.trim()); else localStorage.removeItem('ndx:remember_email'); } catch { /* storage indisponível */ }
    setLoading(true);
    const twoFaToken = twoFa.trim() || undefined;
    try {
      await loginTenant({ companyCode, email: email.trim(), password, twoFaToken });
    } catch (e) {
      const c = choicesFrom(e);
      if (c) { setChoices(c); setPending({ kind: 'password' }); setLoading(false); return; }
      try {
        await loginPlatform({ email: email.trim(), password, twoFaToken });
      } catch {
        setError(e instanceof ApiError ? e.message : 'E-mail ou palavra-passe incorretos.');
      }
    } finally { setLoading(false); }
  };

  const pickCompany = async (code: string) => {
    setChoices(null);
    if (pending?.kind === 'google' && pending.idToken) await onGoogle(pending.idToken, code);
    else await submit(code);
    setPending(null);
  };

  const openCaixa = () => openCaixaTerminal();

  // App instalada (Android/desktop): a Caixa é outra app, "voltar à landing" não
  // faz sentido e "criar conta" abre o site no NAVEGADOR do sistema. No site
  // (navegador) mantém-se tudo como antes.
  const nw = window as unknown as {
    ndombaxi?: unknown; __NDOMBAXI_NATIVE__?: boolean;
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  const isNativeApp = window.location.protocol === 'ndombaxi:'
    || typeof nw.ndombaxi !== 'undefined'
    || nw.__NDOMBAXI_NATIVE__ === true
    || !!nw.Capacitor?.isNativePlatform?.();
  // App MÓVEL (Android/iOS) vs DESKTOP (Electron). NÃO dependemos de
  // `window.Capacitor` para isto: esse global nem sempre chega ao frontend dentro
  // da app (é por isso que a app usa a bandeira __NDOMBAXI_NATIVE__ para se
  // detetar). O DESKTOP expõe `window.ndombaxi` (ponte do Electron); o móvel não.
  // Logo "móvel" = é app nativa E não é desktop — assim o botão Google aparece no
  // Android/iOS de forma fiável. No desktop o OAuth do Google é outro fluxo.
  const isDesktopApp = window.location.protocol === 'ndombaxi:' || typeof nw.ndombaxi !== 'undefined';
  const isMobileApp = isNativeApp && !isDesktopApp;
  const openSignupInBrowser = () => window.open('https://ndombaxisystem.com/', '_blank');

  return (
    <div className="auth">
      <ScreenKeyboard />
      <div className="auth-panel">
        <div className="auth-form">
          {resetToken ? (
            <>
              <h1 className="auth-title">Nova palavra-passe</h1>
              <ResetView token={resetToken} kind="pw" />
            </>
          ) : (
            <>
              <h1 className="auth-title">Inicie sessão</h1>

              {error ? <div className="auth-error">{error}</div> : null}

              {choices ? (
                <div className="auth-choices">
                  <p>Este e-mail existe em várias empresas — escolhe:</p>
                  {choices.map((c) => (
                    <button key={c.code} className="auth-choice" onClick={() => void pickCompany(c.code)} disabled={loading}>{c.name}</button>
                  ))}
                </div>
              ) : (
                <>
                  <label className="auth-label">E-mail</label>
                  <input className="auth-input" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="exemplo@empresa.ao" inputMode="email" type="text"
                    autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                    name="ndx_field_acct" id="ndx_field_acct"
                    data-lpignore="true" data-1p-ignore data-form-type="other" data-bwignore="true"
                    readOnly={emailRO} onFocus={() => setEmailRO(false)} onPointerDown={() => setEmailRO(false)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />

                  <label className="auth-label">Senha</label>
                  <PasswordField value={password} onChange={setPassword} placeholder="••••••••"
                    autoComplete="off" onEnter={() => void submit()} />

                  {show2fa ? (
                    <>
                      <label className="auth-label">Código 2FA</label>
                      <input className="auth-input" value={twoFa} onChange={(e) => setTwoFa(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000" inputMode="numeric" maxLength={6}
                        onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
                    </>
                  ) : null}

                  <div className="auth-sublinks">
                    <label className="auth-remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Lembrar-me</label>
                    <a onClick={() => setForgot(true)}>Esqueci a senha</a>
                  </div>
                  {!show2fa ? <a className="auth-2fa-link" onClick={() => setShow2fa(true)}>Tenho código 2FA</a> : null}

                  <button className="auth-btn" onClick={() => void submit()} disabled={loading}>
                    {loading ? 'A entrar…' : 'Entrar'}
                  </button>

                  {/* "Entrar na Caixa" só no site: na app a Caixa é outra app. */}
                  {!isNativeApp ? <a className="auth-caixa" onClick={openCaixa}>Entrar na Caixa (terminal de venda) →</a> : null}

                  {/* Google: no SITE o botão web (GIS); na app MÓVEL o botão
                      nativo (o GIS não funciona em WebView); no DESKTOP nada por
                      agora (evita um "ou" órfão sem botão). */}
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

                  {/* Criar conta: no site abre o registo interno; na app abre o
                      landing no NAVEGADOR do sistema (o registo é no site). */}
                  {isNativeApp ? (
                    <p className="auth-foot">Ainda não tem conta? <a onClick={openSignupInBrowser}>Criar conta</a></p>
                  ) : onRegister ? (
                    <p className="auth-foot">Ainda não tem conta? <a onClick={onRegister}>Criar conta</a></p>
                  ) : null}
                  {/* "Voltar à página inicial" só no site (na app não há landing). */}
                  {onBack && !isNativeApp ? <p className="auth-foot"><a onClick={onBack}>← Voltar à página inicial</a></p> : null}
                </>
              )}
            </>
          )}
        </div>
      </div>
      <div className="auth-media"><LoginShowcase /></div>
      {forgot ? <ForgotModal onClose={() => setForgot(false)} /> : null}
    </div>
  );
}

/** Pede o e-mail e envia o link de recuperação da senha. */
function ForgotModal({ onClose }: { onClose(): void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setWarn('Indica um e-mail válido.'); return; }
    setBusy(true); setWarn(null);
    try {
      const r = await api.forgotPassword(email.trim().toLowerCase());
      if (!r.emailConfigured) setWarn('O envio de e-mail ainda não está configurado. Pede ao administrador para repor a tua senha.');
      else setDone(true);
    } catch { setDone(true); }
    finally { setBusy(false); }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Recuperar senha"
      size="sm"
      footer={
        done ? undefined : (
          <Button variant="primary" size="lg" block loading={busy} onClick={() => void submit()}>
            {busy ? 'A enviar…' : 'Enviar link de recuperação'}
          </Button>
        )
      }
    >
      {done ? (
        <div className="banner success" role="status">
          <div>Se existir uma conta com esse e-mail, enviámos um link para repor a senha. Verifica a tua caixa de entrada (e o spam).</div>
        </div>
      ) : (
        <>
          {warn ? <div className="banner danger" role="alert">{warn}</div> : null}
          <p className="nx-body-sm" style={{ color: 'var(--nx-c-text-muted)', margin: 0 }}>
            Escreve o teu e-mail. Enviamos um link (válido 1 hora) para definires uma nova senha.
          </p>
          <div className="field">
            <label htmlFor="recover-email">E-mail</label>
            <input id="recover-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="exemplo@empresa.ao" inputMode="email" />
          </div>
        </>
      )}
    </Dialog>
  );
}

/** Define a nova senha (ou PIN) a partir do token do e-mail. */
export function ResetView({ token, kind }: { token: string; kind: 'pw' | 'pin' }) {
  const [secret, setSecret] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const isPin = kind === 'pin';
  const submit = async () => {
    setErr(null);
    if (isPin ? !/^\d{6}$/.test(secret) : secret.length < 6) { setErr(isPin ? 'O PIN tem de ter 6 dígitos.' : 'A senha tem de ter pelo menos 6 caracteres.'); return; }
    if (secret !== confirm) { setErr('Os campos não coincidem.'); return; }
    setBusy(true);
    try { await api.resetPassword(token, secret); setOk(true); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível repor. Pede um novo link.'); }
    finally { setBusy(false); }
  };
  if (ok) {
    return (
      <div className="banner success">
        <div>✅ {isPin ? 'PIN' : 'Senha'} definido(a). Já podes <a style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 700 }} onClick={() => location.assign(location.pathname)}>entrar</a>.</div>
      </div>
    );
  }
  return (
    <>
      {err ? <div className="auth-error">{err}</div> : null}
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Define a tua nova {isPin ? 'PIN da caixa (6 dígitos)' : 'palavra-passe'}.</p>
      <label className="auth-label">{isPin ? 'Novo PIN' : 'Nova senha'}</label>
      <PasswordField value={secret} onChange={setSecret} placeholder={isPin ? '000000' : '••••••••'}
        digitsOnly={isPin} inputMode={isPin ? 'numeric' : undefined} maxLength={isPin ? 6 : undefined} />
      <label className="auth-label">Confirmar</label>
      <PasswordField value={confirm} onChange={setConfirm} placeholder={isPin ? '000000' : '••••••••'}
        digitsOnly={isPin} inputMode={isPin ? 'numeric' : undefined} maxLength={isPin ? 6 : undefined} />
      <button className="auth-btn" onClick={() => void submit()} disabled={busy}>{busy ? 'A guardar…' : `Definir ${isPin ? 'PIN' : 'senha'}`}</button>
    </>
  );
}
