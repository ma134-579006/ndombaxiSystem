import React, { useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { kw, type TwoFaStatus } from './api';

/** Pedido que o servidor travou à espera do código da verificação em 2 passos. */
export interface CodeAsk { channel: string; to: string }
/** O erro é "falta o código"? Devolve o canal e o destino mascarado. */
export function codeAsk(e: unknown): CodeAsk | null {
  const d = e instanceof ApiError ? (e.data as { error?: string; channel?: string; to?: string } | undefined) : undefined;
  return d?.error === 'TwoFaRequired' ? { channel: d.channel ?? 'EMAIL', to: d.to ?? '' } : null;
}

const MailI = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
const ChatI = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.2-4.2A8.5 8.5 0 1 1 20 11.5Z" /></svg>;
const ShieldI = ({ on }: { on: boolean }) => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4 6v6c0 4.4 3.4 8.3 8 9 4.6-.7 8-4.6 8-9V6l-8-3Z" />{on ? <path d="m8.5 12 2.5 2.5 4.5-5" /> : <path d="M12 8v5M12 16h.01" />}</svg>;

/** Caixa do código: canal, destino, 6 dígitos e reenviar (30 s). */
export function CodeBox({ ask, code, setCode, onResend, onEnter, busy }: { ask: CodeAsk; code: string; setCode(v: string): void; onResend?(): void; onEnter?(): void; busy?: boolean }) {
  const [until, setUntil] = useState(() => Date.now() + 30_000);
  const [, tick] = useState(0);
  useEffect(() => { setUntil(Date.now() + 30_000); }, [ask.to, ask.channel]);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 1000); return () => window.clearInterval(t); }, []);
  const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
  return (
    <div className="kw-2fa">
      <div className="kw-2fa-h">
        <span className="kw-2fa-ic" aria-hidden>{ask.channel === 'WHATSAPP' ? <ChatI /> : <MailI />}</span>
        <span><b>Verificação em 2 passos</b><small>Código enviado {ask.channel === 'WHATSAPP' ? 'por WhatsApp' : 'por e-mail'} para {ask.to}</small></span>
      </div>
      <input className="kw-2fa-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6} autoFocus
        aria-label="Código de verificação" onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) { e.preventDefault(); onEnter?.(); } }} />
      {onResend ? <button type="button" className="kw-2fa-resend" disabled={busy || left > 0} onClick={() => { setUntil(Date.now() + 30_000); onResend(); }}>{left > 0 ? `Reenviar código (${left} s)` : 'Reenviar código'}</button> : null}
    </div>
  );
}

/** Cartão do perfil: ligar/desligar a verificação em 2 passos (desligada por omissão). */
export function TwoFaCard({ token, email, phone, onStatus }: { token: string; email: string | null; phone: string; onStatus?(s: TwoFaStatus): void }) {
  const [st, setSt] = useState<TwoFaStatus | null>(null);
  const [step, setStep] = useState<'idle' | 'choose' | 'confirm' | 'disable'>('idle');
  const [method, setMethod] = useState<'EMAIL' | 'WHATSAPP'>('WHATSAPP');
  const [target, setTarget] = useState(phone);
  const [code, setCode] = useState(''); const [ask, setAsk] = useState<CodeAsk | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { kw.twoFa.status(token).then((s) => { setSt(s); onStatus?.(s); }).catch(() => undefined); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<void>) => { setErr(null); setBusy(true); try { await fn(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível.'); } finally { setBusy(false); } };
  const done = (s: TwoFaStatus) => { setSt(s); onStatus?.(s); setStep('idle'); setCode(''); setAsk(null); };
  const on = !!st?.enabled; const ch = st?.channels ?? { email: false, whatsapp: false };
  return (
    <section className={`kw-tf${on ? ' on' : ''}`}>
      <div className="kw-tf-h">
        <span className="kw-tf-sh"><ShieldI on={on} /></span>
        <div><b>Verificação em 2 passos</b><span className={`kw-tf-pill${on ? ' on' : ''}`}>{on ? `Ligada · ${st?.method === 'WHATSAPP' ? 'WhatsApp' : 'E-mail'} ${st?.to ?? ''}` : 'Desligada'}</span></div>
        {step === 'idle' ? (on
          ? <button type="button" className="kw-btn" disabled={busy} onClick={() => void run(async () => { const r = await kw.twoFa.disableRequest(token); setAsk({ channel: r.channel, to: r.to }); setStep('disable'); })}>Desligar</button>
          : <button type="button" className="kw-btn kw-btn-primary" disabled={!ch.email && !ch.whatsapp} onClick={() => { const m = ch.whatsapp ? 'WHATSAPP' : 'EMAIL'; setMethod(m); setTarget(m === 'WHATSAPP' ? phone : email ?? ''); setStep('choose'); }}>Ligar</button>) : null}
      </div>
      {err ? <div className="kw-err">{err}</div> : null}
      {step === 'choose' ? (
        <div className="kw-tf-b">
          <div className="kw-tf-m" role="radiogroup">
            <button type="button" role="radio" aria-checked={method === 'WHATSAPP'} className={method === 'WHATSAPP' ? 'sel' : ''} disabled={!ch.whatsapp} onClick={() => { setMethod('WHATSAPP'); setTarget(phone); }}><ChatI /> WhatsApp</button>
            <button type="button" role="radio" aria-checked={method === 'EMAIL'} className={method === 'EMAIL' ? 'sel' : ''} disabled={!ch.email} onClick={() => { setMethod('EMAIL'); setTarget(email ?? ''); }}><MailI /> E-mail</button>
          </div>
          <label className="kw-f"><span>{method === 'WHATSAPP' ? 'Número de WhatsApp' : 'E-mail'}</span><input value={target} onChange={(e) => setTarget(e.target.value)} inputMode={method === 'WHATSAPP' ? 'tel' : 'email'} /></label>
          <div className="kw-tf-act"><button type="button" className="kw-btn" onClick={() => setStep('idle')}>Cancelar</button>
            <button type="button" className="kw-btn kw-btn-primary" disabled={busy || target.trim().length < 6} onClick={() => void run(async () => { const r = await kw.twoFa.setup(token, method, target); setAsk({ channel: r.channel, to: r.to }); setCode(''); setStep('confirm'); })}>{busy ? 'A enviar…' : 'Enviar código'}</button></div>
        </div>
      ) : null}
      {(step === 'confirm' || step === 'disable') && ask ? (
        <div className="kw-tf-b">
          <CodeBox ask={ask} code={code} setCode={setCode} busy={busy} onEnter={() => void run(async () => done(step === 'confirm' ? await kw.twoFa.confirm(token, code) : await kw.twoFa.disable(token, code)))} />
          <div className="kw-tf-act"><button type="button" className="kw-btn" onClick={() => { setStep('idle'); setCode(''); }}>Cancelar</button>
            <button type="button" className={`kw-btn ${step === 'disable' ? 'kw-btn-danger' : 'kw-btn-primary'}`} disabled={busy || code.length !== 6} onClick={() => void run(async () => done(step === 'confirm' ? await kw.twoFa.confirm(token, code) : await kw.twoFa.disable(token, code)))}>{step === 'confirm' ? 'Confirmar e ligar' : 'Desligar'}</button></div>
        </div>
      ) : null}
    </section>
  );
}

/** Contagem decrescente do prazo de um saque (h e min). */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(t); }, [ms]);
  return now;
}
export const leftText = (iso: string, now: number) => {
  const s = Math.floor((new Date(iso).getTime() - now) / 1000);
  if (s <= 0) return null;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h ${String(m).padStart(2, '0')} min`;
};
