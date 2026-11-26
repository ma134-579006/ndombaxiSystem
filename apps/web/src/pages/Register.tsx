import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { AuthTestimonial } from '../api/types';
import { PasswordField } from '../components/PasswordField';
import { LOGO_WIDE } from '../brand';
import {
  appKind, btnStyle, FacebookCircle, facebookToken, GoogleGlyph, googleToken, lookVars, useAuthPublic, usePreloadSocial, useFitHeight,
} from './vendusAuth';

/** Tipos de negócio suportados (cada um adapta o painel ao seu serviço). */
const BUSINESS_TYPES: { id: string; label: string }[] = [
  { id: 'RETAIL', label: 'Vendas & Gestão de stock' },
  { id: 'RESTAURANT', label: 'Restauração' },
  { id: 'SERVICES', label: 'Serviços' },
  { id: 'HOSPITALITY', label: 'Hotelaria' },
  { id: 'CLINIC', label: 'Clínica / Saúde' },
  { id: 'PHARMACY', label: 'Farmácia' },
];

/** Coluna azul sem testemunhos configurados: os pontos fortes do sistema. */
const DEFAULT_SLIDES: AuthTestimonial[] = [
  { name: 'Faturação e SAF-T (AO)', text: 'Faturas, SAF-T (AO) e Facturação Electrónica integrada.' },
  { name: 'POS / Caixa', text: 'Venda rápida, táctil e mesmo sem internet.' },
  { name: 'Stock & Loja online', text: 'Inventário por armazém e a sua montra na internet, em Kwanzas.' },
];

/** Regras da password (iguais às do Vendus). */
function pwRules(p: string) {
  return { len: p.length >= 10, letter: /[A-Za-zÀ-ÿ]/.test(p), num: /\d/.test(p), sym: /[^A-Za-zÀ-ÿ0-9]/.test(p) };
}
const LEVELS = [
  { w: 0, c: '#ddd', t: 'Força da senha' },
  { w: 20, c: '#ff4d4d', t: 'Muito fraca' },
  { w: 40, c: '#ffa64d', t: 'Fraca' },
  { w: 60, c: '#e0c200', t: 'Média' },
  { w: 80, c: '#4dc94d', t: 'Forte' },
  { w: 100, c: '#25a025', t: 'Muito forte' },
];

/**
 * Criar conta no estilo Vendus: coluna azul com o logótipo e testemunhos que
 * rodam; à direita "Experimente N Dias Grátis", campos com etiqueta
 * flutuante, força da password, aceitação de novidades, "Criar Conta" e
 * Google/Facebook lado a lado. Textos, cores e testemunhos: Super Admin.
 */
