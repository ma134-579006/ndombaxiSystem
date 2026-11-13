import React, { useEffect, useRef, useState } from 'react';
import { readFileProgress, runTransfer } from '../components/feedback';
import { api, ApiError } from '../api/client';
import type { SiteSettings, UpdateSiteSettingsInput } from '../api/types';
import { IconImage, IconStore } from '../components/Icons';
import { Switch } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { STORE_URL } from '../config';
import { ReviewsCard } from './StoreMarketing';

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
  const [receiptMessage, setReceiptMessage] = useState('');
  const [isPublished, setIsPublished] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { companyCode } = useAuth();
  const [copied, setCopied] = useState(false);
  // Link AUTOMÁTICO por empresa: usa ?loja=<code> (query param). No Cloudflare
  // Pages a rota estática /<code> dá 404 e a loja caía no ecrã "indique o código";
  // o query param é sempre servido pelo index.html → abre direto.
  const storeLink = companyCode ? `${STORE_URL}/?loja=${companyCode}` : '';
  const copyLink = async () => {
    if (!storeLink) return;
    try {
      await navigator.clipboard.writeText(storeLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard indisponível neste contexto */ }
  };

  const [pdfBusy, setPdfBusy] = useState(false);

  /** Descarrega um PDF VERDADEIRO (A4) do cartaz da loja — gerado com jsPDF
   *  (biblioteca PDF), NUNCA por screenshot. Contém logo, nome da empresa e da
   *  loja, QR em alta resolução, URL, descrição, benefícios, como partilhar,
   *  contactos e rodapé, nas cores da marca. O gerador (~400 KB com o jsPDF) é
   *  importado dinamicamente, só quando o utilizador clica. */
  const downloadStorePdf = async () => {
    if (!storeLink || pdfBusy) return;
    setPdfBusy(true);
    try {
      const [{ buildStorePosterPdf, posterFileName }, identity] = await Promise.all([
        import('../pdf/storePosterPdf'),
        api.branding().catch(() => null),
      ]);
      const storeName = brandName.trim() || identity?.brandName || identity?.companyName || 'A nossa loja online';
      await runTransfer({ title: 'A gerar o cartaz em PDF', kind: 'generate', task: async () => {
        const pdf = await buildStorePosterPdf({
          identity,
          storeName,
          tagline: tagline.trim() || undefined,
          logoUrl: logoUrl || undefined,
          storeLink,
          primaryColor,
          contactPhone: contactPhone.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
          address: address.trim() || undefined,
        });
        pdf.save(posterFileName(storeName));
      } });
    } catch {
      setError('Não foi possível gerar o PDF do cartaz. Tente novamente.');
    } finally { setPdfBusy(false); }
  };

  /** Cartaz A4 da loja de associados (/<código>/associados), igual ao da loja online. */
  const [mPdfBusy, setMPdfBusy] = useState(false);
  const downloadMembersPdf = async () => {
    if (!companyCode || mPdfBusy) return;
    setMPdfBusy(true);
    try {
      const { downloadMembersPoster } = await import('../pdf/membersPoster');
      await runTransfer({ title: 'A gerar o cartaz em PDF', kind: 'generate', task: () => downloadMembersPoster(companyCode) });
    } catch { setError('Não foi possível gerar o PDF do cartaz. Tente novamente.'); } finally { setMPdfBusy(false); }
  };

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
    setReceiptMessage(s.receipt_message ?? '');
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
    void readFileProgress(file).then((data) => setLogoUrl(data));
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
        receiptMessage,
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
    return <div className="vd-page"><div className="vd-card"><div className="vd-empty">A carregar…</div></div></div>;
  }

  return (
    <div className="vd-page">
      <div className="vd-head">
        <p className="vd-crumb"><span style={{ color: 'var(--primary)' }}>Loja online</span><span className="sep">/</span><span>Definições</span></p>
        {settings ? <span className={`vd-badge${isPublished ? '' : ' mute'}`}>{isPublished ? 'Publicada' : 'Oculta'}</span> : null}
        <span className="spacer" />
        {storeLink ? <a className="vd-btn outline" href={storeLink} target="_blank" rel="noreferrer">Abrir a loja</a> : null}
        <button className="vd-btn" onClick={save} disabled={saving}>{saving ? 'A guardar…' : saved ? 'Guardado' : 'Guardar'}</button>
      </div>

      {error ? <div className="vd-err" role="alert">{error}</div> : null}

      <div className="vd-card lo-link">
        <div className="lo-link-main">
          <span className="lo-lbl">Ligação da loja</span>
          {storeLink ? (
            <div className="lo-link-row">
              <input className="vd-in" readOnly aria-label="Ligação da loja online" value={storeLink} onFocus={(e) => e.currentTarget.select()} />
              <button className="vd-btn" onClick={copyLink}>{copied ? 'Copiado' : 'Copiar'}</button>
            </div>
          ) : <div className="vd-err">Sem código da empresa nesta sessão.</div>}
        </div>
        {storeLink ? (
          <div className="lo-link-acts">
            <a className="vd-btn outline" href={`https://wa.me/?text=${encodeURIComponent('Visita a nossa loja online: ' + storeLink)}`} target="_blank" rel="noreferrer">WhatsApp</a>
            <button className="vd-btn outline" onClick={() => void downloadStorePdf()} disabled={pdfBusy}>{pdfBusy ? 'A gerar…' : 'Cartaz PDF (A4)'}</button>
            <button className="vd-btn outline" onClick={() => void downloadMembersPdf()} disabled={mPdfBusy}>{mPdfBusy ? 'A gerar…' : 'Cartaz PDF da loja de associados'}</button>
          </div>
        ) : null}
      </div>

      <div className="lo-grid">
        <div className="vd-card lo-sec">
          <h3 className="lo-h">Identidade</h3>
          <div className="lo-logo">
            <div className="lo-logo-box">{logoUrl ? <img src={logoUrl} alt="" /> : <IconStore size={30} />}</div>
            <div className="lo-logo-acts">
              <button className="vd-btn outline sm" onClick={() => fileRef.current?.click()}><IconImage size={15} /> {logoUrl ? 'Trocar logótipo' : 'Carregar logótipo'}</button>
              {logoUrl ? <button className="vd-btn plain sm" onClick={() => setLogoUrl('')}>Remover</button> : null}
              <span className="lo-hint">PNG ou JPG · máx. 1,5 MB</span>
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden aria-label="Carregar logótipo" onChange={(e) => onPickLogo(e.target.files?.[0])} />
          </div>
          <label className="lo-f"><span>Nome da marca</span><input className="vd-in" value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="NovaShop" /></label>
          <label className="lo-f"><span>Slogan</span><input className="vd-in" value={tagline} onChange={(e) => setTagline(e.target.value)} /></label>
          <div className="lo-2">
            <label className="lo-f"><span>Cor principal</span><span className="lo-color"><input type="color" aria-label="Escolher cor principal" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} /><input className="vd-in" aria-label="Cor principal (hexadecimal)" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} /></span></label>
            <label className="lo-f"><span>Cor secundária</span><span className="lo-color"><input type="color" aria-label="Escolher cor secundária" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} /><input className="vd-in" aria-label="Cor secundária (hexadecimal)" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} /></span></label>
          </div>
          <div className="lo-preview" style={{ background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})` }}>
            {logoUrl ? <img src={logoUrl} alt="" /> : null}
            <div><b>{brandName || 'A sua marca'}</b>{tagline ? <span>{tagline}</span> : null}</div>
          </div>
        </div>

        <div className="lo-col">
          <div className="vd-card lo-sec">
            <h3 className="lo-h">Contactos</h3>
            <div className="lo-2">
              <label className="lo-f"><span>E-mail</span><input className="vd-in" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="loja@empresa.ao" /></label>
              <label className="lo-f"><span>Telefone</span><input className="vd-in" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+244 ..." /></label>
            </div>
            <label className="lo-f"><span>Morada</span><input className="vd-in" value={address} onChange={(e) => setAddress(e.target.value)} /></label>
            <label className="lo-f"><span>Dizeres do recibo (rodapé)</span><textarea className="vd-in" value={receiptMessage} onChange={(e) => setReceiptMessage(e.target.value)} rows={3} /></label>
          </div>
          <div className="vd-card lo-sec lo-pub">
            <div><strong>Publicar loja online</strong><span className={`vd-badge${isPublished ? '' : ' mute'}`}>{isPublished ? 'Publicada' : 'Oculta'}</span></div>
            <Switch checked={isPublished} onChange={setIsPublished} />
          </div>
        </div>
      </div>

      <ReviewsCard />
    </div>
  );
}
