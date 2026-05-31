import React, { useState } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { LOGO_SRC, SYSTEM_NAME, copyrightLine } from '../brand';
import { IconLock, IconMail, IconShield } from '../components/Icons';

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFa, setTwoFa] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('Indique o e-mail e a palavra-passe.');
      return;
    }
    setLoading(true);
    try {
      await login({ email: email.trim(), password, twoFaToken: twoFa.trim() || undefined });
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
          <div className="tg">Painel de Administração</div>
        </div>
        <div className="card">
          {error ? <div className="banner danger" style={{ marginBottom: 14 }}>{error}</div> : null}
          <div className="field">
            <label>E-mail</label>
            <div style={{ position: 'relative' }}>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@ndombaxi.ao" autoFocus />
            </div>
          </div>
          <div className="field">
            <label>Palavra-passe</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
          </div>
          <div className="field">
            <label>Código 2FA (se activo)</label>
            <input value={twoFa} onChange={(e) => setTwoFa(e.target.value)} placeholder="000000" inputMode="numeric" maxLength={6}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
          </div>
          <button className="btn lg block" onClick={submit} disabled={loading}>
            <IconShield size={18} /> {loading ? 'A entrar…' : 'Entrar'}
          </button>
        </div>
        <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{copyrightLine()}</p>
      </div>
    </div>
  );
}
