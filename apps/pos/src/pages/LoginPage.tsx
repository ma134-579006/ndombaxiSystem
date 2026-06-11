import React, { useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Operator } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { LOGO_SRC, SYSTEM_MODULE, SYSTEM_NAME } from '../brand';
import { FooterCredit } from '../components/FooterCredit';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { LoginShowcase } from '../components/LoginShowcase';
import { IconBuilding, IconKeyboard } from '../components/Icons';
import { KeyboardInput } from '../keyboard/KeyboardInput';
import { useKeyboard } from '../keyboard/KeyboardProvider';

export function LoginPage() {
  const { loginPin, loginGoogle, companyCode: saved } = useAuth();
  const kbd = useKeyboard();

  const codeFromUrl = (() => {
    try { const p = new URLSearchParams(window.location.search); return (p.get('empresa') || p.get('loja') || '').trim(); }
    catch { return ''; }
  })();

  // Aceita o E-MAIL registado da empresa (novo) ou o código antigo.
  const [company, setCompany] = useState(codeFromUrl || saved || '');
  /** Código REAL resolvido pela API (o que o login por PIN usa). */
  const [resolvedCode, setResolvedCode] = useState<string>(saved || '');
  const [companyName, setCompanyName] = useState<string>('');
  const [choices, setChoices] = useState<{ code: string; name: string }[] | null>(null);
  const [step, setStep] = useState<'company' | 'operator'>('company');
  const [operators, setOperators] = useState<Operator[]>([]);
  const [selected, setSelected] = useState<Operator | null>(null);
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOperators = async (identifier?: string) => {
    setError(null);
    const id = (identifier ?? company).trim().toLowerCase();
    if (!id) { setError('Indique o e-mail registado da empresa (ou o código).'); return; }
    setLoading(true);
    try {
      const r = await api.operators(id);
      if (r.choices && r.choices.length) {
        // o mesmo e-mail existe em várias empresas → o operador escolhe
        setChoices(r.choices);
        return;
      }
      setChoices(null);
      if (!r.companyCode) {
        setError('Empresa não encontrada. Confirma o e-mail registado (ou o código) — e se a conta já foi aprovada.');
        return;
      }
      if (!r.operators.length) {
        setError('Esta empresa ainda não tem operadores com PIN. Peça ao gestor para criar acessos (Funcionários → Dar acesso, com PIN).');
        return;
      }
      setResolvedCode(r.companyCode);
      setCompanyName(r.companyName ?? '');
      setOperators(r.operators);
      setStep('operator');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível ligar. Verifique a internet e o e-mail/código.');
    } finally {
      setLoading(false);
    }
  };

  const onGoogle = async (idToken: string) => {
    setError(null); setLoading(true);
    try {
      await loginGoogle(idToken);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível entrar com Google.');
    } finally {
      setLoading(false);
    }
  };

  const submitPin = async () => {
    if (!selected) return;
    if (!/^\d{4,8}$/.test(pin)) { setError('Digite o PIN (4 a 8 dígitos).'); return; }
    setLoading(true); setError(null);
    try {
      await loginPin(resolvedCode, selected.id, pin);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'PIN incorreto.');
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  const backToCompany = () => { setStep('company'); setSelected(null); setPin(''); setError(null); setChoices(null); };

  return (
    <div className="app-bg">
      <div className="login-screen">
        <LoginShowcase />
        <div className="card login-card">
          <div className="brand">
            <img className="brand-logo" src={LOGO_SRC} alt={SYSTEM_NAME} />
            <h1>{SYSTEM_NAME}</h1>
            <span className="tag">{SYSTEM_MODULE}</span>
          </div>

          {error ? <div className="banner danger" style={{ marginBottom: 14 }}>{error}</div> : null}

          {step === 'company' ? (
            <div className="login-fields">
              {choices ? (
                <>
                  <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>Este e-mail existe em várias empresas — escolhe:</p>
                  {choices.map((c) => (
                    <button key={c.code} className="btn ghost block" style={{ marginBottom: 8 }} onClick={() => void loadOperators(c.code)} disabled={loading}>
                      <IconBuilding size={16} /> {c.name}
                    </button>
                  ))}
                </>
              ) : (
                <>
                  <KeyboardInput
                    label="E-mail registado da empresa (ou código)"
                    icon={<IconBuilding size={18} />}
                    placeholder="gestor@empresa.ao"
                    value={company}
                    onChange={setCompany}
                    onSubmit={() => void loadOperators()}
                  />
                  <button className="btn lg block" style={{ marginTop: 4 }} onClick={() => void loadOperators()} disabled={loading}>
                    {loading ? 'A procurar…' : 'Continuar'}
                  </button>
                  <div className="or-sep"><span>ou</span></div>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <GoogleSignInButton onCredential={(t) => void onGoogle(t)} />
                  </div>
                </>
              )}
            </div>
          ) : !selected ? (
            <>
              <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>{companyName ? `${companyName} — quem está na caixa?` : 'Quem está na caixa?'}</p>
              <div className="op-grid">
                {operators.map((o) => (
                  <button key={o.id} className="op-card" onClick={() => { setSelected(o); setPin(''); setError(null); }}>
                    {o.photo_url
                      ? <img className="op-ini op-photo" src={o.photo_url} alt={o.name} />
                      : <span className="op-ini">{o.name.slice(0, 1).toUpperCase()}</span>}
                    <span className="op-name">{o.name}</span>
                    {o.store_name ? <span className="op-store">{o.store_name}</span> : null}
                  </button>
                ))}
              </div>
              <button className="btn ghost block" style={{ marginTop: 12 }} onClick={backToCompany}>← Trocar empresa</button>
            </>
          ) : (
            <div className="login-fields">
              <p className="muted" style={{ margin: '0 0 4px' }}>Operador</p>
              <div className="op-selected">{selected.name}</div>
              <KeyboardInput
                label="PIN"
                placeholder="••••"
                type="password"
                value={pin}
                onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))}
                numeric
                maxLength={8}
                submitLabel="Entrar"
                onSubmit={submitPin}
              />
              <button className="btn lg block" onClick={submitPin} disabled={loading}>
                {loading ? 'A entrar…' : 'Entrar'}
              </button>
              <button className="btn ghost block" style={{ marginTop: 8 }} onClick={() => { setSelected(null); setPin(''); setError(null); }}>
                ← Trocar operador
              </button>
            </div>
          )}

          <label className="toggle-row" style={{ cursor: 'pointer' }}>
            <span className="meta">
              <IconKeyboard size={20} />
              <span>
                <span className="ttl" style={{ display: 'block' }}>Teclado no ecrã</span>
                <span className="hint">Para PCs/terminais táteis sem teclado físico</span>
              </span>
            </span>
            <span className="switch">
              <input type="checkbox" checked={kbd.enabled} onChange={(e) => kbd.setEnabled(e.target.checked)} />
              <span className="track" />
              <span className="thumb" />
            </span>
          </label>

          <FooterCredit />
        </div>
      </div>
    </div>
  );
}