export function Register({ onBack }: { onBack?: () => void }) {
  const { adoptSession } = useAuth();
  const pub = useAuthPublic();
  const fitRef = useFitHeight<HTMLDivElement>(30);
  const look = pub?.look;
  usePreloadSocial(pub?.facebookAppId ?? null);
  const plans = pub?.plans ?? [];
  const [planTier, setPlanTier] = useState('');
  const [businessType, setBusinessType] = useState('RETAIL');
  const [nif, setNif] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [optIn, setOptIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);
  const k = appKind();

  useEffect(() => { if (!planTier && plans[0]?.tier) setPlanTier(plans[0].tier); }, [plans, planTier]);
  const custom = (look?.testimonials ?? []).filter((t) => t.text && t.name);
  const slides = custom.length ? custom : DEFAULT_SLIDES;
  useEffect(() => {
    if (slides.length < 2) return;
    const t = window.setInterval(() => setSlide((s) => (s + 1) % slides.length), 6000);
    return () => window.clearInterval(t);
  }, [slides.length]);

  const rules = pwRules(password);
  const met = Object.values(rules).filter(Boolean).length;
  const level = !password ? LEVELS[0] : met === 4 ? (password.length >= 14 ? LEVELS[5] : LEVELS[4]) : LEVELS[Math.max(1, met)];

  const finish = (r: { tokens: { accessToken: string; refreshToken: string }; companyCode: string }) => adoptSession(r.tokens, r.companyCode);
  const base = () => ({ planTier: planTier || plans[0]?.tier || 'STARTER', businessType, nif: nif.trim() || undefined, marketingOptIn: optIn });

  const submitEmail = async () => {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Indique um e-mail válido.'); return; }
    if (met < 4) { setError('A password tem de ter pelo menos 10 caracteres, uma letra, um número e um símbolo.'); return; }
    setLoading(true);
    try { finish(await api.registerSimple({ ...base(), email: email.trim(), password })); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível criar a conta.'); }
    finally { setLoading(false); }
  };

  const viaSocial = async (kind: 'google' | 'facebook') => {
    setError(null);
    try {
      const t = kind === 'google' ? await googleToken() : await facebookToken(pub?.facebookAppId ?? null);
      if (!t) { setError(`Registo com ${kind === 'google' ? 'Google' : 'Facebook'} cancelado.`); return; }
      setLoading(true);
      finish(await api.registerSimple({ ...base(), ...(kind === 'google' ? { googleIdToken: t } : { facebookAccessToken: t }) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível criar a conta.');
    } finally { setLoading(false); }
  };

  const g = look?.google; const f = look?.facebook;
  const showGoogle = g?.enabled !== false;
  // Sem App ID publicado (Facebook Login por configurar) o botão não aparece.
  const showFacebook = f?.enabled !== false && !k.native && !!pub?.facebookAppId;
  const days = String(pub?.trialDays ?? 14);
  const title = look?.registerTitle?.replace('{dias}', days) || `Experimente ${days} Dias Grátis`;

  return (
    <div className="va" style={lookVars(look)}>
      <div className="va-reg">
        <aside className="va-side">
          <div className="va-side-logo"><img src={LOGO_WIDE} alt="LPS Vendas" /></div>
          <div className="va-tst-wrap">
            {slides.map((t, i) => (
              <div key={i} className={`va-tst${i === slide ? ' on' : ''}`} aria-hidden={i !== slide}>
                <div className="va-avatar">{t.photoUrl ? <img src={t.photoUrl} alt={t.name} /> : (custom.length ? t.name.trim().charAt(0).toUpperCase() : '★')}</div>
                <div className="va-tst-text">{custom.length ? `"${t.text}"` : t.text}</div>
                <div className="va-tst-author">{t.name}</div>
                {t.company ? <div className="va-tst-company">{t.company}</div> : null}
              </div>
            ))}
            {slides.length > 1 ? (
              <div className="va-dots">
                {slides.map((_, i) => <button key={i} type="button" className={`va-dot${i === slide ? ' on' : ''}`} aria-label={`${i + 1}`} onClick={() => setSlide(i)} />)}
              </div>
            ) : null}
          </div>
        </aside>

        <main className="va-main">
          <div className="va-form" ref={fitRef}>
            <div className="va-mlogo"><img src={LOGO_WIDE} alt="LPS Vendas" /></div>
            <div className="va-head">
              <h1>{title}</h1>
              <p>{look?.registerSubtitle || 'Sem compromisso, cancele quando quiser!'}</p>
            </div>

            {error ? <div className="va-error" role="alert">{error}</div> : null}

            <div className={plans.length > 1 ? 'va-fl2' : undefined}>
            <div className="va-fl">
              <select id="va-biz" value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
                {BUSINESS_TYPES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
              <label htmlFor="va-biz">Tipo de negócio</label>
            </div>
            {plans.length > 1 ? (
              <div className="va-fl">
                <select id="va-plan" value={planTier} onChange={(e) => setPlanTier(e.target.value)}>
                  {plans.map((p) => <option key={p.tier} value={p.tier}>{p.name}</option>)}
                </select>
                <label htmlFor="va-plan">Plano</label>
              </div>
            ) : null}
            </div>
            {look?.showNif !== false ? (
              <div className="va-fl">
                <input id="va-nif" type="text" inputMode="numeric" placeholder="NIF da sua Empresa" value={nif} onChange={(e) => setNif(e.target.value)} autoComplete="off" />
                <label htmlFor="va-nif">NIF</label>
              </div>
            ) : null}
            <div className="va-fl">
              <input id="va-email" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username"
                onKeyDown={(e) => { if (e.key === 'Enter') void submitEmail(); }} />
              <label htmlFor="va-email">Email</label>
            </div>
            <div className="va-fl pw">
              <PasswordField id="va-pass" value={password} onChange={setPassword} placeholder="Password" autoComplete="new-password"
                onEnter={() => void submitEmail()} inputClass="" wrapClass="va-pw" label={<label htmlFor="va-pass">Password</label>} />
              {password ? (
                <>
                  <div className="va-meter"><i style={{ width: `${level.w}%`, background: level.c }} /></div>
                  <div className="va-meter-txt"><span>{level.t}</span><span>{level.w}%</span></div>
                  <div className="va-reqs">
                    <div className={`va-req${rules.len ? ' ok' : ''}`}><b>{rules.len ? '✓' : '✗'}</b><span>Pelo menos 10 caracteres</span></div>
                    <div className={`va-req${rules.letter ? ' ok' : ''}`}><b>{rules.letter ? '✓' : '✗'}</b><span>Pelo menos uma letra</span></div>
                    <div className={`va-req${rules.num ? ' ok' : ''}`}><b>{rules.num ? '✓' : '✗'}</b><span>Pelo menos um número</span></div>
                    <div className={`va-req${rules.sym ? ' ok' : ''}`}><b>{rules.sym ? '✓' : '✗'}</b><span>Pelo menos um símbolo</span></div>
                  </div>
                </>
              ) : null}
            </div>

            <div className="va-check">
              <input id="va-optin" type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
              <label htmlFor="va-optin">{look?.optInLabel || 'Aceito receber Novidades e Campanhas sobre o LPS Vendas'}</label>
            </div>

            <button type="button" className="va-btn-sq" style={look?.primary ? { background: look.primary } : undefined} onClick={() => void submitEmail()} disabled={loading}>
              {loading ? <span className="va-spin" role="status" aria-label="A criar" /> : null}
              <span>Criar Conta</span>
            </button>

            {showGoogle || showFacebook ? (
              <>
                <div className="va-divider">ou</div>
                <div className="va-srow">
                  {showGoogle ? (
                    <button type="button" className="va-sbtn" style={btnStyle(g)} disabled={loading} onClick={() => void viaSocial('google')}>
                      <GoogleGlyph />{g?.label || 'Entrar com Google'}
                    </button>
                  ) : null}
                  {showFacebook ? (
                    <button type="button" className="va-sbtn" style={btnStyle(f)} disabled={loading} onClick={() => void viaSocial('facebook')}>
                      <FacebookCircle />{f?.label || 'Entrar com Facebook'}
                    </button>
                  ) : null}
                </div>
              </>
            ) : <div style={{ height: 30 }} />}

            <div className="va-loginlink">Já tem uma conta LPS Vendas? {onBack ? <a onClick={onBack}>Login</a> : null}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
