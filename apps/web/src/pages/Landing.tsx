import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type {
  BankAccount,
  LandingConfig,
  PlanTier,
  PublicPlan,
  RegisterCompanyResult,
} from '../api/types';
import { LOGO_SRC } from '../brand';
import { CAIXA_URL, STORE_URL } from '../config';
import {
  IconBoxes, IconBuilding, IconCalendar, IconCart, IconCartIn, IconCashRegister, IconCheck,
  IconGauge, IconHeadset, IconMail, IconReceipt, IconShield, IconSparkles,
  IconStore, IconTruck, IconUsers, IconWallet,
} from '../components/Icons';
import { Typewriter } from '../components/Typewriter';
import { SupportChat } from '../components/SupportChat';
import { FeedbackSection } from '../components/FeedbackSection';

/** Imagens de fundo realistas — carrossel por SERVIÇO, em pares (2 imagens
 *  seguidas por vertical): vendas & retalho → restauração/hamburgueria →
 *  clínica → hotelaria → reparações/serviços → supermercado → pagamentos POS
 *  → armazém → boutique → mercado. Usadas quando o Super Admin não define
 *  as suas. Unsplash, alta qualidade, tom profissional. */
const DEFAULT_HERO_IMAGES = [
  // Vendas & retalho
  'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1920&q=80', // loja moderna
  'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=1920&q=80', // retalho/mercado
  // Restauração & hamburgueria
  'https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1920&q=80',   // restaurante interior
  'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1920&q=80', // hambúrguer artesanal
  // Clínica & saúde
  'https://images.unsplash.com/photo-1631217868264-e5b90bb7e133?auto=format&fit=crop&w=1920&q=80', // médico de bata (neutro, sem sinalética)
  'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=1920&q=80', // médico com tablet
  // Hotelaria
  'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1920&q=80', // hotel resort
  'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=1920&q=80',   // quarto de hotel
  // Reparações & serviços técnicos
  'https://images.unsplash.com/photo-1487754180451-c456f719a1fc?auto=format&fit=crop&w=1920&q=80', // mecânico/oficina
  'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?auto=format&fit=crop&w=1920&q=80', // técnico/engenharia
  // Supermercado
  'https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&w=1920&q=80', // prateleiras
  'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1920&q=80',   // mercado fresco
  // Pagamentos & POS
  'https://images.unsplash.com/photo-1556740758-90de374c12ad?auto=format&fit=crop&w=1920&q=80',   // pagamento cartão
  'https://images.unsplash.com/photo-1556742502-ec7c0e9f34b1?auto=format&fit=crop&w=1920&q=80',   // POS móvel
  // Armazém & logística
  'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&fit=crop&w=1920&q=80', // armazém
  'https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=1920&q=80',   // logística moderna
  // Boutique & moda
  'https://images.unsplash.com/photo-1521335629791-ce4aec67dd15?auto=format&fit=crop&w=1920&q=80', // loja de roupa
  'https://images.unsplash.com/photo-1583258292688-d0213dc5a3a8?auto=format&fit=crop&w=1920&q=80', // boutique
  // Atendimento & balcão
  'https://images.unsplash.com/photo-1567448400815-59d5a71b1a6c?auto=format&fit=crop&w=1920&q=80', // balcão atendimento
  'https://images.unsplash.com/photo-1560472354-b33ff0c44a43?auto=format&fit=crop&w=1920&q=80',   // profissional negócio
];
const DEFAULT_HERO = DEFAULT_HERO_IMAGES[0];

function kz(n: number): string {
  return n.toLocaleString('pt-PT', { maximumFractionDigits: 0 }) + ' Kz';
}
/** Duração do ciclo do plano: 1 → "mês", N → "N meses". */
function dur(months: number): string {
  return months <= 1 ? 'mês' : `${months} meses`;
}


interface Props {
  onGoLogin(): void; // abre o painel de login normal
  onGoRegister?(): void; // abre o registo simples (email/Google)
}

