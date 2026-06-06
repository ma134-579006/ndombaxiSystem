import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { ManagerStaff, SiteSettings } from '../api/types';
import { IconBuilding, IconImage, IconReceipt } from '../components/Icons';

/**
 * Configurações da empresa (admin): branding (logo/nome), dados e dizeres dos
 * recibos, reposição de senhas/PIN dos funcionários, plano e impressora.
 */
export function Settings() {
  const [tab, setTab] = useState<'brand' | 'passwords' | 'printer'>('brand');
  return (
    <>
      <div className="content-head">
        <h2>Configurações</h2>
      </div>
      <div className="chip-row" style={{ gap: 6, marginBottom: 12 }}>
        <button className={`chip${tab === 'brand' ? ' on' : ''}`} onClick={() => setTab('brand')}>Empresa & Recibos</button>
        <button className={`chip${tab === 'passwords' ? ' on' : ''}`} onClick={() => setTab('passwords')}>Senhas dos funcionários</button>
        <button className={`chip${tab === 'printer' ? ' on' : ''}`} onClick={() => setTab('printer')}>Impressora & Plano</button>
      </div>
      {tab === 'brand' ? <BrandingCard /> : null}
      {tab === 'passwords' ? <PasswordsCard /> : null}
      {tab === 'printer' ? <PrinterCard /> : null}
    </>
  );
}

function BrandingCard() {
  const [s, setS] = useState<SiteSettings | null>(null);
  const [brandName, setBrandName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [address, setAddress] = useState('');
  const [receiptMessage, setReceiptMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.site.get().then((x) => {
      setS(x); setBrandName(x.brand_name ?? ''); setLogoUrl(x.logo_url ?? '');
      setContactPhone(x.contact_phone ?? ''); setContactEmail(x.contact_email ?? '');
      setAddress(x.address ?? ''); setReceiptMessage(x.receipt_message ?? '');
    }).catch((e) => setErr(e instanceof ApiError ? e.message : 'Falha ao carregar.'));
  }, []);

  const onLogo = (file?: File) => {
    if (!file) return;
    if (file.size > 1_500_000) { setErr('Logótipo demasiado grande (máx. ~1,5 MB).'); return; }
    const r = new FileReader();
    r.onload = () => setLogoUrl(String(r.result));
    r.readAsDataURL(file);
  };

  const save = async () => {
    setBusy(true); setMsg(null); setErr(null);
    try {
      await api.site.update({ brandName: brandName.trim() || undefined, logoUrl: logoUrl || undefined, contactPhone, contactEmail, address, receiptMessage });
      setMsg('Guardado. Aparece no admin, no caixa e nos recibos.');
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao guardar.'); }
    finally { setBusy(false); }
  };

  if (!s) return <div className="card"><div className="loading">A carregar…</div></div>;
  return (
    <div className="card">
      <h3><IconBuilding size={18} /> Empresa & Recibos</h3>
      {err ? <div className="banner danger">{err}</div> : null}
      {msg ? <div className="banner success">{msg}</div> : null}
      <div className="row" style={{ gap: 16, alignItems: 'center', marginBottom: 8 }}>
        <div style={{ width: 72, height: 72, borderRadius: 12, border: '1px solid var(--border)', display: 'grid', placeItems: 'center', overflow: 'hidden', background: 'var(--surface-2)' }}>
          {logoUrl ? <img src={logoUrl} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <IconImage size={28} />}
        </div>
        <label className="btn ghost sm">
          <IconImage size={15} /> {logoUrl ? 'Trocar logótipo' : 'Carregar logótipo'}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onLogo(e.target.files?.[0])} />
        </label>
        {logoUrl ? <button className="btn ghost sm" onClick={() => setLogoUrl('')}>Remover</button> : null}
      </div>
      <div className="field"><label>Nome da empresa (aparece no topo)</label>
        <input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Nome comercial" /></div>
      <div className="grid-2">
        <div className="field"><label>Telefone</label>
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+244 ..." /></div>
        <div className="field"><label>E-mail</label>
          <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="loja@empresa.ao" /></div>
      </div>
      <div className="field"><label>Morada (rodapé do recibo)</label>
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, bairro, município" /></div>
      <div className="field"><label>Dizeres do recibo (rodapé)</label>
        <textarea value={receiptMessage} onChange={(e) => setReceiptMessage(e.target.value)} rows={2}
          placeholder="Ex.: Os bens/serviços foram colocados à disposição do adquirente. Obrigado!" /></div>
      <button className="btn" onClick={save} disabled={busy}>{busy ? 'A guardar…' : 'Guardar'}</button>
    </div>
  );
}

function PasswordsCard() {
  const [users, setUsers] = useState<ManagerStaff[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => { api.staff.listUsers().then(setUsers).catch((e) => setErr(e instanceof ApiError ? e.message : 'Falha ao carregar.')); }, []);

  const reset = async (u: ManagerStaff) => {
    if (!window.confirm(`Repor a senha de ${u.name}? Será gerada uma senha temporária.`)) return;
    setBusyId(u.id); setResult(null); setErr(null);
    try {
      const r = await api.staff.resetPassword(u.id);
      setResult(r.temporaryPassword ? `Senha temporária de ${u.name}: ${r.temporaryPassword}` : `Senha de ${u.name} reposta.`);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao repor.'); }
    finally { setBusyId(null); }
  };

  const setPin = async (u: ManagerStaff) => {
    const pin = window.prompt(`Novo PIN (4–8 dígitos) para ${u.name} usar na caixa:`);
    if (!pin) return;
    if (!/^\d{4,8}$/.test(pin)) { setErr('PIN inválido (4 a 8 dígitos).'); return; }
    setBusyId(u.id); setResult(null); setErr(null);
    try { await api.staff.setPin(u.id, pin); setResult(`PIN de ${u.name} actualizado.`); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao definir PIN.'); }
    finally { setBusyId(null); }
  };

  return (
    <div className="card">
      <h3>Senhas e PIN dos funcionários</h3>
      <p className="muted" style={{ marginTop: 0 }}>Reponha a senha (login) ou o PIN (caixa) de qualquer funcionário, incluindo administradores.</p>
      {err ? <div className="banner danger">{err}</div> : null}
      {result ? <div className="banner success">{result}</div> : null}
      <table className="ptable stack">
        <thead><tr><th>Nome</th><th>Email</th><th>Função</th><th>Ações</th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td data-label="Nome">{u.name}</td>
              <td data-label="Email">{u.email}</td>
              <td data-label="Função">{u.role}</td>
              <td data-label="Ações">
                <button className="btn sm ghost" onClick={() => reset(u)} disabled={busyId === u.id}>Repor senha</button>{' '}
                <button className="btn sm ghost" onClick={() => setPin(u)} disabled={busyId === u.id}>Definir PIN</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PrinterCard() {
  return (
    <div className="card">
      <h3><IconReceipt size={18} /> Impressora & Plano</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        <strong>Impressora térmica:</strong> o tamanho do papel (80 mm / 58 mm) escolhe-se no próprio <strong>caixa</strong>, no recibo,
        no botão de tamanho de papel — fica memorizado nesse dispositivo. Para impressoras de WiFi, ligue-as como impressora do sistema
        no telemóvel/computador; ao tocar em <strong>Imprimir</strong> o recibo sai nelas.
      </p>
      <p className="muted">
        <strong>Plano e pagamentos:</strong> faça a gestão do plano e do comprovativo de pagamento na secção <strong>Subscrição &amp; Plano</strong>.
      </p>
    </div>
  );
}
