import React, { useMemo, useState } from 'react';
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
  const [forgot, setForgot] = useState(false);
  // Link de recuperação do PIN: ?reset=<token>&k=pin
  const resetToken = useMemo(() => {
    try { const p = new URLSearchParams(window.location.search); return p.get('k') === 'pin' ? p.get('reset') : null; }
    catch { return null; }
  }, []);

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

          {resetToken ? (
            <PinResetView token={resetToken} />
          ) : step === 'company' ? (
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
              <button type="button" className="link-2fa" style={{ marginTop: 10 }} onClick={() => setForgot(true)}>Esqueci o PIN</button>
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
      {forgot ? <ForgotPinModal defaultEmail={company} onClose={() => setForgot(false)} /> : null}
    </div>
  );
}

/** Pede o e-mail e envia o link de recuperação do PIN. */
function ForgotPinModal({ defaultEmail, onClose }: { defaultEmail?: string; onClose(): void }) {
  const [email, setEmail] = useState(defaultEmail && /@/.test(defaultEmail) ? defaultEmail : '');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setWarn('Indica o teu e-mail.'); return; }
    setBusy(true); setWarn(null);
    try {
      const r = await api.forgotPin(email.trim().toLowerCase());
      if (!r.emailConfigured) setWarn('O envio de e-mail ainda não está configurado. Pede ao gestor para repor o teu PIN (Funcionários → Gerir acesso).');
      else setDone(true);
    } catch { setDone(true); }
    finally { setBusy(false); }
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="mh"><h3>Recuperar PIN</h3><span className="spacer" /><button className="btn sm ghost" onClick={onClose}>Fechar</button></div>
        <div className="mb">
          {done ? (
            <div className="banner success"><div>Se existir uma conta com esse e-mail, enviámos um link para definires um novo PIN. Vê a tua caixa de entrada.</div></div>
          ) : (
            <>
              {warn ? <div className="banner danger" style={{ marginBottom: 12 }}>{warn}</div> : null}
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Escreve o teu e-mail. Enviamos um link (1 hora) para definires um novo PIN.</p>
              <div className="field"><label>E-mail</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@empresa.ao" inputMode="email" /></div>
              <button className="btn lg block" onClick={() => void submit()} disabled={busy}>{busy ? 'A enviar…' : 'Enviar link'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Define o novo PIN (6 dígitos) a partir do token do e-mail. */
function PinResetView({ token }: { token: string }) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const submit = async () => {
    setErr(null);
    if (!/^\d{6}$/.test(pin)) { setErr('O PIN tem de ter 6 dígitos.'); return; }
    if (pin !== confirm) { setErr('Os PIN não coincidem.'); return; }
    setBusy(true);
    try { await api.resetPin(token, pin); setOk(true); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível. Pede um novo link.'); }
    finally { setBusy(false); }
  };
  if (ok) {
    return (
      <div className="banner success">
        <div>✅ PIN definido. Já podes <a style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 700 }} onClick={() => location.assign(location.pathname)}>entrar na caixa</a>.</div>
      </div>
    );
  }
  return (
    <div className="login-fields">
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>Define o teu novo PIN da caixa (6 dígitos).</p>
      <KeyboardInput label="Novo PIN" type="password" value={pin} onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))} numeric maxLength={6} placeholder="••••••" onSubmit={() => void submit()} />
      <KeyboardInput label="Confirmar PIN" type="password" value={confirm} onChange={(v) => setConfirm(v.replace(/\D/g, '').slice(0, 6))} numeric maxLength={6} placeholder="••••••" onSubmit={() => void submit()} />
      <button className="btn lg block" onClick={() => void submit()} disabled={busy}>{busy ? 'A guardar…' : 'Definir PIN'}</button>
    </div>
  );
}
