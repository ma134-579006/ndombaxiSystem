import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { LandingConfig, PublicPlan } from '../api/types';
import { Modal } from '../components/ui';
import { IconCheck, IconEdit } from '../components/Icons';

function kz(n: number): string {
  return n.toLocaleString('pt-PT') + ' Kz';
}

/** Rótulo de duração legível a partir de meses + dias. */
function durationLabel(months: number, days: number): string {
  const parts: string[] = [];
  if (months) parts.push(`${months} ${months === 1 ? 'mês' : 'meses'}`);
  if (days) parts.push(`${days} ${days === 1 ? 'dia' : 'dias'}`);
  return parts.join(' e ') || '1 mês';
}

const lim = (n: number) => (n === -1 ? '∞' : String(n));

/** Super Admin edita planos (preço Kz, duração, limites, módulos) + conteúdo da landing. */
export function PlansAdmin() {
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [cfg, setCfg] = useState<LandingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PublicPlan | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([api.landingAdmin.listPlans(), api.landingAdmin.get()]);
      setPlans(p);
      setCfg(c);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = plans.filter((p) => p.isPublic).length;

  return (
    <div className="fx-wide">
      <div className="content-head">
        <h2>Planos & Página inicial</h2>
      </div>
      {error ? <div className="banner danger">{error}</div> : null}

      <div className="fx-stats">
        <div className="fx-stat"><span className="ic"><IconCheck size={20} /></span><div><div className="lb">Planos</div><div className="vl">{plans.length}</div><div className="sb">{visible} visível(is) na página inicial</div></div></div>
        <div className="fx-stat"><span className="ic"><IconCheck size={20} /></span><div><div className="lb">Teste grátis</div><div className="vl">{cfg?.trialDays ?? '—'}<small>&nbsp;dias</small></div><div className="sb">para cada nova empresa</div></div></div>
        <div className="fx-stat"><span className="ic"><IconCheck size={20} /></span><div><div className="lb">Marca</div><div className="vl" style={{ fontSize: 18 }}>{cfg?.brandName ?? '—'}</div><div className="sb">nome mostrado no site</div></div></div>
      </div>

      {/* PLANOS */}
      <div className="fx-card">
        <div className="fx-card-h">
          <div>
            <h3>Planos</h3>
            <p>Preços em Kwanzas, duração e limites. Toque num plano para o editar; as alterações aplicam-se a novas subscrições.</p>
          </div>
        </div>
        {loading ? (
          <div className="loading">A carregar…</div>
        ) : (
          <div className="fx-plans">
            {plans.map((p) => (
              <button key={p.id} type="button" className="fx-plan pl-plan" onClick={() => setEditing(p)} aria-label={`Editar plano ${p.name}`}>
                <span className="fx-plan-top">
                  <b>{p.name}</b>
                  <span className="pl-badges">
                    {p.highlight ? <span className="fx-badge" style={{ padding: '2px 9px', fontSize: 11 }}>Popular</span> : null}
                    {!p.isPublic ? <span className="fx-badge off" style={{ padding: '2px 9px', fontSize: 11 }}>Oculto</span> : null}
                  </span>
                </span>
                <span className="fx-plan-price">{p.priceKz > 0 ? kz(p.priceKz) : 'Sob consulta'}</span>
                <span className="fx-plan-per">{p.priceKz > 0 ? `por ${durationLabel(p.durationMonths, p.durationDays)}` : 'preço a combinar'}</span>
                <span className="fx-plan-lim">{lim(p.maxStores)} loja(s) · {lim(p.maxUsers)} utilizadores · {lim(p.maxProducts)} produtos</span>
                <span className="pl-edit"><IconEdit size={14} /> Editar</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* CONTEÚDO DA LANDING */}
      {cfg ? <LandingEditor cfg={cfg} onSaved={setCfg} /> : null}

      {editing ? (
        <PlanEditor plan={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
      ) : null}
    </div>
  );
}

// ── Editor de um plano ──────────────────────────────────────
function PlanEditor({ plan, onClose, onSaved }: { plan: PublicPlan; onClose(): void; onSaved(): void }) {
  const [priceKz, setPriceKz] = useState(String(plan.priceKz));
  const [durationMonths, setDurationMonths] = useState(String(plan.durationMonths));
  const [durationDays, setDurationDays] = useState(String(plan.durationDays ?? 0));
  const [maxStores, setMaxStores] = useState(String(plan.maxStores));
  const [maxUsers, setMaxUsers] = useState(String(plan.maxUsers));
  const [maxProducts, setMaxProducts] = useState(String(plan.maxProducts));
  const [tagline, setTagline] = useState(plan.tagline ?? '');
  const [highlight, setHighlight] = useState(plan.highlight);
  const [isPublic, setIsPublic] = useState(plan.isPublic);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await api.landingAdmin.updatePlan(plan.id, {
        priceKz: Number(priceKz) || 0,
        durationMonths: Math.max(0, Number(durationMonths) || 0),
        durationDays: Math.max(0, Number(durationDays) || 0),
        maxStores: Number(maxStores),
        maxUsers: Number(maxUsers),
        maxProducts: Number(maxProducts),
        tagline,
        highlight,
        isPublic,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Falha ao guardar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Editar plano — ${plan.name}`} onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}

      <h4 className="pl-sec">Preço e duração</h4>
      <div className="fx-grid">
        <div className="field">
          <label>Preço (Kz) — 0 = sob consulta</label>
          <input value={priceKz} onChange={(e) => setPriceKz(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" />
        </div>
        <div className="field">
          <label>Duração — meses</label>
          <input value={durationMonths} onChange={(e) => setDurationMonths(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="0" />
        </div>
        <div className="field">
          <label>Duração — dias (somam-se aos meses)</label>
          <input value={durationDays} onChange={(e) => setDurationDays(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="0" />
        </div>
      </div>
      <div className="fx-note">Acesso por período: <strong>{durationLabel(Number(durationMonths) || 0, Number(durationDays) || 0)}</strong></div>

      <h4 className="pl-sec">Limites <small>(-1 = ilimitado)</small></h4>
      <div className="fx-grid">
        <div className="field">
          <label>Nº de lojas</label>
          <input value={maxStores} onChange={(e) => setMaxStores(e.target.value)} inputMode="numeric" />
        </div>
        <div className="field">
          <label>Nº de utilizadores</label>
          <input value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} inputMode="numeric" />
        </div>
        <div className="field">
          <label>Nº de produtos</label>
          <input value={maxProducts} onChange={(e) => setMaxProducts(e.target.value)} inputMode="numeric" />
        </div>
      </div>

      <h4 className="pl-sec">Apresentação</h4>
      <div className="field">
        <label>Frase de apresentação</label>
        <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="ex.: O mais escolhido" />
      </div>
      <div className="switch-row">
        <span>Destacar como "mais popular"</span>
        <label className="switch"><input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} /><span className="tk" /><span className="th" /></label>
      </div>
      <div className="switch-row">
        <span>Visível na página inicial</span>
        <label className="switch"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /><span className="tk" /><span className="th" /></label>
      </div>
      <button className="btn lg block" style={{ marginTop: 14 }} onClick={save} disabled={saving}>
        {saving ? 'A guardar…' : 'Guardar plano'}
      </button>
    </Modal>
  );
}

// ── Editor do conteúdo da landing ───────────────────────────
function LandingEditor({ cfg, onSaved }: { cfg: LandingConfig; onSaved(c: LandingConfig): void }) {
  const [heroTitle, setHeroTitle] = useState(cfg.heroTitle);
  const [heroSubtitle, setHeroSubtitle] = useState(cfg.heroSubtitle);
  const [brandName, setBrandName] = useState(cfg.brandName);
  const [footerText, setFooterText] = useState(cfg.footerText ?? '');
  const [heroImages, setHeroImages] = useState((cfg.heroImages ?? []).join('\n'));
  const [primaryColor, setPrimaryColor] = useState(cfg.primaryColor);
  const [contactEmail, setContactEmail] = useState(cfg.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(cfg.contactPhone ?? '');
  const [trialDays, setTrialDays] = useState(String(cfg.trialDays ?? 14));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setSaving(true); setErr(null); setSaved(false);
    try {
      const c = await api.landingAdmin.update({
        brandName,
        footerText,
        heroTitle,
        heroSubtitle,
        primaryColor,
        contactEmail,
        contactPhone,
        trialDays: Math.max(1, Number(trialDays) || 14),
        heroImages: heroImages.split('\n').map((s) => s.trim()).filter(Boolean),
      });
      onSaved(c);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Falha ao guardar.');
    } finally {
      setSaving(false);
    }
  };

  const firstImage = heroImages.split('\n').map((s) => s.trim()).find(Boolean);

  return (
    <div className="fx-card">
      <div className="fx-card-h">
        <div>
          <h3>Página inicial</h3>
          <p>Marca, textos do topo e contactos do site público. A pré-visualização à direita atualiza enquanto escreve.</p>
        </div>
      </div>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}

      <div className="pl-layout">
        <div className="pl-form">
          <h4 className="pl-sec">Marca</h4>
          <div className="fx-grid">
            <div className="field">
              <label>Nome da marca</label>
              <input value={brandName} onChange={(e) => setBrandName(e.target.value)} />
            </div>
            <div className="field">
              <label>Cor principal</label>
              <input type="color" className="swatch" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Texto do rodapé</label>
            <input value={footerText} maxLength={300} onChange={(e) => setFooterText(e.target.value)} />
          </div>

          <h4 className="pl-sec">Topo do site</h4>
          <div className="field">
            <label>Título principal</label>
            <input value={heroTitle} onChange={(e) => setHeroTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>Subtítulo</label>
            <textarea value={heroSubtitle} onChange={(e) => setHeroSubtitle(e.target.value)} />
          </div>
          <div className="field">
            <label>Imagens de fundo (carrossel) — uma URL por linha</label>
            <textarea value={heroImages} onChange={(e) => setHeroImages(e.target.value)} style={{ minHeight: 90 }} placeholder="https://..." />
          </div>

          <h4 className="pl-sec">Contactos e teste grátis</h4>
          <div className="fx-grid">
            <div className="field">
              <label>E-mail de contacto</label>
              <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </div>
            <div className="field">
              <label>Telefone de contacto</label>
              <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
            <div className="field">
              <label>Teste grátis (dias)</label>
              <input type="number" min={1} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
            </div>
          </div>
          <div className="fx-note">Ao fim dos dias de teste, a empresa é bloqueada até renovar o plano.</div>
        </div>

        <aside className="pl-prev" aria-label="Pré-visualização">
          <div className="pl-prev-lb">Pré-visualização</div>
          <div
            className="pl-hero"
            style={{ ['--pl-c' as string]: primaryColor, backgroundImage: firstImage ? `linear-gradient(180deg, rgba(8,13,26,.55), rgba(8,13,26,.86)), url(${firstImage})` : undefined }}
          >
            <div className="pl-hero-nav"><img src="/logo-horizontal.png" alt={brandName} /></div>
            <h5>{heroTitle || 'Título principal'}</h5>
            <p>{heroSubtitle || 'Subtítulo do site'}</p>
            <span className="pl-cta">Criar conta grátis</span>
          </div>
          <div className="pl-prev-foot">{footerText || '© ' + brandName}</div>
        </aside>
      </div>

      <div className="fx-save">
        <span className="muted" style={{ fontSize: 13 }}>
          {saved ? <><IconCheck size={15} /> Guardado.</> : 'As alterações só ficam visíveis no site depois de guardar.'}
        </span>
        <button className="btn lg" onClick={save} disabled={saving}>{saving ? 'A guardar…' : 'Guardar página inicial'}</button>
      </div>
    </div>
  );
}
