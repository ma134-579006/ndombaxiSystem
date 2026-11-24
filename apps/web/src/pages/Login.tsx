import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { LOGO_WIDE } from '../brand';
import { useAuth } from '../auth/AuthContext';
import { PasswordField } from '../components/PasswordField';
import { openCaixaTerminal } from '../config';
import { LangPicker } from '../components/LangPicker';
import {
  appKind, btnStyle, FacebookSquare, facebookToken, GoogleGlyph, googleToken, lookVars, useAuthPublic, usePreloadSocial, useFitHeight,
} from './vendusAuth';

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
 * Login ÚNICO no estilo Vendus (fundo claro, cartão branco, botão em pílula,
 * "Ou", Google e Facebook): gestor de empresa E super admin entram no mesmo
 * formulário — o sistema descobre sozinho quem é. Cores, textos e botões
 * sociais vêm do Super Admin (Login & Registo).
 */
export function Login({ onBack, onRegister }: { onBack?: () => void; onRegister?: () => void }) {
  const { loginTenant, loginPlatform, loginGoogle, loginFacebook } = useAuth();
  const pub = useAuthPublic();
  const fitRef = useFitHeight<HTMLDivElement>();
  const look = pub?.look;
  usePreloadSocial(pub?.facebookAppId ?? null);
  const resetToken = useMemo(() => {
    const p = new URLSearchParams(location.search);
    return p.get('k') !== 'pin' ? p.get('reset') : null;
  }, []);
  const [forgot, setForgot] = useState(false);
  const [email, setEmail] = useState(() => { try { return localStorage.getItem('ndx:remember_email') ?? ''; } catch { return ''; } });
  const [emailRO, setEmailRO] = useState(true); // anti-autofill (editável após focar)
  const [password, setPassword] = useState('');
  const [twoFa, setTwoFa] = useState('');
  const [show2fa, setShow2fa] = useState(false);
  /** Código pedido pelo servidor (2FA por e-mail/WhatsApp): canal e destino mascarado. */
  const [sentTo, setSentTo] = useState<{ channel: string; to: string } | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [, tickResend] = useState(0);
  useEffect(() => { if (!sentTo) return; const t = window.setInterval(() => tickResend((n) => n + 1), 1000); return () => window.clearInterval(t); }, [sentTo]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<CompanyChoice[] | null>(null);
  const [pending, setPending] = useState<{ kind: 'password' | 'google' | 'facebook'; token?: string } | null>(null);

  const social = async (kind: 'google' | 'facebook', token: string, companyCode?: string) => {
    setError(null); setLoading(true);
    try {
      if (kind === 'google') await loginGoogle(token, companyCode);
      else await loginFacebook(token, companyCode);
    } catch (e) {
      const c = choicesFrom(e);
      if (c) { setChoices(c); setPending({ kind, token }); return; }
      setError(e instanceof ApiError ? e.message : `Não foi possível entrar com ${kind === 'google' ? 'Google' : 'Facebook'}.`);
    } finally { setLoading(false); }
  };

  const startSocial = async (kind: 'google' | 'facebook') => {
    setError(null);
    try {
      const t = kind === 'google' ? await googleToken() : await facebookToken(pub?.facebookAppId ?? null);
      if (t) await social(kind, t);
      else setError(`Entrada com ${kind === 'google' ? 'Google' : 'Facebook'} cancelada.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível entrar.');
    }
  };

  /** Entra discernindo o perfil: 1) tenta como empresa (gestor) pelo e-mail;
   *  2) se não houver empresa, tenta como super admin (plataforma). */
  const submit = async (companyCode?: string, resend = false) => {
    setError(null); setChoices(null);
    const mail = email.trim().toLowerCase();
    if (!mail || !password) { setError('Indica o e-mail e a password.'); return; }
    if (!/^\S+@\S+\.\S+$/.test(mail)) { setError('E-mail inválido.'); return; }
    try { if (localStorage.getItem('ndx:remember_email')) localStorage.setItem('ndx:remember_email', mail); } catch { /* storage indisponível */ }
    setLoading(true);
    const twoFaToken = resend ? undefined : (twoFa.trim() || undefined);
    // O servidor pediu o código da verificação em 2 passos (enviado por e-mail ou WhatsApp).
    const askCode = (e: unknown) => {
      const d = e instanceof ApiError ? (e.data as { error?: string; channel?: string; to?: string } | undefined) : undefined;
      if (d?.error !== 'TwoFaRequired') return false;
      setSentTo({ channel: d.channel ?? 'EMAIL', to: d.to ?? '' }); setShow2fa(true); setTwoFa(''); setResendAt(Date.now() + 30_000);
      return true;
    };
    try {
      await loginTenant({ companyCode, email: mail, password, twoFaToken, twoFaResend: resend || undefined });
    } catch (e) {
      const c = choicesFrom(e);
      if (c) { setChoices(c); setPending({ kind: 'password' }); setLoading(false); return; }
      if (askCode(e)) return;
      if (e instanceof ApiError && e.status === 401 && (e.data as { error?: string } | undefined)?.error === 'TwoFaInvalid') { setError(e.message); return; }
      try {
        await loginPlatform({ email: mail, password, twoFaToken, twoFaResend: resend || undefined });
      } catch (pe) {
        if (askCode(pe)) return;
        if (pe instanceof ApiError && (pe.data as { error?: string } | undefined)?.error === 'TwoFaInvalid') { setError(pe.message); return; }
        setError(e instanceof ApiError ? e.message : 'E-mail ou password incorretos.');
      }
    } finally { setLoading(false); }
  };

  const pickCompany = async (code: string) => {
    setChoices(null);
    if (pending && pending.kind !== 'password' && pending.token) await social(pending.kind, pending.token, code);
    else await submit(code);
    setPending(null);
  };

  // App instalada: a Caixa é outra app, não há "voltar ao site" e "criar conta"
  // abre o site no NAVEGADOR do sistema. O Facebook só existe no site.
  const k = appKind();
  const openSignupInBrowser = () => window.open('https://lpsvendas.com.de/', '_blank');
  const g = look?.google; const f = look?.facebook;
  const showGoogle = g?.enabled !== false;
  const showFacebook = f?.enabled !== false && !k.native;

  return (
    <div className="va" style={lookVars(look)}>
      <div className="va-login">
        <div className="va-col" ref={fitRef}>
          <a onClick={onBack && !k.native ? onBack : undefined} aria-label="LPS Vendas">
            <img className="va-logo" src={LOGO_WIDE} alt="LPS Vendas" />
          </a>
          <div className="va-card">
            {resetToken ? (
              <>
                <h1 className="va-h1">Nova Password</h1>
                <ResetView token={resetToken} kind="pw" />
              </>
            ) : forgot ? (
              <ForgotView initialEmail={email} />
            ) : (
              <>
                <div className="va-card-gap" />
                {error ? <div className="va-error" role="alert">{error}</div> : null}
                {choices ? (
                  <div className="va-choices">
                    <p>Este e-mail existe em várias empresas — escolhe:</p>
                    {choices.map((c) => (
                      <button key={c.code} className="va-choice" onClick={() => void pickCompany(c.code)} disabled={loading}>{c.name}</button>
                    ))}
                  </div>
                ) : (
                  <>
                    <label className="va-label" htmlFor="ndx_field_acct">E-Mail:</label>
                    <input className="va-input" value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder="E-Mail" inputMode="email" type="text"
                      autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                      name="ndx_field_acct" id="ndx_field_acct"
                      data-lpignore="true" data-1p-ignore data-form-type="other" data-bwignore="true"
                      readOnly={emailRO} onFocus={() => setEmailRO(false)} onPointerDown={() => setEmailRO(false)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />

                    <div className="va-row va-mt">
                      <label className="va-label" htmlFor="ndx_field_secret">Password:</label>
                      <a className="va-label va-link-sm" onClick={() => setForgot(true)}>Recuperar Password</a>
                    </div>
                    <PasswordField id="ndx_field_secret" value={password} onChange={setPassword} placeholder="Password"
                      autoComplete="off" onEnter={() => void submit()} inputClass="va-input" wrapClass="va-pass" />

                    {show2fa ? (
                      <div className="va-2fa">
                        {sentTo ? (
                          <div className="va-2fa-h">
                            <span aria-hidden>{sentTo.channel === 'WHATSAPP' ? <WaGlyph /> : <MailGlyph />}</span>
                            <span><b>Verificação em 2 passos</b><small>Código enviado {sentTo.channel === 'WHATSAPP' ? 'por WhatsApp' : 'por e-mail'} para {sentTo.to}</small></span>
                          </div>
                        ) : <label className="va-label">Código 2FA:</label>}
                        <input className="va-input" value={twoFa} onChange={(e) => setTwoFa(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="000000" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus={!!sentTo}
                          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
                        {sentTo ? (
                          <button type="button" className="va-2fa-resend" disabled={loading || Date.now() < resendAt} onClick={() => void submit(undefined, true)}>
                            {Date.now() < resendAt ? `Reenviar código (${Math.ceil((resendAt - Date.now()) / 1000)} s)` : 'Reenviar código'}
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    <button className="va-btn" onClick={() => void submit()} disabled={loading}>
                      {loading ? 'A entrar…' : 'Iniciar Sessão'}
                    </button>
                    {k.native ? (
                      <p className="va-center">Não tem uma conta? <a onClick={openSignupInBrowser}>Criar Conta</a></p>
                    ) : onRegister ? (
                      <p className="va-center">Não tem uma conta? <a onClick={onRegister}>Criar Conta</a></p>
                    ) : null}
                  </>
                )}
              </>
            )}
          </div>

          {!resetToken && !forgot && (showGoogle || showFacebook) ? (
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

          {forgot || resetToken ? (
            <p className="va-back">Fazer <a onClick={() => { setForgot(false); if (resetToken) location.assign(location.pathname); }}>Login</a>{onRegister && !k.native ? <> ou <a onClick={onRegister}>Criar Conta</a></> : null}</p>
          ) : onBack && !k.native ? (
            <p className="va-back"><a onClick={onBack}>&lt; Voltar ao Site</a></p>
          ) : null}
          <div className="va-foot-tools">
            {!k.native ? <a onClick={() => openCaixaTerminal()}>Entrar na Caixa</a> : null}
            <LangPicker variant="topbar" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Recuperar Password" (igual à página do Vendus): pede o e-mail e envia o link. */
function ForgotView({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setWarn('Indica um e-mail válido.'); return; }
    setBusy(true); setWarn(null);
    try {
      const r = await api.forgotPassword(email.trim().toLowerCase());
      if (!r.emailConfigured) setWarn('O envio de e-mail ainda não está configurado. Pede ao administrador para repor a tua password.');
      else setDone(true);
    } catch { setDone(true); }
    finally { setBusy(false); }
  };
  return (
    <>
      <h1 className="va-h1">Recuperar Password</h1>
      {warn ? <div className="va-error">{warn}</div> : null}
      {done ? (
        <div className="va-ok">Se existir uma conta com esse e-mail, enviámos um link para definir uma nova Password (válido 1 hora).</div>
      ) : (
        <>
          <label className="va-label" htmlFor="va-forgot">E-Mail:</label>
          <input id="va-forgot" className="va-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-Mail" inputMode="email" type="email"
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
          <button className="va-btn" onClick={() => void submit()} disabled={busy}>{busy ? 'A enviar…' : 'Recuperar Password'}</button>
        </>
      )}
      <p className="va-muted">Receberá um e-mail do LPS Vendas com instruções para definir uma nova Password.</p>
    </>
  );
}

/** Define a nova senha (ou PIN) a partir do token do e-mail. */
export function ResetView({ token, kind }: { token: string; kind: 'pw' | 'pin' }) {
  const [secret, setSecret] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<{ channel: string; to: string } | null>(null);
  const isPin = kind === 'pin';
  const submit = async (resend = false) => {
    setErr(null);
    if (isPin ? !/^\d{6}$/.test(secret) : secret.length < 6) { setErr(isPin ? 'O PIN tem de ter 6 dígitos.' : 'A senha tem de ter pelo menos 6 caracteres.'); return; }
    if (secret !== confirm) { setErr('Os campos não coincidem.'); return; }
    setBusy(true);
    try { await api.resetPassword(token, secret, resend ? undefined : (code || undefined), resend || undefined); setOk(true); }
    catch (e) {
      const d = e instanceof ApiError ? (e.data as { error?: string; channel?: string; to?: string } | undefined) : undefined;
      if (d?.error === 'TwoFaRequired') { setSentTo({ channel: d.channel ?? 'EMAIL', to: d.to ?? '' }); setCode(''); }
      else setErr(e instanceof ApiError ? e.message : 'Não foi possível repor. Pede um novo link.');
    }
    finally { setBusy(false); }
  };
  if (ok) {
    return (
      <div className="banner success">
        <div>{isPin ? 'PIN' : 'Senha'} definido(a). Já podes <a style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 700 }} onClick={() => location.assign(location.pathname)}>entrar</a>.</div>
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
      {sentTo ? (
        <div className="auth-2fa sent">
          <div className="auth-2fa-h">
            <span className="auth-2fa-ic" aria-hidden>{sentTo.channel === 'WHATSAPP' ? <WaGlyph /> : <MailGlyph />}</span>
            <span><b>Verificação em 2 passos</b><small>Código enviado {sentTo.channel === 'WHATSAPP' ? 'por WhatsApp' : 'por e-mail'} para {sentTo.to}</small></span>
          </div>
          <input className="auth-input auth-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus />
          <button type="button" className="auth-2fa-resend" disabled={busy} onClick={() => void submit(true)}>Reenviar código</button>
        </div>
      ) : null}
      <button className="auth-btn" onClick={() => void submit()} disabled={busy || (!!sentTo && code.length !== 6)}>{busy ? 'A guardar…' : `Definir ${isPin ? 'PIN' : 'senha'}`}</button>
    </>
  );
}

/** Ícones do passo do código (traço simples). */
function MailGlyph() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
}
function WaGlyph() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.2-4.2A8.5 8.5 0 1 1 20 11.5Z" /><path d="M9 9.5c.3 1.8 1.7 3.6 3.6 4.4l1.2-1.1 1.7.8-.3 1.4c-3.4.3-6.8-3-6.6-6.4l1.4-.3.8 1.6Z" /></svg>;
}
