import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { SiteSettings, UpdateSiteSettingsInput } from '../api/types';
import { IconImage, IconStore } from '../components/Icons';
import { Switch } from '../components/ui';

export function Storefront() {
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Campos editáveis
  const [brandName, setBrandName] = useState('');
  const [tagline, setTagline] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#2563eb');
  const [secondaryColor, setSecondaryColor] = useState('#0ea5e9');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [address, setAddress] = useState('');
  const [isPublished, setIsPublished] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const hydrate = (s: SiteSettings) => {
    setSettings(s);
    setBrandName(s.brand_name ?? '');
    setTagline(s.tagline ?? '');
    setLogoUrl(s.logo_url ?? '');
    setPrimaryColor(s.primary_color || '#2563eb');
    setSecondaryColor(s.secondary_color || '#0ea5e9');
    setContactEmail(s.contact_email ?? '');
    setContactPhone(s.contact_phone ?? '');
    setAddress(s.address ?? '');
    setIsPublished(s.is_published);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        hydrate(await api.site.get());
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Falha ao carregar as definições da loja.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onPickLogo = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1_500_000) {
      setError('Logótipo demasiado grande (máx. ~1,5 MB).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoUrl(String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const dto: UpdateSiteSettingsInput = {
        brandName: brandName.trim() || undefined,
        tagline,
        logoUrl: logoUrl || undefined,
        primaryColor,
        secondaryColor,
        contactEmail,
        contactPhone,
        address,
        isPublished,
      };
      hydrate(await api.site.update(dto));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível guardar.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="card"><div className="loading">A carregar definições da loja…</div></div>;
  }

  return (
    <>
      <div className="content-head">
        <h2>Loja & Marca</h2>
        <span className="spacer" />
        {settings ? (
          <span className={`pill ${isPublished ? 'on' : 'off'}`}>
            {isPublished ? 'Loja publicada' : 'Loja oculta'}
          </span>
        ) : null}
      </div>

      {error ? <div className="banner danger">{error}</div> : null}
      {saved ? <div className="banner success">Definições guardadas.</div> : null}

      <div className="card">
        <h3>Identidade</h3>
        <div className="row" style={{ gap: 14, marginBottom: 14 }}>
          <div className="thumb" style={{ width: 84, height: 84, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface-2)', display: 'grid', placeItems: 'center', overflow: 'hidden', flex: 'none' }}>
            {logoUrl ? <img src={logoUrl} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <IconStore size={30} />}
          </div>
          <div style={{ flex: 1 }}>
            <button className="btn sm ghost" onClick={() => fileRef.current?.click()}>
              <IconImage size={15} /> {logoUrl ? 'Trocar logótipo' : 'Carregar logótipo'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onPickLogo(e.target.files?.[0])} />
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>PNG/JPG, recomenda-se fundo transparente.</p>
          </div>
        </div>

        <div className="field">
          <label>Nome da marca</label>
          <input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="ex.: NovaShop" />
        </div>
        <div className="field">
          <label>Slogan</label>
          <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="ex.: As melhores ofertas de Luanda" />
        </div>
      </div>

      <div className="card">
        <h3>Cores</h3>
        <div className="grid-2">
          <div className="field">
            <label>Cor principal</label>
            <div className="row" style={{ gap: 10 }}>
              <input className="swatch" type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
              <input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} style={{ flex: 1 }} />
            </div>
          </div>
          <div className="field">
            <label>Cor secundária</label>
            <div className="row" style={{ gap: 10 }}>
              <input className="swatch" type="color" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} />
              <input value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} style={{ flex: 1 }} />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Contactos</h3>
        <div className="grid-2">
          <div className="field">
            <label>E-mail</label>
            <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="loja@empresa.ao" />
          </div>
          <div className="field">
            <label>Telefone</label>
            <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+244 ..." />
          </div>
        </div>
        <div className="field">
          <label>Morada</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, bairro, município" />
        </div>
      </div>

      <div className="card">
        <div className="switch-row">
          <div>
            <strong style={{ fontSize: 14 }}>Publicar loja online</strong>
            <p className="muted" style={{ fontSize: 12, margin: '2px 0 0' }}>
              Quando activa, a montra fica visível para os clientes.
            </p>
          </div>
          <Switch checked={isPublished} onChange={setIsPublished} />
        </div>
      </div>

      <button className="btn lg" onClick={save} disabled={saving}>
        {saving ? 'A guardar…' : 'Guardar definições'}
      </button>
    </>
  );
}
