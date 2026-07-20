import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { SiteSettings, UpdateSiteSettingsInput } from '../api/types';
import { IconImage, IconStore } from '../components/Icons';
import { Switch } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { STORE_URL } from '../config';

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
    } catch {
      setError('Não foi possível gerar o PDF do cartaz. Tente novamente.');
    } finally { setPdfBusy(false); }
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

      {/* Link partilhável directo da loja (sem código) */}
      <div className="card" style={isPublished ? { borderColor: 'var(--success)' } : undefined}>
        <h3>🔗 Link da tua loja</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Partilha este link com os teus clientes. Ao abrir, vão <strong>direito à tua loja</strong> — sem precisar de escrever nenhum código.
        </p>
        {!isPublished ? (
          <div className="banner" style={{ marginBottom: 12 }}>
            A loja está <strong>oculta</strong>. Ativa “Publicar loja online” mais abaixo e guarda — o link passa a abrir para os clientes.
          </div>
        ) : null}
        {storeLink ? (
          <>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                readOnly
                value={storeLink}
                onFocus={(e) => e.currentTarget.select()}
                style={{ flex: '1 1 260px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 13px', color: 'var(--text)', fontSize: 14 }}
              />
              <button className="btn" onClick={copyLink}>{copied ? '✓ Copiado!' : 'Copiar link'}</button>
              <a className="btn ghost" href={storeLink} target="_blank" rel="noreferrer">Abrir</a>
              <button className="btn" onClick={() => void downloadStorePdf()} disabled={pdfBusy}>{pdfBusy ? 'A gerar PDF…' : '⬇️ Descarregar PDF (A4)'}</button>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <a
                className="btn sm ghost"
                href={`https://wa.me/?text=${encodeURIComponent('Visita a nossa loja online: ' + storeLink)}`}
                target="_blank"
                rel="noreferrer"
              >
                Partilhar no WhatsApp
              </a>
              <span className="muted" style={{ fontSize: 12 }}>O PDF (A4) é um documento verdadeiro com logo, QR em alta resolução, benefícios e contactos — imprima e cole na loja física.</span>
            </div>
          </>
        ) : (
          <div className="banner danger">Não foi possível obter o código da empresa nesta sessão.</div>
        )}
      </div>

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
          <label>Slogan (texto animado do topo da loja)</label>
          <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="ex.: Os melhores produtos, entregues em todo o Angola" />
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>Aparece no banner da loja com animação de auto-escrita. Vazio → texto padrão.</p>
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
        <div className="field">
          <label>Dizeres do recibo (rodapé)</label>
          <textarea value={receiptMessage} onChange={(e) => setReceiptMessage(e.target.value)} placeholder="Ex.: Os bens/serviços foram colocados à disposição do adquirente. Obrigado pela preferência." rows={2} />
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
            Aparece no rodapé dos recibos impressos (com a morada e o contacto da empresa). O logótipo e o nome vão no topo.
          </p>
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
