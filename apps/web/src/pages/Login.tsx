import React, { useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { LoginShowcase } from '../components/LoginShowcase';
import { CAIXA_URL } from '../config';

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
  const [email, setEmail] = useState('');
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

  /** Entra discernindo o perfil: 1) tenta como empresa (gestor) pelo e-mail;
   *  2) se não houver empresa, tenta como super admin (plataforma). */
  const submit = async (companyCode?: string) => {
    setError(null); setChoices(null);
    if (!email.trim() || !password) { setError('Indica o e-mail e a palavra-passe.'); return; }
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

  const openCaixa = () => window.location.assign(`${CAIXA_URL}/`);

  return (
    <div className="auth">
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
                    placeholder="exemplo@empresa.ao" inputMode="email" autoComplete="username"
                    onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />

                  <label className="auth-label">Senha</label>
                  <input className="auth-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••" autoComplete="current-password"
                    onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />

                  {show2fa ? (
                    <>
                      <label className="auth-label">Código 2FA</label>
                      <input className="auth-input" value={twoFa} onChange={(e) => setTwoFa(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000" inputMode="numeric" maxLength={6}
                        onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
                    </>
                  ) : null}

                  <div className="auth-sublinks">
                    {!show2fa ? <a onClick={() => setShow2fa(true)}>Tenho código 2FA</a> : <span />}
                    <a onClick={() => setForgot(true)}>Esqueci a senha</a>
                  </div>

                  <button className="auth-btn" onClick={() => void submit()} disabled={loading}>
                    {loading ? 'A entrar…' : 'Entrar'}
                  </button>

                  <a className="auth-caixa" onClick={openCaixa}>Entrar na Caixa (terminal de venda) →</a>

                  <div className="auth-or"><span>ou</span></div>
                  <div className="auth-google"><GoogleSignInButton onCredential={(t) => void onGoogle(t)} /></div>

                  {onRegister ? (
                    <p className="auth-foot">Ainda não tem conta? <a onClick={onRegister}>Criar conta</a></p>
                  ) : null}
                  {onBack ? <p className="auth-foot"><a onClick={onBack}>← Voltar à página inicial</a></p> : null}
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
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="mh"><h3>Recuperar senha</h3><span className="spacer" /><button className="btn sm ghost" onClick={onClose}>Fechar</button></div>
        <div className="mb">
          {done ? (
            <div className="banner success"><div>Se existir uma conta com esse e-mail, enviámos um link para repor a senha. Verifica a tua caixa de entrada (e o spam).</div></div>
          ) : (
            <>
              {warn ? <div className="banner danger" style={{ marginBottom: 12 }}>{warn}</div> : null}
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Escreve o teu e-mail. Enviamos um link (válido 1 hora) para definires uma nova senha.</p>
              <div className="field"><label>E-mail</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="exemplo@empresa.ao" inputMode="email" /></div>
              <button className="btn lg block" onClick={() => void submit()} disabled={busy}>{busy ? 'A enviar…' : 'Enviar link de recuperação'}</button>
            </>
          )}
        </div>
      </div>
    </div>
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
      <input className="auth-input" type={isPin ? 'text' : 'password'} inputMode={isPin ? 'numeric' : undefined} maxLength={isPin ? 6 : undefined}
        value={secret} onChange={(e) => setSecret(isPin ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value)} placeholder={isPin ? '000000' : '••••••••'} />
      <label className="auth-label">Confirmar</label>
      <input className="auth-input" type={isPin ? 'text' : 'password'} inputMode={isPin ? 'numeric' : undefined} maxLength={isPin ? 6 : undefined}
        value={confirm} onChange={(e) => setConfirm(isPin ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value)} placeholder={isPin ? '000000' : '••••••••'} />
      <button className="auth-btn" onClick={() => void submit()} disabled={busy}>{busy ? 'A guardar…' : `Definir ${isPin ? 'PIN' : 'senha'}`}</button>
    </>
  );
}
