import React, { useState } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { LOGO_SRC, SYSTEM_MODULE, SYSTEM_NAME } from '../brand';
import { FooterCredit } from '../components/FooterCredit';
import { IconBuilding, IconKeyboard, IconLock, IconMail, IconShield } from '../components/Icons';
import { KeyboardInput } from '../keyboard/KeyboardInput';
import { useKeyboard } from '../keyboard/KeyboardProvider';

export function LoginPage() {
  const { login, companyCode: saved } = useAuth();
  const kbd = useKeyboard();

  const [companyCode, setCompanyCode] = useState(saved ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFa, setTwoFa] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!companyCode.trim() || !email.trim() || !password) {
      setError('Preencha empresa, e-mail e palavra-passe.');
      return;
    }
    setLoading(true);
    try {
      await login({
        companyCode: companyCode.trim().toLowerCase(),
        email: email.trim(),
        password,
        twoFaToken: twoFa.trim() || undefined,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-bg">
      <div className="login-screen">
        <div className="card login-card">
          <div className="brand">
            <img className="brand-logo" src={LOGO_SRC} alt={SYSTEM_NAME} />
            <h1>{SYSTEM_NAME}</h1>
            <span className="tag">{SYSTEM_MODULE}</span>
          </div>

          {error ? (
            <div className="banner danger" style={{ marginBottom: 14 }}>
              {error}
            </div>
          ) : null}

          <div className="login-fields">
            <KeyboardInput
              label="Empresa"
              icon={<IconBuilding size={18} />}
              placeholder="codigo-da-empresa"
              value={companyCode}
              onChange={setCompanyCode}
            />
            <KeyboardInput
              label="E-mail"
              icon={<IconMail size={18} />}
              placeholder="nome@empresa.ao"
              value={email}
              onChange={setEmail}
            />
            <KeyboardInput
              label="Palavra-passe"
              icon={<IconLock size={18} />}
              placeholder="••••••••"
              type="password"
              value={password}
              onChange={setPassword}
            />
            <KeyboardInput
              label="Código 2FA (se activo)"
              icon={<IconShield size={18} />}
              placeholder="000000"
              value={twoFa}
              onChange={setTwoFa}
              numeric
              maxLength={6}
              submitLabel="Entrar"
              onSubmit={submit}
            />
          </div>

          <label className="toggle-row" style={{ cursor: 'pointer' }}>
            <span className="meta">
              <IconKeyboard size={20} />
              <span>
                <span className="ttl" style={{ display: 'block' }}>
                  Teclado no ecrã
                </span>
                <span className="hint">Para PCs/terminais táteis sem teclado físico</span>
              </span>
            </span>
            <span className="switch">
              <input
                type="checkbox"
                checked={kbd.enabled}
                onChange={(e) => kbd.setEnabled(e.target.checked)}
              />
              <span className="track" />
              <span className="thumb" />
            </span>
          </label>

          <button className="btn lg block" onClick={submit} disabled={loading}>
            {loading ? 'A entrar…' : 'Entrar'}
          </button>

          <FooterCredit />
        </div>
      </div>
    </div>
  );
}
