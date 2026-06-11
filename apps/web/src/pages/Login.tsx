import React, { useState } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { KeyboardInput } from '../keyboard/KeyboardInput';
import { LOGO_SRC, SYSTEM_NAME, copyrightLine } from '../brand';
import { IconBuilding, IconReceipt, IconShield } from '../components/Icons';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
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
        setError('Indica o e-mail registado da empresa (ou o código) para abrir a Caixa.');
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

  return (
    <div className="login">
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
    </div>
  );
}
