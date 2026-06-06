import React, { useState } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useKeyboard } from '../keyboard/KeyboardProvider';
import { KeyboardInput } from '../keyboard/KeyboardInput';
import { LOGO_SRC, SYSTEM_NAME, copyrightLine } from '../brand';
import { IconBuilding, IconKeyboard, IconReceipt, IconShield } from '../components/Icons';
import { Switch } from '../components/ui';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { CAIXA_URL } from '../config';

type Profile = 'tenant' | 'caixa' | 'platform';

export function Login({ onBack }: { onBack?: () => void }) {
  const { loginTenant, loginPlatform, loginGoogle } = useAuth();
  const kbd = useKeyboard();
  const [profile, setProfile] = useState<Profile>('tenant');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFa, setTwoFa] = useState('');
  const [show2fa, setShow2fa] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onGoogle = async (idToken: string) => {
    setError(null);
    if (!company.trim()) {
      setError('Indique primeiro o código da empresa para entrar com Google.');
      return;
    }
    setLoading(true);
    try {
      await loginGoogle(company.trim().toLowerCase(), idToken);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível entrar com Google.');
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    setError(null);

    // A Caixa (POS) é uma aplicação separada — abre-se com o código da empresa.
    if (profile === 'caixa') {
      if (!company.trim()) {
        setError('Indique o código da empresa para abrir a Caixa.');
        return;
      }
      window.location.assign(`${CAIXA_URL}/?empresa=${encodeURIComponent(company.trim().toLowerCase())}`);
      return;
    }

    if (profile === 'tenant' && !company.trim()) {
      setError('Indique o código da empresa.');
      return;
    }
    if (!email.trim() || !password) {
      setError('Indique o e-mail e a palavra-passe.');
      return;
    }
    setLoading(true);
    try {
      const twoFaToken = twoFa.trim() || undefined;
      if (profile === 'tenant') {
        await loginTenant({ companyCode: company.trim(), email: email.trim(), password, twoFaToken });
      } else {
        await loginPlatform({ email: email.trim(), password, twoFaToken });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível entrar.');
    } finally {
      setLoading(false);
    }
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
            <button className={profile === 'tenant' ? 'on' : ''} onClick={() => setProfile('tenant')} type="button">
              <IconBuilding size={16} /> Gestor
            </button>
            <button className={profile === 'caixa' ? 'on' : ''} onClick={() => setProfile('caixa')} type="button">
              <IconReceipt size={16} /> Caixa
            </button>
            <button className={profile === 'platform' ? 'on' : ''} onClick={() => setProfile('platform')} type="button">
              <IconShield size={16} /> Super Admin
            </button>
          </div>

          {error ? <div className="banner danger" style={{ marginBottom: 14 }}>{error}</div> : null}

          {profile === 'caixa' ? (
            <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 12 }}>
              Abre o terminal de venda (Caixa) desta empresa. O início de sessão do operador é feito na própria Caixa.
            </p>
          ) : null}

          {profile !== 'platform' ? (
            <KeyboardInput label="Código da empresa" value={company} onChange={setCompany} placeholder="ex.: novashop" onSubmit={submit} />
          ) : null}

          {profile !== 'caixa' ? (
            <>
              <KeyboardInput label="E-mail" value={email} onChange={setEmail} placeholder={profile === 'tenant' ? 'gestor@empresa.ao' : 'admin@ndombaxi.ao'} onSubmit={submit} />
              <KeyboardInput label="Palavra-passe" type="password" value={password} onChange={setPassword} placeholder="••••••••" onSubmit={submit} />
              {show2fa ? (
                <KeyboardInput label="Código 2FA" value={twoFa} onChange={setTwoFa} placeholder="000000" numeric maxLength={6} onSubmit={submit} />
              ) : (
                <button type="button" className="link-2fa" onClick={() => setShow2fa(true)}>Tenho código 2FA</button>
              )}
            </>
          ) : null}

          {/* Teclado no ecrã — para PCs apenas digitais / terminais táteis */}
          <div className="kbd-toggle">
            <div className="meta">
              <IconKeyboard size={18} />
              <div>
                <div className="ttl">Teclado no ecrã</div>
                <div className="hint">Para PCs/terminais táteis sem teclado físico.</div>
              </div>
            </div>
            <Switch checked={kbd.enabled} onChange={kbd.setEnabled} />
          </div>

          <button className="btn lg block" onClick={submit} disabled={loading}>
            {profile === 'caixa' ? <IconReceipt size={18} /> : profile === 'tenant' ? <IconBuilding size={18} /> : <IconShield size={18} />}{' '}
            {profile === 'caixa' ? 'Abrir a Caixa' : loading ? 'A entrar…' : 'Entrar'}
          </button>

          {profile === 'tenant' ? (
            <div className="google-row">
              <div className="or-sep"><span>ou</span></div>
              <GoogleSignInButton onCredential={onGoogle} />
            </div>
          ) : null}
        </div>
        {onBack ? (
          <p style={{ textAlign: 'center', marginTop: 14 }}>
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
