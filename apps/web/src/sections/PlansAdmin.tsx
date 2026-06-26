import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { LandingConfig, PublicPlan } from '../api/types';
import { Modal } from '../components/ui';
import { IconEdit } from '../components/Icons';

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

  return (
    <>
      <div className="content-head">
        <h2>Planos & Página inicial</h2>
      </div>
      {error ? <div className="banner danger">{error}</div> : null}

      {/* PLANOS */}
      <div className="card">
        <h3>Planos (preços em Kwanzas)</h3>
        {loading ? (
          <div className="loading">A carregar…</div>
        ) : (
          plans.map((p) => (
            <div className="list-row" key={p.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>
                  {p.name} {p.highlight ? <span className="badge" style={{ color: 'var(--primary)', borderColor: 'var(--primary)' }}>Popular</span> : null}
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                  {p.priceKz > 0 ? `${kz(p.priceKz)} / ${durationLabel(p.durationMonths, p.durationDays)}` : 'Sob consulta'} ·{' '}
                  {p.maxStores === -1 ? '∞' : p.maxStores} lojas · {p.maxUsers === -1 ? '∞' : p.maxUsers} users ·{' '}
                  {p.isPublic ? 'visível' : 'oculto'}
                </div>
              </div>
              <button className="btn sm ghost" onClick={() => setEditing(p)}>
                <IconEdit size={15} /> Editar
              </button>
            </div>
          ))
        )}
      </div>

      {/* CONTEÚDO DA LANDING */}
      {cfg ? <LandingEditor cfg={cfg} onSaved={setCfg} /> : null}

      {editing ? (
        <PlanEditor plan={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
      ) : null}
    </>
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
      <div className="grid-2">
        <div className="field">
          <label>Preço (Kz) — 0 = sob consulta</label>
          <input value={priceKz} onChange={(e) => setPriceKz(e.target.value)} inputMode="numeric" />
        </div>
        <div className="field">
          <label>Duração — meses</label>
          <input value={durationMonths} onChange={(e) => setDurationMonths(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="0" />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Duração — dias (somam-se aos meses)</label>
          <input value={durationDays} onChange={(e) => setDurationDays(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="0" />
        </div>
        <div className="field" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <span className="muted" style={{ fontSize: 12.5 }}>Acesso por período: <strong>{durationLabel(Number(durationMonths) || 0, Number(durationDays) || 0)}</strong></span>
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Nº lojas (-1 = ∞)</label>
          <input value={maxStores} onChange={(e) => setMaxStores(e.target.value)} inputMode="numeric" />
        </div>
        <div className="field">
          <label>Nº utilizadores (-1 = ∞)</label>
          <input value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} inputMode="numeric" />
        </div>
      </div>
      <div className="field">
        <label>Nº produtos (-1 = ∞)</label>
        <input value={maxProducts} onChange={(e) => setMaxProducts(e.target.value)} inputMode="numeric" />
      </div>
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

  return (
    <div className="card">
      <h3>Página inicial (hero & marca)</h3>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      {saved ? <div className="banner success" style={{ marginBottom: 12 }}>Guardado.</div> : null}
      <div className="field">
        <label>Nome da marca</label>
        <input value={brandName} onChange={(e) => setBrandName(e.target.value)} />
      </div>
      <div className="field">
        <label>Título principal (hero)</label>
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
      <div className="field">
        <label>Período de teste grátis (dias) — para cada nova empresa</label>
        <input type="number" min={1} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
          Ao fim destes dias, a empresa é bloqueada até renovar o plano.
        </p>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Cor principal</label>
          <input type="color" className="swatch" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
        </div>
        <div className="field">
          <label>E-mail de contacto</label>
          <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Telefone de contacto</label>
        <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
      </div>
      <button className="btn lg" onClick={save} disabled={saving}>{saving ? 'A guardar…' : 'Guardar página inicial'}</button>
    </div>
  );
}
