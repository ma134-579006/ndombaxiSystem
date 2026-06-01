import React, { useState } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useKeyboard } from '../keyboard/KeyboardProvider';
import { KeyboardInput } from '../keyboard/KeyboardInput';
import { LOGO_SRC, SYSTEM_NAME, copyrightLine } from '../brand';
import { IconBuilding, IconKeyboard, IconShield } from '../components/Icons';
import { Switch } from '../components/ui';

type Profile = 'tenant' | 'platform';

export function Login() {
  const { loginTenant, loginPlatform } = useAuth();
  const kbd = useKeyboard();
  const [profile, setProfile] = useState<Profile>('tenant');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFa, setTwoFa] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
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
              <IconBuilding size={16} /> Gestor da empresa
            </button>
            <button className={profile === 'platform' ? 'on' : ''} onClick={() => setProfile('platform')} type="button">
              <IconShield size={16} /> Super Admin
            </button>
          </div>

          {error ? <div className="banner danger" style={{ marginBottom: 14 }}>{error}</div> : null}

          {profile === 'tenant' ? (
            <KeyboardInput label="Código da empresa" value={company} onChange={setCompany} placeholder="ex.: novashop" onSubmit={submit} autoFocus />
          ) : null}

          <KeyboardInput label="E-mail" value={email} onChange={setEmail} placeholder={profile === 'tenant' ? 'gestor@empresa.ao' : 'admin@ndombaxi.ao'} onSubmit={submit} />
          <KeyboardInput label="Palavra-passe" type="password" value={password} onChange={setPassword} placeholder="••••••••" onSubmit={submit} />
          <KeyboardInput label="Código 2FA (se activo)" value={twoFa} onChange={setTwoFa} placeholder="000000" numeric maxLength={6} onSubmit={submit} />

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
            {profile === 'tenant' ? <IconBuilding size={18} /> : <IconShield size={18} />}{' '}
            {loading ? 'A entrar…' : 'Entrar'}
          </button>
        </div>
        <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{copyrightLine()}</p>
      </div>
    </div>
  );
}
