import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type {
  AppPlatform,
  BankAccount,
  LandingConfig,
  PlanTier,
  PublicPlan,
  PublicRelease,
  RegisterCompanyResult,
} from '../api/types';
import { LOGO_WIDE } from '../brand';
import { CAIXA_URL, STORE_URL } from '../config';
import { IconCheck } from '../components/Icons';
import { SupportChat } from '../components/SupportChat';
import { FeedbackSection } from '../components/FeedbackSection';
import { DownloadApps } from '../sections/DownloadApps';
import { LANGS, dict, fill, initialLang, type LandingLang } from './landingI18n';
import '../landingV.css';
import { initLandingReveal } from '../landingReveal';

/** Duração do ciclo do plano: 1 → "mês", N → "N meses". */
function dur(months: number): string {
  return months <= 1 ? 'mês' : `${months} meses`;
}

function kzNum(n: number): string {
  return n.toLocaleString('pt-PT', { maximumFractionDigits: 0 });
}
function kz(n: number): string {
  return kzNum(n) + ' Kz';
}

interface Props {
  onGoLogin(): void; // abre o painel de login normal
  onGoRegister?(): void; // abre o registo simples (email/Google)
}

const IMG = (f: string) => `${import.meta.env.BASE_URL}landing/${f}`;
const UNSPLASH = (id: string, w = 900) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;
/** Fotos da secção "Porquê escolher" (uma por slide). */
const WHY_PHOTOS = ['photo-1522529599102-193c0d76b5b6', 'photo-1531123897727-8f129e1688ce', 'photo-1611432579699-484f7990b127', 'photo-1615813967515-e1838c1c5116'];

type SolTab = 'fat' | 'ret' | 'rest';
type Peek = 'desktop' | 'mobile' | 'tablet';

