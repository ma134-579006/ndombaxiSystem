import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { AuthLook, AuthSocialBtn, AuthTestimonial } from '../api/types';
import { FacebookCircle, FacebookSquare, GoogleGlyph } from '../pages/vendusAuth';

/** Valores do Vendus (o que se vê quando nada foi alterado). */
const DEF = {
  primary: '#1b45f4', pageBg: '#f3f7fe', linkColor: '#007bff', sideFrom: '#0046fe', sideTo: '#002a98',
  google: { enabled: true, label: 'Entrar com Google', bg: '#ffffff', color: '#212529', border: '#ffffff' },
  facebook: { enabled: true, label: 'Entrar com Facebook', bg: '#4267b2', color: '#ffffff', border: '#4267b2' },
};

function Color({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
        <input type="color" aria-label={label} value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)}
          style={{ width: 44, height: 40, flex: 'none', padding: 2, borderRadius: 8, cursor: 'pointer' }} />
        <input value={value} maxLength={7} onChange={(e) => onChange(e.target.value)} style={{ flex: 1, minWidth: 0, width: 'auto', fontFamily: 'ui-monospace, monospace' }} />
      </div>
    </div>
  );
}

function SocialEditor({ title, v, def, onChange }: { title: string; v: AuthSocialBtn; def: Required<AuthSocialBtn>; onChange(v: AuthSocialBtn): void }) {
  const set = (p: Partial<AuthSocialBtn>) => onChange({ ...v, ...p });
  return (
    <div className="fx-card" style={{ padding: 14 }}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 650, marginBottom: 10 }}>
        <input type="checkbox" checked={v.enabled !== false} onChange={(e) => set({ enabled: e.target.checked })} /> {title}
      </label>
      <div className="field"><label>Texto</label><input value={v.label ?? def.label} maxLength={40} onChange={(e) => set({ label: e.target.value })} /></div>
      <div className="fx-grid">
        <Color label="Fundo" value={v.bg ?? def.bg} onChange={(c) => set({ bg: c })} />
        <Color label="Texto" value={v.color ?? def.color} onChange={(c) => set({ color: c })} />
        <Color label="Borda" value={v.border ?? def.border} onChange={(c) => set({ border: c })} />
      </div>
    </div>
  );
}

