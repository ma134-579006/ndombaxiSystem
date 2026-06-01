import React, { useState } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { LOGO_SRC, SYSTEM_NAME, copyrightLine } from '../brand';
import { IconBuilding, IconShield } from '../components/Icons';

type Profile = 'tenant' | 'platform';

export function Login() {
  const { loginTenant, loginPlatform } = useAuth();
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

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void submit();
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
            <button
              className={profile === 'tenant' ? 'on' : ''}
              onClick={() => setProfile('tenant')}
              type="button"
            >
              <IconBuilding size={16} /> Gestor da empresa
            </button>
            <button
              className={profile === 'platform' ? 'on' : ''}
              onClick={() => setProfile('platform')}
              type="button"
            >
              <IconShield size={16} /> Super Admin
            </button>
          </div>

          {error ? <div className="banner danger" style={{ marginBottom: 14 }}>{error}</div> : null}

          {profile === 'tenant' ? (
            <div className="field">
              <label>Código da empresa</label>
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="ex.: novashop"
                autoFocus
                onKeyDown={onEnter}
              />
            </div>
          ) : null}

          <div className="field">
            <label>E-mail</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={profile === 'tenant' ? 'gestor@empresa.ao' : 'admin@ndombaxi.ao'}
              autoFocus={profile === 'platform'}
              onKeyDown={onEnter}
            />
          </div>
          <div className="field">
            <label>Palavra-passe</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              onKeyDown={onEnter}
            />
          </div>
          <div className="field">
            <label>Código 2FA (se activo)</label>
            <input
              value={twoFa}
              onChange={(e) => setTwoFa(e.target.value)}
              placeholder="000000"
              inputMode="numeric"
              maxLength={6}
              onKeyDown={onEnter}
            />
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