export function Landing({ onGoLogin, onGoRegister }: Props) {
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
  // Usa as imagens do Super Admin SÓ se forem várias (≥2) E não forem uma
  // cópia gravada dos padrões ANTIGOS (v1 tinha 10; se a config for só isso,
  // é lista obsoleta → usa o conjunto novo de 20 em pares por serviço).
  const OLD_DEFAULT_IDS = [
    'photo-1604719312566', 'photo-1556740758', 'photo-1441986300917', 'photo-1542838132',
    'photo-1578916171728', 'photo-1567448400815', 'photo-1607082348824', 'photo-1556742502',
    'photo-1521335629791', 'photo-1583258292688',
  ];
  const isStaleDefaults = (list: string[]) =>
    list.length > 0 && list.every((u) => OLD_DEFAULT_IDS.some((id) => u.includes(id)));
  const heroImages =
    cfg?.heroImages && cfg.heroImages.length >= 2 && !isStaleDefaults(cfg.heroImages)
      ? cfg.heroImages
      : DEFAULT_HERO_IMAGES;
  const heroInterval = cfg?.heroIntervalMs || 5000;
  const trialDays = cfg?.trialDays ?? 14;
  const plans = data?.plans ?? [];
  const ads = (cfg?.showAds && cfg?.ads?.filter((a) => a.active !== false)) || [];

  const openRegister = (tier: PlanTier) => {
    // Novo fluxo simples (email/Google) quando disponível; senão, modal antigo.
    if (onGoRegister) { onGoRegister(); return; }
    setPresetTier(tier);
    setShowRegister(true);
  };

  return (
    <div className="lp" style={{ ['--lp-primary' as string]: primary, ['--lp-accent' as string]: accent }}>
      {/* NAV */}
      <nav className="lp-nav">
        <img className="logo" src={LOGO_SRC} alt={cfg?.brandName ?? 'Ndombaxi'} />
        <span className="nm">{cfg?.brandName ?? 'Ndombaxi System'}</span>
        <div className="lp-nav-links" aria-label="Secções da página">
          <a href="#modulos">Módulos</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#planos">Planos</a>
          <a href="#faq">FAQ</a>
        </div>
        <span className="spacer" />
        <button className="ghost" onClick={onGoLogin}>Entrar</button>
        <button className="solid" onClick={() => openRegister('BUSINESS')}>Criar conta</button>
      </nav>

      {/* HERO com carrossel animado de imagens realistas */}
      <header className="lp-hero">
        <HeroCarousel images={heroImages} intervalMs={heroInterval} />
        <div className="lp-hero-inner lp-hero-grid">
          <div className="lp-hero-copy">
            <span className="badge-pill"><Typewriter text={`${trialDays} dias grátis · sem cartão · cancele quando quiser`} /></span>
            <h1>{cfg?.heroTitle ?? 'O ERP completo para gerir e vender em Angola'}</h1>
            <p className="sub">
              {cfg?.heroSubtitle ??
                'Venda, gira o stock e fature com certificação AGT — numa única plataforma, em Kwanzas.'}
            </p>
            <div className="lp-verticals">
              <span>Vendas & stock</span>
              <span>Restauração</span>
              <span>Serviços</span>
              <span>Hotelaria</span>
              <span>Clínicas</span>
              <span>Farmácias</span>
            </div>
            <div className="cta-row">
              <button className="lp-btn primary" onClick={() => openRegister('BUSINESS')}>
                {cfg?.heroCtaPrimary ?? `Começar grátis — ${trialDays} dias`}
              </button>
              <button className="lp-btn outline" onClick={onGoLogin}>
                {cfg?.heroCtaSecondary ?? 'Entrar'}
              </button>
            </div>
            {/* (Sem linha de selos aqui: o trial já está no badge acima e a AGT/
                disponibilidade nos INDICADORES logo abaixo — evitar repetição.) */}
          </div>
          {/* Mockup do produto (CSS puro — sem imagens, nítido em qualquer ecrã):
              o visitante VÊ o painel em <1s, como Stripe/Linear mostram o produto. */}
          <div className="lp-mockup" aria-hidden="true">
            <div className="mk-frame">
              <div className="mk-bar"><i /><i /><i /><span className="mk-url">painel · {cfg?.brandName ?? 'Ndombaxi'}</span></div>
              <div className="mk-body">
                <div className="mk-side">
                  <div className="mk-si on" /><div className="mk-si" /><div className="mk-si" /><div className="mk-si" /><div className="mk-si" />
                </div>
                <div className="mk-main">
                  <div className="mk-kpis">
                    <div className="mk-kpi"><small>Vendas hoje</small><b>184 300 Kz</b><em className="up">▲ 12%</em></div>
                    <div className="mk-kpi"><small>Lucro líquido</small><b>62 040 Kz</b><em className="up">▲ 8%</em></div>
                    <div className="mk-kpi"><small>Faturas AGT</small><b>37</b><em>hoje</em></div>
                  </div>
                  <div className="mk-chart">
                    <i style={{ ['--h' as never]: '38%' }} /><i style={{ ['--h' as never]: '52%' }} /><i style={{ ['--h' as never]: '44%' }} /><i style={{ ['--h' as never]: '66%' }} /><i style={{ ['--h' as never]: '58%' }} /><i style={{ ['--h' as never]: '82%' }} /><i style={{ ['--h' as never]: '74%' }} />
                  </div>
                  {/* Documentos REAIS do produto (facturação AGT) — em vez de linhas cinzentas. */}
                  <div className="mk-docs">
                    <div className="mk-doc"><span className="mk-doc-n">FT A/2026/0042</span><span className="mk-doc-ok">✓ assinada</span><b>12 400 Kz</b></div>
                    <div className="mk-doc"><span className="mk-doc-n">FT A/2026/0041</span><span className="mk-doc-ok">✓ assinada</span><b>7 850 Kz</b></div>
                    <div className="mk-doc"><span className="mk-doc-n">SAF-T · Julho</span><span className="mk-doc-ok">pronto</span><b>—</b></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Indicadores de confiança — âncoras numéricas sob o hero */}
        <div className="lp-stats" role="list">
          <div role="listitem"><b>15+</b><span>módulos integrados</span></div>
          <div role="listitem"><b>10+</b><span>setores de atividade</span></div>
          <div role="listitem"><b>99,9%</b><span>disponibilidade</span></div>
          <div role="listitem"><b>AGT</b><span>facturação certificada</span></div>
        </div>
      </header>

      {/* MÓDULOS — a prova de "ERP completo": sempre visível (não depende da config) */}
      <section className="lp-section" id="modulos">
        <div className="wrap">
          <h2>Um sistema, 15 módulos</h2>
          <p className="lead">Tudo integrado: o que se vende na caixa baixa no stock, entra no financeiro e sai na facturação AGT.</p>
          <div className="lp-modules">
            {[
              [<IconCashRegister size={20} key="i" />, 'POS / Caixa', 'Venda rápida, offline e com impressão térmica'],
              [<IconReceipt size={20} key="i" />, 'Facturação AGT', 'Documentos certificados, SAF-T pronto'],
              [<IconBoxes size={20} key="i" />, 'Inventário', 'Stock por loja, lotes, validades e alertas'],
              [<IconCartIn size={20} key="i" />, 'Compras', 'Fornecedores, encomendas e custo médio'],
              [<IconWallet size={20} key="i" />, 'Financeiro', 'Caixa, despesas, contas a pagar/receber'],
              [<IconUsers size={20} key="i" />, 'RH & Salários', 'Folha salarial com INSS e IRT'],
              [<IconBuilding size={20} key="i" />, 'Hotelaria', 'Reservas, quartos e conta do hóspede'],
              [<IconCalendar size={20} key="i" />, 'Clínicas', 'Pacientes, consultas e receitas'],
              [<IconShield size={20} key="i" />, 'Farmácias', 'Validades, lotes e princípio ativo'],
              [<IconStore size={20} key="i" />, 'Restaurantes', 'Mesas, comandas, cozinha e fichas técnicas'],
              [<IconTruck size={20} key="i" />, 'Serviços & Oficina', 'Ordens de serviço e assistência técnica'],
              [<IconCart size={20} key="i" />, 'Loja Online', 'Montra pública com encomendas e entregas'],
              [<IconHeadset size={20} key="i" />, 'CRM', 'Clientes, crédito e histórico de compras'],
              [<IconSparkles size={20} key="i" />, 'IA integrada', 'Assistente que responde com os seus dados'],
              [<IconGauge size={20} key="i" />, 'Relatórios', 'Lucro real, KPIs e fecho de caixa'],
            ].map(([ic, t, d], i) => (
              <div className="lp-mod" key={i}>
                <span className="mic">{ic}</span>
                <div><h3>{t}</h3><p>{d}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* (Secção "Funcionalidades" da config REMOVIDA: era um subconjunto da
          grelha de módulos acima — informação duplicada não vende duas vezes.) */}

      {/* COMO FUNCIONA — 3 passos até vender */}
      <section className="lp-section alt" id="como-funciona">
        <div className="wrap">
          <h2>A vender em 3 passos</h2>
          <p className="lead">Sem instalação, sem técnico, sem cartão de crédito. Só precisa de um telemóvel ou computador.</p>
          <div className="lp-steps">
            <div className="lp-step">
              <span className="num">1</span>
              <h3>Crie a conta</h3>
              <p>Registo em 2 minutos com e-mail ou Google — comece a testar no mesmo instante.</p>
            </div>
            <div className="lp-step">
              <span className="num">2</span>
              <h3>Configure o negócio</h3>
              <p>Escolha o setor, adicione produtos e a equipa. O painel adapta-se ao seu ramo.</p>
            </div>
            <div className="lp-step">
              <span className="num">3</span>
              <h3>Comece a vender</h3>
              <p>Caixa a funcionar (mesmo offline), facturas AGT e relatórios de lucro em tempo real.</p>
            </div>
          </div>
        </div>
      </section>

      {/* PORQUÊ O NDOMBAXI — diferenciais */}
      <section className="lp-section" id="porque">
        <div className="wrap">
          <h2>Feito para a realidade angolana</h2>
          <p className="lead">Não é um software estrangeiro adaptado — foi desenhado de raiz para como se trabalha em Angola.</p>
          <div className="lp-why">
            <div className="lp-whyi"><IconCheck size={18} /><div><h3>Tudo em Kwanzas</h3><p>Preços, facturas e relatórios na sua moeda, com IVA angolano.</p></div></div>
            <div className="lp-whyi"><IconCheck size={18} /><div><h3>Multi-loja</h3><p>Várias lojas com stock próprio, transferências e relatórios por loja.</p></div></div>
            <div className="lp-whyi"><IconCheck size={18} /><div><h3>Funciona offline</h3><p>A caixa continua a vender sem internet e sincroniza depois.</p></div></div>
            <div className="lp-whyi"><IconCheck size={18} /><div><h3>Multi-setor real</h3><p>Restaurante com fichas técnicas, hotel com folio, farmácia com validades.</p></div></div>
            <div className="lp-whyi"><IconCheck size={18} /><div><h3>Venda a crédito (fiado)</h3><p>Controle dívidas de clientes como se faz no comércio local.</p></div></div>
            <div className="lp-whyi"><IconCheck size={18} /><div><h3>Suporte em português</h3><p>Chat integrado e acompanhamento por quem conhece o mercado.</p></div></div>
          </div>
        </div>
      </section>

      {/* PLANOS / PREÇOS */}
      {cfg?.showPricing !== false && plans.length > 0 && (
        <section className="lp-section alt" id="planos">
          <div className="wrap">
            <h2>Planos simples, preços em Kwanzas</h2>
            <p className="lead">
              Comece com <strong>{trialDays} dias grátis</strong> em qualquer plano — sem cartão. Só paga se quiser continuar.
            </p>
            <div className="lp-plans">
              {plans.map((p) => (
                <div className={`lp-plan${p.highlight ? ' highlight' : ''}`} key={p.id}>
                  {p.highlight && <span className="pop">Mais popular</span>}
                  <div className="pname">{p.name}</div>
                  <div className="ptag">{p.tagline ?? ''}</div>
                  {p.tier === 'FREE' ? (
                    <div className="price">Grátis<small> · {trialDays} dias</small></div>
                  ) : p.priceKz > 0 ? (
                    <div className="price">{kz(p.priceKz)}<small> /{dur(p.durationMonths)}</small></div>
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
                    {p.tier === 'FREE' ? 'Começar grátis' : p.priceKz > 0 ? 'Começar agora' : 'Falar connosco'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ANÚNCIOS / PUBLICIDADES */}
      {ads.length > 0 && (
        <section className="lp-section" id="novidades">
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

      {/* FAQ — responde às objeções antes de pedirem o cartão */}
      <section className="lp-section alt" id="faq">
        <div className="wrap lp-faq-wrap">
          <h2>Perguntas frequentes</h2>
          <p className="lead">Tudo o que os gestores nos perguntam antes de começar.</p>
          <div className="lp-faq">
            <details>
              <summary>Preciso de cartão de crédito para testar?</summary>
              <p>Não. Cria a conta e usa {trialDays} dias grátis com todos os módulos do plano. Só paga se decidir continuar — por transferência bancária ou referência.</p>
            </details>
            <details>
              <summary>A facturação é aceite pela AGT?</summary>
              <p>Sim. Os documentos seguem o regime jurídico das facturas (numeração, hash e assinatura) e o sistema exporta o ficheiro SAF-T (AO) para entregar à AGT.</p>
            </details>
            <details>
              <summary>E se a internet falhar na loja?</summary>
              <p>A caixa continua a vender offline e sincroniza automaticamente quando a ligação voltar. Não perde vendas por causa da rede.</p>
            </details>
            <details>
              <summary>Serve para o meu ramo?</summary>
              <p>O painel adapta-se ao setor: restaurantes têm mesas e fichas técnicas, hotéis têm reservas e conta do hóspede, farmácias têm lotes e validades, oficinas têm ordens de serviço — tudo no mesmo sistema.</p>
            </details>
            <details>
              <summary>Os meus dados estão seguros?</summary>
              <p>Cada empresa tem os seus dados isolados, com cópias de segurança automáticas e acesso protegido por perfis e PIN. Pode exportar os seus dados quando quiser.</p>
            </details>
            <details>
              <summary>Quantas lojas e funcionários posso ter?</summary>
              <p>Depende do plano — desde 1 loja até lojas e utilizadores ilimitados. Pode mudar de plano em qualquer altura sem perder dados.</p>
            </details>
          </div>
        </div>
      </section>

      {/* COMENTÁRIOS DA COMUNIDADE */}
      <div id="comentarios"><FeedbackSection /></div>

      {/* CHAT DE SUPORTE (balão flutuante) */}
      <SupportChat />

      {/* RODAPÉ enterprise em 2 camadas: faixa CTA + colunas (estilo INUKA,
          adaptado à marca). Só links REAIS: âncoras das secções, caixa/loja
          e contactos configurados no Super Admin. */}
      <footer className="lp-footer2">
        <div className="lp-cta-band">
          <div className="wrap band-inner">
            <h2>Comece a sua jornada {cfg?.brandName ?? 'Ndombaxi'} hoje!</h2>
            <button onClick={() => openRegister('BUSINESS')}>Criar conta grátis</button>
          </div>
        </div>
        <div className="lp-foot-main">
          <div className="wrap lp-foot-cols">
            <div className="lp-fcol lp-fbrand">
              <div className="fb-logo-row">
                <img src={LOGO_SRC} alt={cfg?.brandName ?? 'Ndombaxi'} />
                <div>
                  <div className="fnm">{cfg?.brandName ?? 'Ndombaxi System'}</div>
                  <div className="ftag">Sempre com o seu negócio</div>
                </div>
              </div>
              {cfg?.contactPhone ? (
                <a className="fc-line" href={`tel:${cfg.contactPhone}`}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.4 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.5 2.8.6a2 2 0 0 1 1.8 2Z" /></svg>
                  {cfg.contactPhone}
                </a>
              ) : null}
              {cfg?.contactEmail ? (
                <a className="fc-line" href={`mailto:${cfg.contactEmail}`}>
                  <IconMail size={16} /> {cfg.contactEmail}
                </a>
              ) : null}
              {cfg?.footerText ? <div className="fc-line fc-note">{cfg.footerText}</div> : null}
              <div className="lp-fsocial">
                {cfg?.contactPhone ? (
                  <a href={`https://wa.me/${cfg.contactPhone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" aria-label="WhatsApp" title="WhatsApp">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden><path d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.004c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.02zM12.05 20.15h-.004a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.69 8.24-8.23 8.24zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.39.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43-.14-.01-.31-.01-.48-.01-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z"/></svg>
                  </a>
                ) : null}
                {cfg?.contactEmail ? (
                  <a href={`mailto:${cfg.contactEmail}`} aria-label="E-mail" title="E-mail"><IconMail size={16} /></a>
                ) : null}
              </div>
            </div>
            <div className="lp-fcol">
              <h5>Comece</h5>
              <button onClick={() => openRegister('BUSINESS')}>Criar conta</button>
              <button onClick={onGoLogin}>Entrar no painel</button>
              <a href={CAIXA_URL} target="_blank" rel="noreferrer">Abrir a caixa (POS)</a>
              <a href={STORE_URL} target="_blank" rel="noreferrer">Loja online</a>
            </div>
            <div className="lp-fcol">
              <h5>Produto</h5>
              <a href="#modulos">Módulos</a>
              <a href="#planos">Planos e preços</a>
              <a href="#novidades">Novidades</a>
              <a href="#comentarios">Comentários</a>
            </div>
            <div className="lp-fcol">
              <h5>Precisa de ajuda?</h5>
              {cfg?.contactEmail ? <a href={`mailto:${cfg.contactEmail}`}>Fale connosco</a> : null}
              {cfg?.contactPhone ? <a href={`tel:${cfg.contactPhone}`}>Ligar agora</a> : null}
              <a href="#comentarios">Deixar comentário</a>
            </div>
          </div>
          <div className="wrap lp-foot-bottom">
            <span>© {new Date().getFullYear()} {cfg?.brandName ?? 'Ndombaxi System'}. Todos os direitos reservados.</span>
            <span className="lp-foot-credits">Direitos reservados a <strong>Manuel Mbala Ndombaxi</strong> · Patrocinado pela <strong>Loja das Mulheres</strong></span>
          </div>
        </div>
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

/** Carrossel de fundo do hero — crossfade automático entre imagens.
 *  PERFORMANCE: só monta o slide ATUAL + o SEGUINTE (pré-carrega) — antes
 *  montava as 20 imagens 1920px de uma vez (~10 MB no primeiro load, LCP
 *  péssimo em redes móveis angolanas). O resto carrega à medida que roda. */
function HeroCarousel({ images, intervalMs }: { images: string[]; intervalMs: number }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (images.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % images.length), Math.max(2000, intervalMs));
    return () => clearInterval(t);
  }, [images.length, intervalMs]);
  const next = (idx + 1) % images.length;
  return (
    <div className="lp-hero-bg" aria-hidden="true">
      {images.map((src, i) => (
        i === idx || i === next ? (
          <div
            key={i}
            className={`lp-hero-slide${i === idx ? ' on' : ''}`}
            style={{ backgroundImage: `url('${src}')` }}
          />
        ) : null
      ))}
      {images.length > 1 && (
        <div className="lp-hero-dots" role="tablist" aria-label="Imagens do carrossel">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === idx}
              aria-label={`Imagem ${i + 1} de ${images.length}`}
              className={i === idx ? 'on' : ''}
              onClick={() => setIdx(i)}
            />
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
            <h3>Comprovativo enviado ✅</h3>
            <p className="msub">A tua subscrição está <b>em análise</b>. Assim que a plataforma aprovar, a tua conta fica <b>activa</b>. Entra depois com:</p>
            <Creds result={result} />
            <button className="lp-btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} onClick={onLogin}>Ir para o login</button>
          </>
        ) : !sub ? (
          <>
            <h3>Conta criada! 🎉 Falta concluir a subscrição</h3>
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
              {busy ? 'A enviar…' : '📷 Enviar comprovativo (foto)'}
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