/** Mostra o elemento (classe .in) quando entra no ecrã — as entradas suaves da referência. */
function useInView<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { threshold: 0.18 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

/** Número que conta de 0 até ao valor quando aparece. */
function CountUp({ to, prefix = '', suffix = '', decimals = 0, run }: { to: number; prefix?: string; suffix?: string; decimals?: number; run: boolean }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) return;
    let raf = 0; const t0 = performance.now(); const D = 1600;
    const step = (t: number) => { const p = Math.min(1, (t - t0) / D); setV(to * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [run, to]);
  return <>{prefix}{v.toLocaleString('pt-PT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</>;
}

/** Terminal POS (monitor com pé) com a captura real do caixa. */
function PosTerminal({ src, className = '' }: { src: string; className?: string }) {
  return (
    <div className={`lv-term ${className}`} aria-hidden="true">
      <div className="lv-term-screen"><img src={src} alt="" loading="eager" /></div>
      <div className="lv-term-neck" />
      <div className="lv-term-base" />
    </div>
  );
}

function Laptop({ src }: { src: string }) {
  return (
    <div className="lv-laptop" aria-hidden="true">
      <div className="lv-laptop-lid"><img src={src} alt="" loading="lazy" /></div>
      <div className="lv-laptop-base" />
    </div>
  );
}

function Tablet({ src, className = '' }: { src: string; className?: string }) {
  return <div className={`lv-tablet ${className}`} aria-hidden="true"><img src={src} alt="" loading="lazy" /></div>;
}

function Phone({ src, className = '' }: { src: string; className?: string }) {
  return <div className={`lv-phone ${className}`} aria-hidden="true"><i /><img src={src} alt="" loading="lazy" /></div>;
}

const SOCIAL = {
  whatsapp: <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden><path d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.02zm-7.01 15.24a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.69 8.23-8.23 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.39.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07s.89 2.4 1.01 2.56c.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z" /></svg>,
  mail: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>,
  phone: <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.4 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.5 2.8.6a2 2 0 0 1 1.8 2Z" /></svg>,
  store: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 7h12l1 13H5L6 7Z" /><path d="M9 10V6a3 3 0 0 1 6 0v4" /></svg>,
};

const BADGE_ICONS: Record<'android' | 'windows' | 'store', React.ReactNode> = {
  android: <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden><path fill="#3ddc84" d="M17.6 9.5a.9.9 0 1 1 1.8 0v5.6a.9.9 0 1 1-1.8 0zM4.6 9.5a.9.9 0 1 1 1.8 0v5.6a.9.9 0 1 1-1.8 0zM7 8.9h10v8.1a1.2 1.2 0 0 1-1.2 1.2h-.9v2.6a1.1 1.1 0 0 1-2.2 0v-2.6h-1.4v2.6a1.1 1.1 0 0 1-2.2 0v-2.6h-.9A1.2 1.2 0 0 1 7 17zM7.1 8.3a5 5 0 0 1 9.8 0z" /></svg>,
  windows: <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden><path fill="#fff" d="M2.5 4.9 10.2 3.8v7.5H2.5zM11.3 3.65 21.5 2.2v9.1H11.3zM2.5 12.4h7.7v7.5l-7.7-1.1zM11.3 12.4h10.2v9.4l-10.2-1.4z" /></svg>,
  store: <img src={`${import.meta.env.BASE_URL}app-icon-loja.png`} alt="" width={26} height={26} style={{ borderRadius: 6 }} />,
};

export function Landing({ onGoLogin, onGoRegister }: Props) {
  const { loginTenant } = useAuth();
  const [data, setData] = useState<{ config: LandingConfig; plans: PublicPlan[] } | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [presetTier, setPresetTier] = useState<PlanTier>('BUSINESS');
  const [releases, setReleases] = useState<Record<AppPlatform, PublicRelease | null> | null>(null);
  const [lang, setLang] = useState<LandingLang>(initialLang);
  const [langOpen, setLangOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [sol, setSol] = useState<SolTab>('fat');
  const [why, setWhy] = useState(0);
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [peek, setPeek] = useState<Peek>('desktop');
  const t = dict(lang);

  // Aparecer/desaparecer ao rolar (nos dois sentidos); conteúdo que chega
  // depois (planos, comentários) é apanhado pelo MutationObserver do módulo.
  useEffect(() => initLandingReveal(), []);

  useEffect(() => {
    api.publicLanding().then(setData).catch(() => setData(null));
    api.publicDownloads().then(setReleases).catch(() => setReleases(null));
  }, []);

  useEffect(() => {
    try { localStorage.setItem('lps:lang', lang); } catch { /* */ }
    document.documentElement.lang = lang === 'pt' ? 'pt-AO' : lang;
  }, [lang]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Fecha os menus suspensos ao clicar fora / Esc.
  useEffect(() => {
    if (!langOpen && !helpOpen && !menuOpen) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      const el = e.target as HTMLElement | null;
      if (e.type === 'pointerdown' && el?.closest('.lv-dd, .lv-burger, .lv-mmenu')) return;
      setLangOpen(false); setHelpOpen(false); if (e.type === 'keydown') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [langOpen, helpOpen, menuOpen]);

  // Slides "Porquê escolher": rodam sozinhos.
  useEffect(() => {
    const id = window.setInterval(() => setWhy((w) => (w + 1) % 4), 6500);
    return () => window.clearInterval(id);
  }, [why]);

  const cfg = data?.config;
  const brand = cfg?.brandName ?? 'LPS Vendas';
  const trialDays = cfg?.trialDays ?? 14;
  const plans = data?.plans ?? [];
  const ads = (cfg?.showAds && cfg?.ads?.filter((a) => a.active !== false)) || [];

  const openRegister = (tier: PlanTier = 'BUSINESS') => {
    if (onGoRegister) { onGoRegister(); return; }
    setPresetTier(tier);
    setShowRegister(true);
  };
  const goSol = (s: SolTab) => {
    setSol(s); setMenuOpen(false);
    document.getElementById('solucoes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const relHref = (p: AppPlatform) => releases?.[p]?.downloadUrl || releases?.[p]?.downloadPageUrl || '#baixar';

  const [statsRef, statsIn] = useInView<HTMLElement>();
  const [solRef, solIn] = useInView<HTMLElement>();
  const [plansRef, plansIn] = useInView<HTMLElement>();
  const [peekRef, peekIn] = useInView<HTMLElement>();

  const SOL: Record<SolTab, { title: string; items: string[]; tags: string[]; media: React.ReactNode }> = {
    fat: { title: t.tabFatT, items: t.tabFat, tags: t.tabFatFor, media: <Laptop src={IMG('painel.webp')} /> },
    ret: { title: t.tabRetT, items: t.tabRet, tags: t.tabRetFor, media: <PosTerminal src={IMG('caixa-pos.webp')} className="sm" /> },
    rest: { title: t.tabRestT, items: t.tabRest, tags: t.tabRestFor, media: <div className="lv-duo"><Tablet src={IMG('caixa-pos.webp')} /><Phone src={IMG('caixa-grelha.webp')} className="over" /></div> },
  };
  const WHY = [[t.why1T, t.why1], [t.why2T, t.why2], [t.why3T, t.why3], [t.why4T, t.why4]];
  const curLang = LANGS.find((l) => l.code === lang)!;

  const Cta = ({ className = '', label = t.tryFree }: { className?: string; label?: string }) => (
    <button type="button" className={`lv-btn ${className}`} onClick={() => openRegister('BUSINESS')}>{label}</button>
  );

  return (
    <div className="lv" id="top">
      {/* ── Barra de topo fixa ───────────────────────────── */}
      <nav className={`lv-nav${scrolled ? ' scrolled' : ''}`}>
        <div className="lv-nav-in">
          <a className="lv-logo" href="#top" aria-label={brand}><img src={LOGO_WIDE} alt="" /></a>
          <div className="lv-dd lv-lang">
            <button type="button" className="lv-lang-btn" aria-haspopup="menu" aria-expanded={langOpen} onClick={() => { setLangOpen((v) => !v); setHelpOpen(false); }}>
              {curLang.short}<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {langOpen ? (
              <div className="lv-menu" role="menu">
                {LANGS.map((l) => (
                  <button key={l.code} type="button" role="menuitemradio" aria-checked={l.code === lang} className={l.code === lang ? 'on' : ''} onClick={() => { setLang(l.code); setLangOpen(false); }}>
                    <b>{l.short}</b>{l.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="lv-links lv-links-l">
            <button type="button" onClick={() => goSol('fat')}>{t.navFat}</button>
            <button type="button" onClick={() => goSol('ret')}>{t.navRet}</button>
            <button type="button" onClick={() => goSol('rest')}>{t.navRest}</button>
          </div>
          <span className="lv-sp" />
          <div className="lv-links">
            <a href="#planos">{t.navPrices}</a>
            <a href="#baixar">{t.navApps}</a>
            <div className="lv-dd">
              <button type="button" aria-haspopup="menu" aria-expanded={helpOpen} onClick={() => { setHelpOpen((v) => !v); setLangOpen(false); }}>
                {t.navHelp}<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
              </button>
              {helpOpen ? (
                <div className="lv-menu right" role="menu">
                  <a role="menuitem" href="#faq" onClick={() => setHelpOpen(false)}>{t.navFaq}</a>
                  <a role="menuitem" href="#contacto" onClick={() => setHelpOpen(false)}>{t.navContact}</a>
                  <a role="menuitem" href="#comentarios" onClick={() => setHelpOpen(false)}>{t.navComments}</a>
                </div>
              ) : null}
            </div>
          </div>
          <button type="button" className="lv-btn-o" onClick={onGoLogin}>{t.login}</button>
          <button type="button" className="lv-btn sm" onClick={() => openRegister('BUSINESS')}>{t.signup}</button>
          <button type="button" className="lv-burger" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}><span /><span /><span /></button>
        </div>
        <div className={`lv-mmenu${menuOpen ? ' open' : ''}`} aria-hidden={!menuOpen}>
          <button type="button" onClick={() => goSol('fat')}>{t.navFat}</button>
          <button type="button" onClick={() => goSol('ret')}>{t.navRet}</button>
          <button type="button" onClick={() => goSol('rest')}>{t.navRest}</button>
          <a href="#planos" onClick={() => setMenuOpen(false)}>{t.navPrices}</a>
          <a href="#baixar" onClick={() => setMenuOpen(false)}>{t.navApps}</a>
          <a href="#faq" onClick={() => setMenuOpen(false)}>{t.navFaq}</a>
          <div className="lv-mmenu-acts">
            <button type="button" className="lv-btn-o" onClick={() => { setMenuOpen(false); onGoLogin(); }}>{t.login}</button>
            <button type="button" className="lv-btn" onClick={() => { setMenuOpen(false); openRegister('BUSINESS'); }}>{t.signup}</button>
          </div>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────── */}
      <header className="lv-hero">
        <div className="lv-hero-in">
          <div className="lv-hero-copy">
            <h1><span className="lv-up d1">{t.heroA}</span><b className="lv-up d2">{t.heroB}</b></h1>
            <p className="lv-up d3">{t.heroSub}</p>
            <div className="lv-up d4">
              <Cta className="white big" />
              <small className="lv-trial">{fill(t.trialNote, { n: trialDays })}</small>
            </div>
          </div>
          <div className="lv-cert lv-up d5">
            <span className="lv-cert-ic" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>
            </span>
            <b>{t.certified}</b>
          </div>
        </div>
        <div className="lv-hero-art" aria-hidden="true">
          <div className="lv-hero-panel" />
          <PosTerminal src={IMG('caixa-pos.webp')} className="hero" />
          <img className="lv-hero-person" src={IMG('pessoa-hero.webp')} alt="" />
        </div>
      </header>

      {/* ── Separadores Faturação / Retalho / Restauração ── */}
      <section className={`lv-sol${solIn ? ' in' : ''}`} id="solucoes" ref={solRef}>
        <div className="lv-wrap">
          <h2 className="lv-h2 center">{t.tabsTitle}</h2>
          <div className="lv-tabs" role="tablist">
            {(['fat', 'ret', 'rest'] as SolTab[]).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={sol === k} className={sol === k ? 'on' : ''} onClick={() => setSol(k)}>
                {k === 'fat' ? t.navFat : k === 'ret' ? t.navRet : t.navRest}
              </button>
            ))}
          </div>
          <div className="lv-sol-body" key={sol + lang}>
            <div className="lv-sol-media lv-fade f10">{SOL[sol].media}</div>
            <div className="lv-sol-txt">
              <h3 className="lv-fade f15">{SOL[sol].title}</h3>
              <ul className="lv-fade f20">{SOL[sol].items.map((x) => <li key={x}>{x}</li>)}</ul>
              <small className="lv-fade f20">{t.idealFor}</small>
              <div className="lv-tags lv-fade f20">{SOL[sol].tags.map((x) => <span key={x}>{x}</span>)}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Números ─────────────────────────────────────── */}
      <section className={`lv-stats${statsIn ? ' in' : ''}`} ref={statsRef}>
        <div className="lv-wrap lv-stats-in">
          <div className="lv-stats-txt">
            <h2 className="lv-h2">{t.statsTitle}</h2>
            <p>{t.statsText}</p>
            <Cta />
          </div>
          <div className="lv-stats-nums">
            <div><b><CountUp to={15} prefix="+" run={statsIn} /></b><span>{t.st1}</span></div>
            <div><b><CountUp to={10} prefix="+" run={statsIn} /></b><span>{t.st2}</span></div>
            <div><b><CountUp to={99.9} decimals={1} suffix="%" run={statsIn} /></b><span>{t.st3}</span></div>
          </div>
        </div>
      </section>

      {/* ── Porquê escolher (pessoa à esquerda) ─────────── */}
      <section className="lv-why" id="porque">
        <div className="lv-wrap">
          <div className="lv-why-card">
            <div className="lv-why-media" key={'m' + why}>
              <img className="lv-why-photo" src={UNSPLASH(WHY_PHOTOS[why], 700)} alt="" />
              <Tablet src={IMG('caixa-pos.webp')} className="lv-why-tab" />
            </div>
            <div className="lv-why-txt" key={'t' + why + lang}>
              <p className="lv-eyebrow">{t.whyEyebrow}</p>
              <h3>{WHY[why][0]}</h3>
              <p>{WHY[why][1]}</p>
              <Cta />
            </div>
          </div>
          <div className="lv-dots" role="tablist" aria-label={t.whyEyebrow}>
            {WHY.map((_, i) => <button key={i} type="button" role="tab" aria-selected={why === i} aria-label={String(i + 1)} className={why === i ? 'on' : ''} onClick={() => setWhy(i)} />)}
          </div>
        </div>
      </section>

      {/* ── Planos ──────────────────────────────────────── */}
      {cfg?.showPricing !== false && plans.length > 0 ? (
        <section className={`lv-plans${plansIn ? ' in' : ''}`} id="planos" ref={plansRef}>
          <div className="lv-wrap">
            <h2 className="lv-h2 center narrow">{fill(t.plansTitle, { n: trialDays })}</h2>
            <p className="lv-lead center">{t.plansSub}</p>
            <div className="lv-plan-grid">
              {plans.map((p, i) => (
                <article className={`lv-plan${p.highlight ? ' hi' : ''}`} key={p.id}>
                  <div className="lv-plan-h">
                    <div><h3>{p.name}</h3><p>{p.tagline ?? ''}</p></div>
                    {p.highlight ? <span className="lv-pop">{t.popular}</span> : null}
                  </div>
                  {p.tier === 'FREE' ? (
                    <div className="lv-price"><b>{t.free}</b></div>
                  ) : p.priceKz > 0 ? (
                    <div className="lv-price"><i>Kz</i><b>{kzNum(p.priceKz)}</b><em>{p.durationMonths <= 1 ? t.perMonth : fill(t.perN, { n: p.durationMonths })}</em></div>
                  ) : (
                    <div className="lv-price"><b className="sm">{t.onConsult}</b></div>
                  )}
                  <button type="button" className="lv-btn block" onClick={() => openRegister(p.tier)}>{t.tryFree}</button>
                  <ul>
                    <li><IconCheck size={16} /> {p.maxStores === -1 ? t.storesInf : fill(t.stores, { n: p.maxStores })}</li>
                    <li><IconCheck size={16} /> {p.maxUsers === -1 ? t.usersInf : fill(t.users, { n: p.maxUsers })}</li>
                    <li><IconCheck size={16} /> {p.maxProducts === -1 ? t.productsInf : fill(t.products, { n: p.maxProducts.toLocaleString('pt-PT') })}</li>
                    {p.modules.slice(0, 5).map((m) => <li key={m}><IconCheck size={16} /> {moduleLabel(m)}</li>)}
                  </ul>
                </article>
              ))}
            </div>
            <p className="lv-note">{t.pricesNote}</p>
          </div>
        </section>
      ) : null}

      {ads.length > 0 ? (
        <section className="lv-ads" id="novidades">
          <div className="lv-wrap lv-ads-grid">
            {ads.map((a, i) => (
              <div className="lv-ad" key={i} style={a.imageUrl ? { backgroundImage: `url('${a.imageUrl}')` } : undefined}>
                <h4>{a.title}</h4>
                {a.text ? <p>{a.text}</p> : null}
                {a.ctaLabel && a.ctaUrl ? <a href={a.ctaUrl} target="_blank" rel="noreferrer">{a.ctaLabel}</a> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Testemunhos (comentários da comunidade) ─────── */}
      <section className="lv-testi" id="comentarios">
        <div className="lv-wrap">
          <div className="lv-testi-h">
            <div><h2 className="lv-h2">{t.testiTitle}</h2><p>{t.testiSub}</p></div>
            <div className="lv-arrows">
              <button type="button" aria-label="‹" onClick={() => document.querySelector('.lv-testi .fb-list')?.scrollBy({ left: -360, behavior: 'smooth' })}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M19 12H5M11 6l-6 6 6 6" /></svg></button>
              <button type="button" className="on" aria-label="›" onClick={() => document.querySelector('.lv-testi .fb-list')?.scrollBy({ left: 360, behavior: 'smooth' })}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
            </div>
          </div>
          <FeedbackSection />
        </div>
      </section>

      {/* ── Perguntas frequentes ────────────────────────── */}
      <section className="lv-faq" id="faq">
        <div className="lv-wrap lv-faq-in">
          <div className="lv-faq-list">
            <h2 className="lv-h3">{t.faqTitle}</h2>
            {t.faq.map(([q, a], i) => (
              <div className={`lv-qa${faqOpen === i ? ' open' : ''}`} key={q}>
                <button type="button" aria-expanded={faqOpen === i} onClick={() => setFaqOpen(faqOpen === i ? null : i)}>
                  <span>{q.replace('{n}', String(trialDays))}</span><i aria-hidden="true">+</i>
                </button>
                <div className="lv-qa-a"><p>{a}</p></div>
              </div>
            ))}
          </div>
          <aside className="lv-faq-aside">
            <h3>{t.faqAside}</h3>
            <a className="lv-btn" href={cfg?.contactPhone ? `https://wa.me/${cfg.contactPhone.replace(/\D/g, '')}` : cfg?.contactEmail ? `mailto:${cfg.contactEmail}` : '#contacto'} target={cfg?.contactPhone ? '_blank' : undefined} rel="noreferrer">{t.talk}</a>
          </aside>
        </div>
      </section>

      {/* ── Espreitar (Desktop / Mobile / Tablet) + faixa azul ── */}
      <section className={`lv-peek${peekIn ? ' in' : ''}`} ref={peekRef}>
        <div className="lv-wrap">
          <h2 className="lv-h2 center">{t.peekTitleA}<br />{t.peekTitleB}</h2>
          <div className="lv-tabs" role="tablist">
            {(['desktop', 'mobile', 'tablet'] as Peek[]).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={peek === k} className={peek === k ? 'on' : ''} onClick={() => setPeek(k)}>{t[k]}</button>
            ))}
          </div>
        </div>
        <div className="lv-peek-stage">
          <div className="lv-peek-dev" key={peek}>
            {peek === 'desktop' ? <PosTerminal src={IMG('caixa-pos.webp')} className="peek" /> : peek === 'mobile' ? <Phone src={IMG('caixa-grelha.webp')} className="peek" /> : <Tablet src={IMG('caixa-pos.webp')} className="peek" />}
          </div>
        </div>
        <div className="lv-band">
          <div className="lv-wrap center">
            <h2>{t.ctaTitle}</h2>
            <p>{fill(t.ctaSub, { n: trialDays })}</p>
            <Cta className="white big" />
          </div>
        </div>
      </section>

      {/* ── Aplicações ──────────────────────────────────── */}
      <DownloadApps />

      {/* ── Rodapé ──────────────────────────────────────── */}
      <footer className="lv-foot" id="contacto">
        <div className="lv-wrap">
          <div className="lv-about">
            <h4>{t.aboutTitle}</h4>
            <p>{t.about}</p>
          </div>
          <div className="lv-fcols">
            <div><h5>{t.fWhy}</h5>
              <a href={STORE_URL} target="_blank" rel="noreferrer">{t.fStore}</a>
              <a href="#baixar">{t.fApps}</a>
              <a href="#comentarios">{t.fComments}</a>
              <a href={CAIXA_URL} target="_blank" rel="noreferrer">{t.fPos}</a>
            </div>
            <div><h5>{t.fBiz}</h5>
              <button type="button" onClick={() => goSol('fat')}>{t.fBizFat}</button>
              <button type="button" onClick={() => goSol('ret')}>{t.fBizPos}</button>
              <button type="button" onClick={() => goSol('rest')}>{t.fBizRest}</button>
              <button type="button" onClick={() => goSol('ret')}>{t.fBizShop}</button>
              <button type="button" onClick={() => goSol('ret')}>{t.fBizPharm}</button>
              <button type="button" onClick={() => goSol('fat')}>{t.fBizHotel}</button>
            </div>
            <div><h5>{t.fSupport}</h5>
              <a href="#faq">{t.fFaq}</a>
              {cfg?.contactEmail ? <a href={`mailto:${cfg.contactEmail}`}>{t.fHelp}</a> : <a href="#faq">{t.fHelp}</a>}
              {cfg?.contactPhone ? <a href={`tel:${cfg.contactPhone}`}>{t.fContacts}</a> : null}
            </div>
            <div><h5>{t.fAccount}</h5>
              <button type="button" onClick={onGoLogin}>{t.fLogin}</button>
              <button type="button" onClick={() => openRegister('BUSINESS')}>{t.fSignup}</button>
            </div>
          </div>
          <div className="lv-fbar">
            <img className="lv-flogo" src={LOGO_WIDE} alt={brand} />
            <div className="lv-social">
              {cfg?.contactPhone ? <a href={`https://wa.me/${cfg.contactPhone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" aria-label="WhatsApp">{SOCIAL.whatsapp}</a> : null}
              {cfg?.contactEmail ? <a href={`mailto:${cfg.contactEmail}`} aria-label="E-mail">{SOCIAL.mail}</a> : null}
              {cfg?.contactPhone ? <a href={`tel:${cfg.contactPhone}`} aria-label="Telefone">{SOCIAL.phone}</a> : null}
              <a href={STORE_URL} target="_blank" rel="noreferrer" aria-label={t.fStore}>{SOCIAL.store}</a>
            </div>
            <div className="lv-badges">
              <a className="lv-badge" href={relHref('android')} target={relHref('android').startsWith('#') ? undefined : '_blank'} rel="noreferrer">{BADGE_ICONS.android}<span><small>{t.availableOn}</small>Android</span></a>
              <a className="lv-badge" href={relHref('windows')} target={relHref('windows').startsWith('#') ? undefined : '_blank'} rel="noreferrer">{BADGE_ICONS.windows}<span><small>{t.availableOn}</small>Windows</span></a>
              <a className="lv-badge" href={relHref('android-loja')} target={relHref('android-loja').startsWith('#') ? undefined : '_blank'} rel="noreferrer">{BADGE_ICONS.store}<span><small>{t.availableOn}</small>LPS Loja</span></a>
            </div>
          </div>
          <div className="lv-copy">
            <span>{cfg?.footerText || `© ${new Date().getFullYear()} ${brand}. ${t.rights}`}</span>
            <span>Direitos reservados a <strong>Manuel Mbala Ndombaxi</strong> · Patrocinado pela <strong>Loja das Mulheres</strong></span>
          </div>
        </div>
      </footer>

      <SupportChat />

      {showRegister && (
        <RegisterModal
          presetTier={presetTier}
          plans={plans}
          onClose={() => setShowRegister(false)}
          onLogin={onGoLogin}
          loginTenant={loginTenant}
        />
      )}
    </div>
  );
}

function moduleLabel(m: string): string {
  const map: Record<string, string> = {
    POS: 'Caixa / POS',
    STOCK: 'Gestão de stock',
    ERP: 'ERP (compras/fornecedores)',
    ECOMMERCE: 'Loja online',
    OPENMANUS: 'Assistente IA',
    WHITE_LABEL: 'Marca própria (white-label)',
  };
  return map[m] ?? m;
}

// ── Modal de registo de empresa ─────────────────────────────
interface RegProps {
  presetTier: PlanTier;
  plans: PublicPlan[];
  onClose(): void;
  onLogin(): void;
  loginTenant(input: { companyCode: string; email: string; password: string }): Promise<void>;
}

function RegisterModal({ presetTier, plans, onClose, onLogin, loginTenant }: RegProps) {
  const [name, setName] = useState('');
  const [companyCode, setCompanyCode] = useState('');
  const [nif, setNif] = useState('');
  const [responsibleName, setResponsibleName] = useState('');
  const [responsibleEmail, setResponsibleEmail] = useState('');
  const [responsiblePhone, setResponsiblePhone] = useState('');
  const [planTier, setPlanTier] = useState<PlanTier>(presetTier);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RegisterCompanyResult | null>(null);

  // auto-sugere o código a partir do nome
  const onName = (v: string) => {
    setName(v);
    if (!companyCode || companyCode === slug(name)) setCompanyCode(slug(v));
  };

  const submit = async () => {
    setError(null);
    if (!name.trim() || !companyCode.trim() || !nif.trim() || !responsibleName.trim() || !responsibleEmail.trim()) {
      setError('Preencha todos os campos obrigatórios.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.registerCompany({
        companyCode: companyCode.trim(),
        name: name.trim(),
        nif: nif.trim(),
        responsibleName: responsibleName.trim(),
        responsibleEmail: responsibleEmail.trim(),
        responsiblePhone: responsiblePhone.trim() || undefined,
        planTier,
      });
      setDone(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível criar a conta.');
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return <SetupSubscription result={done} plans={plans} planTier={planTier} onLogin={onLogin} onClose={onClose} />;
  }

  return (
    <div className="lp-modal-bg" onClick={onClose}>
      <div className="lp-modal" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose}>×</button>
        <h3>Criar conta de empresa</h3>
        <p className="msub">Comece em minutos. A sua conta fica ativa após aprovação da plataforma.</p>
        {error && <div className="lp-err">{error}</div>}

        <div className="lp-field">
          <label>Nome da empresa *</label>
          <input value={name} onChange={(e) => onName(e.target.value)} placeholder="ex.: NovaShop Lda" autoFocus />
        </div>
        <div className="grid2">
          <div className="lp-field">
            <label>Código (login) *</label>
            <input value={companyCode} onChange={(e) => setCompanyCode(slug(e.target.value))} placeholder="novashop" />
          </div>
          <div className="lp-field">
            <label>NIF *</label>
            <input value={nif} onChange={(e) => setNif(e.target.value)} placeholder="5417000000" inputMode="numeric" />
          </div>
        </div>
        <div className="lp-field">
          <label>Nome do responsável *</label>
          <input value={responsibleName} onChange={(e) => setResponsibleName(e.target.value)} placeholder="Manuel ..." />
        </div>
        <div className="grid2">
          <div className="lp-field">
            <label>E-mail *</label>
            <input value={responsibleEmail} onChange={(e) => setResponsibleEmail(e.target.value)} placeholder="gestor@empresa.ao" />
          </div>
          <div className="lp-field">
            <label>Telefone</label>
            <input value={responsiblePhone} onChange={(e) => setResponsiblePhone(e.target.value)} placeholder="+244 ..." />
          </div>
        </div>
        <div className="lp-field">
          <label>Plano</label>
          <select value={planTier} onChange={(e) => setPlanTier(e.target.value as PlanTier)}>
            {plans.map((p) => (
              <option key={p.id} value={p.tier}>
                {p.name}{p.tier === 'FREE' ? ' — Grátis (teste)' : p.priceKz > 0 ? ` — ${kz(p.priceKz)}/${dur(p.durationMonths)}` : ' — sob consulta'}
              </option>
            ))}
          </select>
        </div>
        <button className="lp-btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} onClick={submit} disabled={loading}>
          {loading ? 'A criar conta…' : 'Criar conta'}
        </button>
        <p style={{ textAlign: 'center', marginTop: 14, fontSize: 13, color: '#5a6679' }}>
          Já tem conta? <a style={{ color: 'var(--lp-primary)', fontWeight: 700, cursor: 'pointer' }} onClick={onLogin}>Entrar</a>
        </p>
      </div>
    </div>
  );
}

function fileToB64(file: File): Promise<{ data: string; type: string; name: string }> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); res({ data: s.includes(',') ? s.slice(s.indexOf(',') + 1) : s, type: file.type || 'image/jpeg', name: file.name }); };
    r.onerror = () => rej(new Error('read'));
    r.readAsDataURL(file);
  });
}

function Creds({ result }: { result: RegisterCompanyResult }) {
  return (
    <div className="lp-ok" style={{ marginTop: 10 }}>
      <div className="lp-credlabel">Empresa</div><div className="lp-cred">{result.companyCode}</div>
      <div className="lp-credlabel" style={{ marginTop: 10 }}>E-mail</div><div className="lp-cred">{result.adminEmail}</div>
      <div className="lp-credlabel" style={{ marginTop: 10 }}>Senha temporária</div><div className="lp-cred">{result.temporaryPassword}</div>
    </div>
  );
}

/** Passo de subscrição na landing (sem login): escolher plano → IBAN → comprovativo. */
function SetupSubscription({
  result, plans, planTier, onLogin, onClose,
}: {
  result: RegisterCompanyResult;
  plans: PublicPlan[];
  planTier: PlanTier;
  onLogin(): void;
  onClose(): void;
}) {
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [planId, setPlanId] = useState('');
  const [bankId, setBankId] = useState('');
  const [sub, setSub] = useState<{ id: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPlanId((plans.find((p) => p.tier === planTier) ?? plans[0])?.id ?? '');
    void (async () => {
      try { const b = await api.banks(); setBanks(b); setBankId(b[0]?.id ?? ''); } catch { /* mostra credenciais à mesma */ }
    })();
  }, [plans, planTier]);

  const plan = plans.find((p) => p.id === planId);
  const bank = banks.find((b) => b.id === bankId);

  const createSub = async () => {
    setErr(null);
    if (!planId) { setErr('Escolhe um plano.'); return; }
    if (!bankId) { setErr('A plataforma ainda não configurou um IBAN. Entra depois e conclui a subscrição.'); return; }
    setBusy(true);
    try { setSub(await api.setup.createSubscription(result.setupToken, { planId, method: 'IBAN', bankAccountId: bankId })); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao subscrever.'); }
    finally { setBusy(false); }
  };

  const upload = async (file?: File) => {
    if (!file || !sub) return;
    if (file.size > 4_000_000) { setErr('Imagem demasiado grande (máx ~4 MB).'); return; }
    setBusy(true); setErr(null);
    try { const f = await fileToB64(file); await api.setup.submitProof(result.setupToken, sub.id, { fileName: f.name, fileType: f.type, fileData: f.data }); setSubmitted(true); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao enviar o comprovativo.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="lp-modal-bg" onClick={onClose}>
      <div className="lp-modal" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose}>×</button>
        {submitted ? (
          <>
            <h3>Comprovativo enviado</h3>
            <p className="msub">A tua subscrição está <b>em análise</b>. Assim que a plataforma aprovar, a tua conta fica <b>activa</b>. Entra depois com:</p>
            <Creds result={result} />
            <button className="lp-btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} onClick={onLogin}>Ir para o login</button>
          </>
        ) : !sub ? (
          <>
            <h3>Conta criada! Falta concluir a subscrição</h3>
            <p className="msub">Escolhe o plano e a conta para transferir. A seguir envias o comprovativo (obrigatório).</p>
            {err && <div className="lp-err">{err}</div>}
            <div className="lp-field">
              <label>Plano</label>
              <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}{p.priceKz > 0 ? ` — ${kz(p.priceKz)}/${p.durationMonths}m` : ' — sob consulta'}</option>)}
              </select>
            </div>
            <div className="lp-field">
              <label>Conta bancária (IBAN da plataforma)</label>
              <select value={bankId} onChange={(e) => setBankId(e.target.value)}>
                {banks.length === 0 ? <option value="">(ainda sem IBAN configurado)</option> : null}
                {banks.map((b) => <option key={b.id} value={b.id}>{b.bankName} — {b.iban}</option>)}
              </select>
            </div>
            <button className="lp-btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} onClick={createSub} disabled={busy || !planId}>
              {busy ? 'A criar…' : `Subscrever ${plan && plan.priceKz > 0 ? `(${kz(plan.priceKz)})` : ''}`}
            </button>
            <details style={{ marginTop: 12 }}>
              <summary className="msub" style={{ cursor: 'pointer' }}>Ver as minhas credenciais de acesso</summary>
              <Creds result={result} />
            </details>
          </>
        ) : (
          <>
            <h3>Paga e envia o comprovativo</h3>
            <p className="msub">Transfere <b>{plan ? kz(plan.priceKz) : ''}</b> para a conta da plataforma:</p>
            {bank ? (
              <div className="lp-ok" style={{ marginBottom: 12 }}>
                <div className="lp-credlabel">{bank.bankName} · {bank.accountHolder}</div>
                <div className="lp-cred">{bank.iban}</div>
              </div>
            ) : null}
            {err && <div className="lp-err">{err}</div>}
            <button className="lp-btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? 'A enviar…' : 'Enviar comprovativo (foto)'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
            <p className="msub" style={{ marginTop: 12, fontSize: 12 }}>A plataforma verifica o comprovativo e ativa a tua conta. Podes acompanhar e conversar depois de entrares.</p>
          </>
        )}
      </div>
    </div>
  );
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