/** Super Admin → Login & Registo (aparência estilo Vendus). */
export function AuthScreensAdmin({ onOpenIntegrations }: { onOpenIntegrations?: () => void }) {
  const [look, setLook] = useState<AuthLook | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fbReady, setFbReady] = useState<boolean | null>(null);

  useEffect(() => {
    api.landingAdmin.get().then((c) => setLook(c.authConfig ?? {})).catch((e) => setErr(e instanceof ApiError ? e.message : 'Falha ao carregar.'));
    api.publicLanding().then((l) => setFbReady(!!l.facebookAppId)).catch(() => setFbReady(null));
  }, []);

  if (!look) return <div className="fx-wide">{err ? <div className="banner danger">{err}</div> : <div className="muted">A carregar…</div>}</div>;
  const set = (p: Partial<AuthLook>) => setLook({ ...look, ...p });
  const tst = look.testimonials ?? [];
  const setT = (i: number, p: Partial<AuthTestimonial>) => set({ testimonials: tst.map((t, j) => (j === i ? { ...t, ...p } : t)) });
  const g = { ...DEF.google, ...look.google }; const f = { ...DEF.facebook, ...look.facebook };

  const pickPhoto = (i: number, file: File | undefined) => {
    if (!file) return;
    if (file.size > 280_000) { setErr('A foto tem de ter menos de 280 KB.'); return; }
    const r = new FileReader();
    r.onload = () => setT(i, { photoUrl: String(r.result) });
    r.readAsDataURL(file);
  };

  const save = async () => {
    setSaving(true); setErr(null); setSaved(false);
    try {
      const c = await api.landingAdmin.update({ authConfig: look });
      setLook(c.authConfig ?? {});
      setSaved(true); window.setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Falha ao guardar.');
    } finally { setSaving(false); }
  };

  return (
    <div className="fx-wide">
      <div className="content-head"><h2>Login & Registo</h2></div>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}

      <div className="fx-card">
        <div className="fx-card-h"><div><h3>Cores</h3></div></div>
        <div className="fx-grid">
          <Color label="Botão principal" value={look.primary ?? DEF.primary} onChange={(v) => set({ primary: v })} />
          <Color label="Fundo do login" value={look.pageBg ?? DEF.pageBg} onChange={(v) => set({ pageBg: v })} />
          <Color label="Ligações" value={look.linkColor ?? DEF.linkColor} onChange={(v) => set({ linkColor: v })} />
          <Color label="Coluna do registo (topo)" value={look.sideFrom ?? DEF.sideFrom} onChange={(v) => set({ sideFrom: v })} />
          <Color label="Coluna do registo (fundo)" value={look.sideTo ?? DEF.sideTo} onChange={(v) => set({ sideTo: v })} />
        </div>
      </div>

      <div className="fx-card">
        <div className="fx-card-h"><div><h3>Botões Google e Facebook</h3></div>
          {fbReady === false ? <button className="btn sm ghost" onClick={onOpenIntegrations}>Facebook: configurar App ID</button> : null}
        </div>
        <div className="fx-grid">
          <SocialEditor title="Google" v={look.google ?? {}} def={DEF.google} onChange={(v) => set({ google: v })} />
          <SocialEditor title="Facebook" v={look.facebook ?? {}} def={DEF.facebook} onChange={(v) => set({ facebook: v })} />
        </div>
        <div className="va-adm-prev">
          <div style={{ maxWidth: 420 }}>
            {g.enabled !== false ? <button type="button" className="va-social g" style={{ background: g.bg, color: g.color, boxShadow: `inset 0 0 0 1px ${g.border}` }}><GoogleGlyph />{g.label || DEF.google.label}</button> : null}
            {f.enabled !== false ? <button type="button" className="va-social f" style={{ background: f.bg, color: f.color, boxShadow: `inset 0 0 0 1px ${f.border}` }}><FacebookSquare />{f.label || DEF.facebook.label}</button> : null}
          </div>
          <div className="va-srow" style={{ maxWidth: 420, marginTop: 14 }}>
            {g.enabled !== false ? <button type="button" className="va-sbtn"><GoogleGlyph />{g.label || DEF.google.label}</button> : null}
            {f.enabled !== false ? <button type="button" className="va-sbtn"><FacebookCircle />{f.label || DEF.facebook.label}</button> : null}
          </div>
        </div>
      </div>

      <div className="fx-card">
        <div className="fx-card-h"><div><h3>Registo</h3></div></div>
        <div className="fx-grid">
          <div className="field"><label>Título ({'{dias}'} = dias de teste)</label><input value={look.registerTitle ?? 'Experimente {dias} Dias Grátis'} maxLength={80} onChange={(e) => set({ registerTitle: e.target.value })} /></div>
          <div className="field"><label>Subtítulo</label><input value={look.registerSubtitle ?? 'Sem compromisso, cancele quando quiser!'} maxLength={120} onChange={(e) => set({ registerSubtitle: e.target.value })} /></div>
          <div className="field"><label>Caixa de novidades</label><input value={look.optInLabel ?? 'Aceito receber Novidades e Campanhas sobre o LPS Vendas'} maxLength={140} onChange={(e) => set({ optInLabel: e.target.value })} /></div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={look.showNif !== false} onChange={(e) => set({ showNif: e.target.checked })} /> Campo NIF</label>
        </div>
      </div>

      <div className="fx-card">
        <div className="fx-card-h"><div><h3>Testemunhos ({tst.length}/8)</h3></div>
          <button className="btn sm" disabled={tst.length >= 8} onClick={() => set({ testimonials: [...tst, { text: '', name: '', company: '' }] })}>Adicionar</button>
        </div>
        {tst.map((t, i) => (
          <div key={i} className="fx-card" style={{ padding: 14, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 14, alignItems: 'start' }}>
            <label style={{ cursor: 'pointer', display: 'grid', justifyItems: 'center', gap: 6 }}>
              <span style={{ width: 64, height: 64, borderRadius: '50%', overflow: 'hidden', background: 'var(--surface-2, #eef2f8)', display: 'grid', placeItems: 'center', fontWeight: 700 }}>
                {t.photoUrl ? <img src={t.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (t.name || '?').charAt(0).toUpperCase()}
              </span>
              <small className="muted">Foto</small>
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pickPhoto(i, e.target.files?.[0])} />
            </label>
            <div style={{ minWidth: 0 }}>
              <div className="field"><label>Testemunho</label><textarea rows={2} maxLength={300} value={t.text} onChange={(e) => setT(i, { text: e.target.value })} /></div>
              <div className="fx-grid">
                <div className="field"><label>Nome</label><input maxLength={60} value={t.name} onChange={(e) => setT(i, { name: e.target.value })} /></div>
                <div className="field"><label>Empresa</label><input maxLength={60} value={t.company ?? ''} onChange={(e) => setT(i, { company: e.target.value })} /></div>
              </div>
              <button className="btn sm ghost danger" onClick={() => set({ testimonials: tst.filter((_, j) => j !== i) })}>Remover</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn lg" onClick={() => void save()} disabled={saving}>{saving ? 'A guardar…' : 'Guardar'}</button>
        <button className="btn lg ghost" onClick={() => setLook({})} disabled={saving}>Repor estilo Vendus</button>
        {saved ? <span className="badge success">Guardado</span> : null}
      </div>
    </div>
  );
}
