import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { PublicPlan } from '../api/types';
import { LOGO_SRC, SYSTEM_NAME, copyrightLine } from '../brand';
import { IconBuilding } from '../components/Icons';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { LoginShowcase } from '../components/LoginShowcase';

/**
 * Criar conta de empresa — registo SIMPLES: só email + palavra-passe própria,
 * ou conta Google. Depois de entrar, o setup obrigatório pede nome/código/NIF/logo.
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
    <div className="login">
      <LoginShowcase />
      <div className="box">
        <div className="brand">
          <img src={LOGO_SRC} alt={SYSTEM_NAME} />
          <h1>{SYSTEM_NAME}</h1>
          <div className="tg">Criar conta de empresa — comece grátis</div>
        </div>
        <div className="card">
          {error ? <div className="banner danger" style={{ marginBottom: 12 }}>{error}</div> : null}

          {plans.length > 0 ? (
            <div className="field"><label>Plano</label>
              <select value={planTier} onChange={(e) => setPlanTier(e.target.value)}>
                {plans.map((p) => <option key={p.tier} value={p.tier}>{p.name}</option>)}
              </select></div>
          ) : null}

          <div className="field"><label>E-mail</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.ao" type="email" /></div>
          <div className="field"><label>Palavra-passe</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mín. 8 caracteres" type="password" /></div>

          <button className="btn lg block" onClick={submitEmail} disabled={loading}>
            <IconBuilding size={18} /> {loading ? 'A criar…' : 'Criar conta'}
          </button>

          <div className="or-sep"><span>ou</span></div>
          <div className="google-row"><GoogleSignInButton onCredential={onGoogle} /></div>
        </div>
        <p style={{ textAlign: 'center', marginTop: 12 }}>
          <a onClick={onBack} style={{ color: 'var(--muted)', fontSize: 13, cursor: 'pointer' }}>← Já tenho conta — entrar</a>
        </p>
        <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{copyrightLine()}</p>
      </div>
    </div>
  );
}
