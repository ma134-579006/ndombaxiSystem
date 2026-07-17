import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, ApiError } from '../api/client';
import type { SiteSettings, UpdateSiteSettingsInput } from '../api/types';
import { IconImage, IconStore } from '../components/Icons';
import { Switch } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { STORE_URL } from '../config';

const escHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

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

  /** Cartaz A4 com o QR do link da loja no centro + instruções — imprime ou
   *  guarda em PDF (o utilizador escolhe "Guardar como PDF" no diálogo). */
  const printQrPoster = async () => {
    if (!storeLink) return;
    try {
      const qr = await QRCode.toDataURL(storeLink, { margin: 1, width: 520, errorCorrectionLevel: 'M' });
      const nome = brandName.trim() || 'A nossa loja online';
      const w = window.open('', '_blank', 'width=820,height=1000');
      if (!w) return;
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Loja online — ${escHtml(nome)}</title>
        <style>
          @page{size:A4;margin:0;} *{box-sizing:border-box;}
          body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;color:#0f172a;}
          .sheet{width:210mm;min-height:297mm;padding:22mm 18mm;display:flex;flex-direction:column;align-items:center;text-align:center;}
          .brand{font-size:30px;font-weight:800;margin:0 0 4px;}
          .sub{font-size:16px;color:#475569;margin:0 0 6px;}
          .hint{font-size:15px;color:#2563eb;font-weight:700;margin:2px 0 18px;}
          .qrwrap{border:3px solid #2563eb;border-radius:20px;padding:18px;background:#fff;box-shadow:0 8px 30px #2563eb22;}
          .qrwrap img{display:block;width:120mm;height:120mm;}
          .scan{font-size:22px;font-weight:800;margin:16px 0 2px;}
          .link{font-size:15px;color:#334155;word-break:break-all;margin:2px 0 22px;}
          .steps{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:8px;max-width:170mm;}
          .step{flex:1;min-width:44mm;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:14px 12px;}
          .step .n{width:30px;height:30px;border-radius:50%;background:#2563eb;color:#fff;font-weight:800;display:grid;place-items:center;margin:0 auto 8px;}
          .step .t{font-size:13.5px;color:#334155;}
          .perks{display:flex;gap:18px;justify-content:center;flex-wrap:wrap;margin-top:20px;color:#475569;font-size:14px;}
          .foot{margin-top:auto;padding-top:18px;color:#94a3b8;font-size:12px;}
        </style></head><body><div class="sheet">
          <h1 class="brand">${escHtml(nome)}</h1>
          <p class="sub">Compre online — rápido, sem filas, entrega em Angola</p>
          <p class="hint">Aponte a câmara do telemóvel ao código</p>
          <div class="qrwrap"><img src="${qr}" alt="QR da loja"/></div>
          <div class="scan">📱 Digitalize para abrir a loja</div>
          <div class="link">${escHtml(storeLink)}</div>
          <div class="steps">
            <div class="step"><div class="n">1</div><div class="t">Abra a câmara e aponte ao QR</div></div>
            <div class="step"><div class="n">2</div><div class="t">Toque na notificação para abrir a loja</div></div>
            <div class="step"><div class="n">3</div><div class="t">Escolha os produtos e encomende</div></div>
            <div class="step"><div class="n">4</div><div class="t">Pague na recolha ou por referência</div></div>
          </div>
          <div class="perks"><span>🚚 Entrega em Angola</span><span>🛡️ Compra protegida</span><span>💬 Apoio ao cliente</span><span>🧾 Fatura AGT</span></div>
          <div class="foot">Loja online segura · Ndombaxi System</div>
        </div>
        <script>window.onload=function(){setTimeout(function(){window.print();},300);}<\/script></body></html>`);
      w.document.close();
    } catch { /* falha ao gerar o QR */ }
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
              <button className="btn" onClick={() => void printQrPoster()}>🖨️ Cartaz QR (A4)</button>
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
              <span className="muted" style={{ fontSize: 12 }}>O cartaz QR (A4) imprime ou guarda em PDF — cole na loja física.</span>
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
