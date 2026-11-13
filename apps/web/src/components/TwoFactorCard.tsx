import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { TwoFaStatus } from '../api/types';

/**
 * Verificação em 2 passos da própria conta (empresa ou Super Admin): desligada por omissão;
 * liga-se por e-mail ou WhatsApp com um código de confirmação e desliga-se com outro código.
 */
type Step = 'idle' | 'choose' | 'confirm' | 'disable';

const Mail = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
const Chat = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.2-4.2A8.5 8.5 0 1 1 20 11.5Z" /></svg>;
const Shield = ({ on }: { on: boolean }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3 4 6v6c0 4.4 3.4 8.3 8 9 4.6-.7 8-4.6 8-9V6l-8-3Z" />{on ? <path d="m8.5 12 2.5 2.5 4.5-5" /> : <path d="M12 8v5M12 16h.01" />}
  </svg>
);

export function TwoFactorCard({ email, onStatus }: { email?: string; onStatus?(s: TwoFaStatus): void }) {
  const [st, setSt] = useState<TwoFaStatus | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [method, setMethod] = useState<'EMAIL' | 'WHATSAPP'>('EMAIL');
  const [target, setTarget] = useState(email ?? '');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.twoFactor.status().then((s) => { setSt(s); onStatus?.(s); }).catch(() => undefined);
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<void>) => {
    setErr(null); setBusy(true);
    try { await fn(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível concluir.'); } finally { setBusy(false); }
  };
  const start = () => run(async () => { const r = await api.twoFactor.setup(method, target); setSentTo(r.to); setCode(''); setStep('confirm'); });
  const confirm = () => run(async () => { const s = await api.twoFactor.confirm(code); setSt(s); onStatus?.(s); setStep('idle'); setCode(''); });
  const askDisable = () => run(async () => { const r = await api.twoFactor.disableRequest(); setSentTo(r.to); setCode(''); setStep('disable'); });
  const disable = () => run(async () => { const s = await api.twoFactor.disable(code); setSt(s); onStatus?.(s); setStep('idle'); setCode(''); });

  const on = !!st?.enabled;
  const ch = st?.channels ?? { email: false, whatsapp: false };
  return (
    <div className={`card tf-card${on ? ' on' : ''}`}>
      <div className="tf-head">
        <span className="tf-shield"><Shield on={on} /></span>
        <div className="tf-tx">
          <h3>Verificação em 2 passos</h3>
          <span className={`tf-pill${on ? ' on' : ''}`}>{on ? `Ligada · ${st?.method === 'WHATSAPP' ? 'WhatsApp' : 'E-mail'} ${st?.to ?? ''}` : 'Desligada'}</span>
        </div>
      </div>
      {err ? <div className="banner danger" style={{ margin: '12px 0 0' }}>{err}</div> : null}

      {step === 'idle' ? (
        <div className="tf-actions">
          {on
            ? <button className="btn ghost block" disabled={busy} onClick={() => void askDisable()}>Desligar</button>
            : <button className="btn block" disabled={busy || (!ch.email && !ch.whatsapp)} onClick={() => { setMethod(ch.email ? 'EMAIL' : 'WHATSAPP'); setTarget(ch.email ? (email ?? '') : ''); setStep('choose'); }}>Ligar</button>}
        </div>
      ) : null}

      {step === 'choose' ? (
        <div className="tf-body">
          <div className="tf-methods" role="radiogroup">
            <button type="button" role="radio" aria-checked={method === 'EMAIL'} className={`tf-method${method === 'EMAIL' ? ' sel' : ''}`} disabled={!ch.email} onClick={() => { setMethod('EMAIL'); setTarget(email ?? ''); }}><Mail /> E-mail</button>
            <button type="button" role="radio" aria-checked={method === 'WHATSAPP'} className={`tf-method${method === 'WHATSAPP' ? ' sel' : ''}`} disabled={!ch.whatsapp} onClick={() => { setMethod('WHATSAPP'); setTarget(''); }}><Chat /> WhatsApp</button>
          </div>
          <div className="field"><label>{method === 'EMAIL' ? 'E-mail' : 'Número de WhatsApp'}</label>
            <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode={method === 'EMAIL' ? 'email' : 'tel'} placeholder={method === 'EMAIL' ? 'nome@empresa.ao' : '9XX XXX XXX'} /></div>
          <div className="tf-row">
            <button className="btn ghost" onClick={() => setStep('idle')}>Cancelar</button>
            <button className="btn" disabled={busy || target.trim().length < 6} onClick={() => void start()}>{busy ? 'A enviar…' : 'Enviar código'}</button>
          </div>
        </div>
      ) : null}

      {step === 'confirm' || step === 'disable' ? (
        <div className="tf-body">
          <p className="tf-sent">Código enviado para <b>{sentTo}</b></p>
          <input className="tf-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) void (step === 'confirm' ? confirm() : disable()); }} />
          <div className="tf-row">
            <button className="btn ghost" onClick={() => { setStep('idle'); setCode(''); }}>Cancelar</button>
            <button className={`btn${step === 'disable' ? ' danger' : ''}`} disabled={busy || code.length !== 6} onClick={() => void (step === 'confirm' ? confirm() : disable())}>{step === 'confirm' ? 'Confirmar e ligar' : 'Desligar'}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Mudar a própria palavra-passe: pede a atual e, com 2FA ligada, o código. */
export function OwnPasswordForm({ twoFa, onDone }: { twoFa: boolean; onDone(msg: string): void }) {
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [code, setCode] = useState(''); const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const valid = cur.length > 0 && pw.length >= 8 && pw === pw2 && (!twoFa || code.length === 6);
  const send = async () => {
    setErr(null); setBusy(true);
    try { const r = await api.twoFactor.code(); setSentTo(r.to); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível enviar o código.'); } finally { setBusy(false); }
  };
  const save = async () => {
    setErr(null);
    if (pw.length < 8) { setErr('A nova palavra-passe deve ter pelo menos 8 caracteres.'); return; }
    if (pw !== pw2) { setErr('As palavras-passe não coincidem.'); return; }
    setBusy(true);
    try {
      await api.changeOwnPassword(cur, pw, twoFa ? code : undefined);
      setCur(''); setPw(''); setPw2(''); setCode(''); setSentTo(null); onDone('Senha alterada.');
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível alterar.'); } finally { setBusy(false); }
  };
  return (
    <>
      {err ? <div className="banner danger" style={{ marginBottom: 10 }}>{err}</div> : null}
      <div className="field"><label>Palavra-passe atual</label><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></div>
      <div className="field"><label>Nova palavra-passe</label><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="mín. 8 caracteres" autoComplete="new-password" /></div>
      <div className="field"><label>Confirmar palavra-passe</label><input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></div>
      {twoFa ? (
        <div className="field"><label>Código da verificação em 2 passos</label>
          <div className="tf-inline">
            <input className="tf-code sm" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6} />
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void send()}>{sentTo ? 'Reenviar' : 'Enviar código'}</button>
          </div>
          {sentTo ? <p className="tf-sent" style={{ margin: '6px 0 0' }}>Enviado para <b>{sentTo}</b></p> : null}
        </div>
      ) : null}
      <button className="btn block" onClick={() => void save()} disabled={busy || !valid}>Alterar palavra-passe</button>
    </>
  );
}
