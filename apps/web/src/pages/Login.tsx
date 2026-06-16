import React, { useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { KeyboardInput } from '../keyboard/KeyboardInput';
import { LOGO_SRC, SYSTEM_NAME, copyrightLine } from '../brand';
import { IconBuilding, IconReceipt, IconShield } from '../components/Icons';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { LoginShowcase } from '../components/LoginShowcase';
import { CAIXA_URL } from '../config';

type Profile = 'tenant' | 'caixa' | 'platform';

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
 * Login SEM código de empresa: o gestor entra só com e-mail + palavra-passe
 * (ou Google) — a empresa é encontrada pelo e-mail. Se o mesmo e-mail existir
 * em várias empresas, aparece um seletor. A Caixa abre-se com o e-mail
 * registado da empresa (ou o código antigo, que continua a funcionar).
 */
export function Login({ onBack, onRegister }: { onBack?: () => void; onRegister?: () => void }) {
  const { loginTenant, loginPlatform, loginGoogle } = useAuth();
  // Recuperação por e-mail: link no e-mail traz ?reset=<token>&k=pw
  const resetToken = useMemo(() => {
    const p = new URLSearchParams(location.search);
    return p.get('k') !== 'pin' ? p.get('reset') : null;
  }, []);
  const [forgot, setForgot] = useState(false);
  const [profile, setProfile] = useState<Profile>('tenant');
  const [caixaId, setCaixaId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFa, setTwoFa] = useState('');
  const [show2fa, setShow2fa] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Várias empresas para o mesmo e-mail → o utilizador escolhe. */
  const [choices, setChoices] = useState<CompanyChoice[] | null>(null);
  /** Pedido pendente a repetir com o companyCode escolhido. */
  const [pending, setPending] = useState<{ kind: 'password' | 'google'; idToken?: string } | null>(null);

  const onGoogle = async (idToken: string, companyCode?: string) => {
    setError(null);
    setLoading(true);
    try {
      await loginGoogle(idToken, companyCode);
    } catch (e) {
      const c = choicesFrom(e);
      if (c) { setChoices(c); setPending({ kind: 'google', idToken }); return; }
      setError(e instanceof ApiError ? e.message : 'Não foi possível entrar com Google.');
    } finally {
      setLoading(false);
    }
  };

  const submit = async (companyCode?: string) => {
    setError(null);
    setChoices(null);

    // A Caixa (POS) é uma aplicação separada — abre-se com o e-mail registado
    // da empresa (ou o código antigo; a própria Caixa resolve).
    if (profile === 'caixa') {
      if (!caixaId.trim()) {
        setError('Indica o e-mail registado da empresa para abrir a Caixa.');
        return;
      }
      window.location.assign(`${CAIXA_URL}/?empresa=${encodeURIComponent(caixaId.trim().toLowerCase())}`);
      return;
    }

    if (!email.trim() || !password) {
      setError('Indica o e-mail e a palavra-passe.');
      return;
    }
    setLoading(true);
    try {
      const twoFaToken = twoFa.trim() || undefined;
      if (profile === 'tenant') {
        await loginTenant({ companyCode, email: email.trim(), password, twoFaToken });
      } else {
        await loginPlatform({ email: email.trim(), password, twoFaToken });
      }
    } catch (e) {
      const c = choicesFrom(e);
      if (c) { setChoices(c); setPending({ kind: 'password' }); return; }
      setError(e instanceof ApiError ? e.message : 'Não foi possível entrar.');
    } finally {
      setLoading(false);
    }
  };

  const pickCompany = async (code: string) => {
    setChoices(null);
    if (pending?.kind === 'google' && pending.idToken) {
      await onGoogle(pending.idToken, code);
    } else {
      await submit(code);
    }
    setPending(null);
  };

  if (resetToken) {
    return (
      <div className="login">
        <LoginShowcase />
        <div className="box">
          <div className="brand">
            <img src={LOGO_SRC} alt={SYSTEM_NAME} />
            <h1>{SYSTEM_NAME}</h1>
            <div className="tg">Nova palavra-passe</div>
          </div>
          <div className="card"><ResetView token={resetToken} kind="pw" /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <LoginShowcase />
      <div className="box">
        <div className="brand">
          <img src={LOGO_SRC} alt={SYSTEM_NAME} />
          <h1>{SYSTEM_NAME}</h1>
          <div className="tg">Painel de Gestão</div>
        </div>
        <div className="card">
          <div className="seg" style={{ marginBottom: 16 }}>
            <button className={profile === 'tenant' ? 'on' : ''} onClick={() => { setProfile('tenant'); setError(null); setChoices(null); }} type="button">
              <IconBuilding size={16} /> Gestor
            </button>
            <button className={profile === 'caixa' ? 'on' : ''} onClick={() => { setProfile('caixa'); setError(null); setChoices(null); }} type="button">
              <IconReceipt size={16} /> Caixa
            </button>
            <button className={profile === 'platform' ? 'on' : ''} onClick={() => { setProfile('platform'); setError(null); setChoices(null); }} type="button">
              <IconShield size={16} /> Super Admin
            </button>
          </div>

          {error ? <div className="banner danger" style={{ marginBottom: 14 }}>{error}</div> : null}

          {choices ? (
            <div style={{ marginBottom: 12 }}>
              <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                Este e-mail existe em várias empresas — escolhe qual queres abrir:
              </p>
              {choices.map((c) => (
                <button key={c.code} className="btn ghost block" style={{ marginBottom: 8 }} onClick={() => void pickCompany(c.code)} disabled={loading}>
                  <IconBuilding size={16} /> {c.name}
                </button>
              ))}
            </div>
          ) : null}

          {profile === 'caixa' ? (
            <>
              <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 12 }}>
                Abre o terminal de venda (Caixa). O início de sessão do operador é feito na própria Caixa — por nome + PIN ou com Google.
              </p>
              <KeyboardInput label="E-mail registado da empresa" value={caixaId} onChange={setCaixaId} placeholder="gestor@empresa.ao" onSubmit={() => void submit()} />
            </>
          ) : null}

          {profile !== 'caixa' && !choices ? (
            <>
              <KeyboardInput label="E-mail" value={email} onChange={setEmail} placeholder={profile === 'tenant' ? 'gestor@empresa.ao' : 'admin@ndombaxi.ao'} onSubmit={() => void submit()} />
              <KeyboardInput label="Palavra-passe" type="password" value={password} onChange={setPassword} placeholder="••••••••" onSubmit={() => void submit()} />
              {show2fa ? (
                <KeyboardInput label="Código 2FA" value={twoFa} onChange={setTwoFa} placeholder="000000" numeric maxLength={6} onSubmit={() => void submit()} />
              ) : (
                <button type="button" className="link-2fa" onClick={() => setShow2fa(true)}>Tenho código 2FA</button>
              )}
              <button type="button" className="link-2fa" style={{ marginLeft: 12 }} onClick={() => setForgot(true)}>Esqueci a senha</button>
            </>
          ) : null}

          {!choices ? (
            <button className="btn lg block" onClick={() => void submit()} disabled={loading}>
              {profile === 'caixa' ? <IconReceipt size={18} /> : profile === 'tenant' ? <IconBuilding size={18} /> : <IconShield size={18} />}{' '}
              {profile === 'caixa' ? 'Abrir a Caixa' : loading ? 'A entrar…' : 'Entrar'}
            </button>
          ) : null}

          {profile === 'tenant' && !choices ? (
            <div className="google-row">
              <div className="or-sep"><span>ou</span></div>
              <GoogleSignInButton onCredential={(t) => void onGoogle(t)} />
            </div>
          ) : null}
        </div>
        {profile === 'tenant' && onRegister ? (
          <p style={{ textAlign: 'center', marginTop: 12 }}>
            <a onClick={onRegister} style={{ color: 'var(--primary)', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
              Não tem conta? Criar conta de empresa
            </a>
          </p>
        ) : null}
        {onBack ? (
          <p style={{ textAlign: 'center', marginTop: 6 }}>
            <a onClick={onBack} style={{ color: 'var(--muted)', fontSize: 13, cursor: 'pointer' }}>
              ← Voltar à página inicial
            </a>
          </p>
        ) : null}
        <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{copyrightLine()}</p>
      </div>
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
      if (!r.emailConfigured) setWarn('O envio de e-mail ainda não está configurado nesta plataforma. Pede ao administrador para repor a tua senha.');
      else setDone(true);
    } catch { setDone(true); /* não revela */ }
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
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="gestor@empresa.ao" inputMode="email" /></div>
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
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Define a tua nova {isPin ? 'PIN da caixa (6 dígitos)' : 'palavra-passe'}.</p>
      <div className="field"><label>{isPin ? 'Novo PIN' : 'Nova senha'}</label>
        <input type={isPin ? 'text' : 'password'} inputMode={isPin ? 'numeric' : undefined} maxLength={isPin ? 6 : undefined}
          value={secret} onChange={(e) => setSecret(isPin ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value)} placeholder={isPin ? '000000' : '••••••••'} /></div>
      <div className="field"><label>Confirmar</label>
        <input type={isPin ? 'text' : 'password'} inputMode={isPin ? 'numeric' : undefined} maxLength={isPin ? 6 : undefined}
          value={confirm} onChange={(e) => setConfirm(isPin ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value)} placeholder={isPin ? '000000' : '••••••••'} /></div>
      <button className="btn lg block" onClick={() => void submit()} disabled={busy}>{busy ? 'A guardar…' : `Definir ${isPin ? 'PIN' : 'senha'}`}</button>
    </>
  );
}
