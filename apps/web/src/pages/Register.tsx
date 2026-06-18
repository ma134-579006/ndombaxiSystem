import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { PublicPlan } from '../api/types';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { LoginShowcase } from '../components/LoginShowcase';
import { PasswordField } from '../components/PasswordField';

/**
 * Criar conta de empresa — registo SIMPLES (só email + palavra-passe ou Google).
 * Mesmo design escuro do login (formulário à esquerda, vídeo à direita).
 */
export function Register({ onBack }: { onBack?: () => void }) {
  const { adoptSession } = useAuth();
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [planTier, setPlanTier] = useState('STARTER');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.publicLanding().then((l) => {
      setPlans(l.plans as unknown as PublicPlan[]);
      if (l.plans?.[0]?.tier) setPlanTier(l.plans[0].tier);
    }).catch(() => undefined);
  }, []);

  const finish = (r: { tokens: { accessToken: string; refreshToken: string }; companyCode: string }) => {
    adoptSession(r.tokens, r.companyCode);
  };

  const submitEmail = async () => {
    setError(null);
    if (!email.trim() || password.length < 8) { setError('Indique e-mail e palavra-passe (mín. 8 caracteres).'); return; }
    setLoading(true);
    try { finish(await api.registerSimple({ email: email.trim(), password, planTier })); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível criar a conta.'); }
    finally { setLoading(false); }
  };

  const onGoogle = async (idToken: string) => {
    setError(null); setLoading(true);
    try { finish(await api.registerSimple({ googleIdToken: idToken, planTier })); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível criar a conta com Google.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="auth">
      <div className="auth-panel">
        <div className="auth-form">
          <h1 className="auth-title">Criar conta</h1>

          {error ? <div className="auth-error">{error}</div> : null}

          {plans.length > 0 ? (
            <>
              <label className="auth-label">Plano</label>
              <select className="auth-input" value={planTier} onChange={(e) => setPlanTier(e.target.value)}>
                {plans.map((p) => <option key={p.tier} value={p.tier}>{p.name}</option>)}
              </select>
            </>
          ) : null}

          <label className="auth-label">E-mail</label>
          <input className="auth-input" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@empresa.ao" type="email" autoComplete="username"
            onKeyDown={(e) => { if (e.key === 'Enter') void submitEmail(); }} />

          <label className="auth-label">Palavra-passe</label>
          <PasswordField value={password} onChange={setPassword} placeholder="mín. 8 caracteres"
            autoComplete="new-password" onEnter={() => void submitEmail()} />

          <div style={{ height: 18 }} />
          <button className="auth-btn" onClick={submitEmail} disabled={loading}>{loading ? 'A criar…' : 'Criar conta'}</button>

          <div className="auth-or"><span>ou</span></div>
          <div className="auth-google"><GoogleSignInButton onCredential={onGoogle} /></div>

          {onBack ? <p className="auth-foot"><a onClick={onBack}>← Já tenho conta — entrar</a></p> : null}
        </div>
      </div>
      <div className="auth-media"><LoginShowcase /></div>
    </div>
  );
}
