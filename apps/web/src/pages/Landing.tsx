import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type {
  LandingConfig,
  PlanTier,
  PublicPlan,
  RegisterCompanyResult,
} from '../api/types';
import { LOGO_SRC } from '../brand';
import { IconBuilding, IconCheck, IconShield } from '../components/Icons';

/** Imagem de fundo realista (comércio/loja angolana) — usada se o Super Admin
 *  não definir uma própria. Unsplash, tema retalho/mercado. */
const DEFAULT_HERO =
  'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=1920&q=80';

function kz(n: number): string {
  return n.toLocaleString('pt-PT', { maximumFractionDigits: 0 }) + ' Kz';
}

function FeatureIcon() {
  return <IconCheck size={24} />;
}

interface Props {
  onGoLogin(): void; // abre o painel de login normal
}

export function Landing({ onGoLogin }: Props) {
  const { loginTenant } = useAuth();
  const [data, setData] = useState<{ config: LandingConfig; plans: PublicPlan[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRegister, setShowRegister] = useState(false);
  const [presetTier, setPresetTier] = useState<PlanTier>('BUSINESS');

  useEffect(() => {
    api
      .publicLanding()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const cfg = data?.config;
  const primary = cfg?.primaryColor || '#2563eb';
  const accent = cfg?.accentColor || '#0ea5e9';
  // Carrossel: heroImages (várias, rodam sozinhas) → heroImageUrl → default.
  const heroImages =
    cfg?.heroImages && cfg.heroImages.length > 0
      ? cfg.heroImages
      : cfg?.heroImageUrl
        ? [cfg.heroImageUrl]
        : [DEFAULT_HERO];
  const heroInterval = cfg?.heroIntervalMs || 5000;
  const plans = data?.plans ?? [];
  const features = cfg?.features?.length ? cfg.features : [];
  const ads = (cfg?.showAds && cfg?.ads?.filter((a) => a.active !== false)) || [];

  const openRegister = (tier: PlanTier) => {
    setPresetTier(tier);
    setShowRegister(true);
  };

  return (
    <div className="lp" style={{ ['--lp-primary' as string]: primary, ['--lp-accent' as string]: accent }}>
      {/* NAV */}
      <nav className="lp-nav">
        <img className="logo" src={LOGO_SRC} alt={cfg?.brandName ?? 'Ndombaxi'} />
        <span className="nm">{cfg?.brandName ?? 'Ndombaxi System'}</span>
        <span className="spacer" />
        <button className="ghost" onClick={onGoLogin}>Entrar</button>
        <button className="solid" onClick={() => openRegister('BUSINESS')}>Criar conta</button>
      </nav>

      {/* HERO com carrossel animado de imagens realistas */}
      <header className="lp-hero">
        <HeroCarousel images={heroImages} intervalMs={heroInterval} />
        <div className="lp-hero-inner">
          <span className="badge-pill">🇦🇴 Feito para Angola · Conforme AGT</span>
          <h1>{cfg?.heroTitle ?? 'O sistema de gestão e vendas para Angola'}</h1>
          <p className="sub">
            {cfg?.heroSubtitle ??
              'POS, stock, facturação AGT, loja online e IA — tudo num só lugar, em Kwanzas.'}
          </p>
          <div className="cta-row">
            <button className="lp-btn primary" onClick={() => openRegister('BUSINESS')}>
              {cfg?.heroCtaPrimary ?? 'Criar conta grátis'}
            </button>
            <button className="lp-btn outline" onClick={onGoLogin}>
              {cfg?.heroCtaSecondary ?? 'Entrar'}
            </button>
          </div>
          <div className="lp-trust">
            <span><IconCheck size={15} /> Facturação certificada AGT</span>
            <span><IconCheck size={15} /> Funciona offline na caixa</span>
            <span><IconCheck size={15} /> Loja online incluída</span>
          </div>
        </div>
      </header>

      {/* FUNCIONALIDADES */}
      {features.length > 0 && (
        <section className="lp-section">
          <div className="wrap">
            <h2>Tudo o que o seu negócio precisa</h2>
            <p className="lead">Uma plataforma completa, pensada para a realidade comercial angolana.</p>
            <div className="lp-features">
              {features.map((f, i) => (
                <div className="lp-feat" key={i}>
                  <div className="ic"><FeatureIcon /></div>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* PLANOS / PREÇOS */}
      {cfg?.showPricing !== false && plans.length > 0 && (
        <section className="lp-section alt">
          <div className="wrap">
            <h2>Planos simples, preços em Kwanzas</h2>
            <p className="lead">Escolha o plano do seu tamanho. Cancele quando quiser.</p>
            <div className="lp-plans">
              {plans.map((p) => (
                <div className={`lp-plan${p.highlight ? ' highlight' : ''}`} key={p.id}>
                  {p.highlight && <span className="pop">⭐ Mais popular</span>}
                  <div className="pname">{p.name}</div>
                  <div className="ptag">{p.tagline ?? ''}</div>
                  {p.priceKz > 0 ? (
                    <div className="price">{kz(p.priceKz)}<small> /mês</small></div>
                  ) : (
                    <div className="price neg">Sob consulta</div>
                  )}
                  <ul>
                    <li><IconCheck size={16} /> {p.maxStores === -1 ? 'Lojas ilimitadas' : `${p.maxStores} loja(s)`}</li>
                    <li><IconCheck size={16} /> {p.maxUsers === -1 ? 'Utilizadores ilimitados' : `${p.maxUsers} utilizadores`}</li>
                    <li><IconCheck size={16} /> {p.maxProducts === -1 ? 'Produtos ilimitados' : `${p.maxProducts.toLocaleString('pt-PT')} produtos`}</li>
                    {p.modules.map((m) => (
                      <li key={m}><IconCheck size={16} /> {moduleLabel(m)}</li>
                    ))}
                  </ul>
                  <button className="pick" onClick={() => openRegister(p.tier)}>
                    {p.priceKz > 0 ? 'Começar agora' : 'Falar connosco'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ANÚNCIOS / PUBLICIDADES */}
      {ads.length > 0 && (
        <section className="lp-section">
          <div className="wrap">
            <h2>Novidades</h2>
            <div className="lp-ads">
              {ads.map((a, i) => (
                <div className="lp-ad" key={i} style={a.imageUrl ? { backgroundImage: `url('${a.imageUrl}')` } : undefined}>
                  <h4>{a.title}</h4>
                  {a.text && <p>{a.text}</p>}
                  {a.ctaLabel && a.ctaUrl && <a href={a.ctaUrl} target="_blank" rel="noreferrer">{a.ctaLabel}</a>}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* RODAPÉ */}
      <footer className="lp-footer">
        <div className="contacts">
          {cfg?.contactEmail && <a href={`mailto:${cfg.contactEmail}`}>{cfg.contactEmail}</a>}
          {cfg?.contactPhone && <a href={`tel:${cfg.contactPhone}`}>{cfg.contactPhone}</a>}
        </div>
        <div>{cfg?.footerText ?? '© Ndombaxi System — Desenvolvido por Manuel Mbala Tomás Ndombaxi'}</div>
      </footer>

      {loading && null}

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

/** Carrossel de fundo do hero — crossfade automático entre imagens. */
function HeroCarousel({ images, intervalMs }: { images: string[]; intervalMs: number }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (images.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % images.length), Math.max(2000, intervalMs));
    return () => clearInterval(t);
  }, [images.length, intervalMs]);
  return (
    <div className="lp-hero-bg" aria-hidden="true">
      {images.map((src, i) => (
        <div
          key={i}
          className={`lp-hero-slide${i === idx ? ' on' : ''}`}
          style={{ backgroundImage: `url('${src}')` }}
        />
      ))}
      {images.length > 1 && (
        <div className="lp-hero-dots">
          {images.map((_, i) => (
            <span key={i} className={i === idx ? 'on' : ''} onClick={() => setIdx(i)} />
          ))}
        </div>
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
    return (
      <div className="lp-modal-bg" onClick={onClose}>
        <div className="lp-modal" onClick={(e) => e.stopPropagation()}>
          <button className="x" onClick={onClose}>×</button>
          <h3>Conta criada! 🎉</h3>
          <p className="msub">
            A empresa <b>{done.companyCode}</b> foi registada e está <b>a aguardar aprovação</b> da plataforma.
            Guarde estas credenciais — vai precisar delas para entrar assim que for aprovada:
          </p>
          <div className="lp-ok" style={{ marginBottom: 14 }}>
            <div className="lp-credlabel">Empresa</div>
            <div className="lp-cred">{done.companyCode}</div>
            <div className="lp-credlabel" style={{ marginTop: 10 }}>E-mail</div>
            <div className="lp-cred">{done.adminEmail}</div>
            <div className="lp-credlabel" style={{ marginTop: 10 }}>Palavra-passe temporária</div>
            <div className="lp-cred">{done.temporaryPassword}</div>
          </div>
          <button className="lp-btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={onLogin}>
            Ir para o login
          </button>
        </div>
      </div>
    );
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
                {p.name}{p.priceKz > 0 ? ` — ${kz(p.priceKz)}/mês` : ' — sob consulta'}
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

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
