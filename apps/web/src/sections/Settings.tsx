import { confirmDialog, toast } from '../components/feedback';
import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { STAFF_ROLE_LABELS, type ManagerStaff, type SiteSettings } from '../api/types';
import { Modal } from '../components/ui';
import { UserAvatar } from '../components/UserAvatar';
import { IconBuilding, IconImage, IconReceipt } from '../components/Icons';
import { ShopServerCard } from './ShopServerCard';

/**
 * Configurações da empresa (admin): branding (logo/nome), dados e dizeres dos
 * recibos, reposição de senhas/PIN dos funcionários, plano e impressora.
 */
export function Settings() {
  const [tab, setTab] = useState<'brand' | 'modules' | 'passwords' | 'printer' | 'loja'>('brand');
  return (
    <>
      <div className="content-head">
        <h2>Configurações</h2>
      </div>
      <div className="fx-tabs inv-tabs">
        <button className={tab === 'brand' ? 'on' : ''} onClick={() => setTab('brand')}>Empresa & Recibos</button>
        <button className={tab === 'modules' ? 'on' : ''} onClick={() => setTab('modules')}>Módulos</button>
        <button className={tab === 'passwords' ? 'on' : ''} onClick={() => setTab('passwords')}>Senhas dos funcionários</button>
        <button className={tab === 'printer' ? 'on' : ''} onClick={() => setTab('printer')}>Impressora & Plano</button>
        <button className={tab === 'loja' ? 'on' : ''} onClick={() => setTab('loja')}>Servidor da loja</button>
      </div>
      {tab === 'brand' ? <BrandingCard /> : null}
      {tab === 'modules' ? <ModulesCard /> : null}
      {tab === 'passwords' ? <PasswordsCard /> : null}
      {tab === 'printer' ? <PrinterCard /> : null}
      {tab === 'loja' ? <ShopServerCard /> : null}
    </>
  );
}

/** Módulos ativáveis por empresa. Hoje: Loja Online (portal público). */
function ModulesCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.site.get().then((x) => setEnabled(x.online_store_enabled !== false))
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'Falha ao carregar.'));
  }, []);

  const toggle = async (next: boolean) => {
    setBusy(true); setErr(null);
    const prev = enabled;
    setEnabled(next); // otimista
    try {
      await api.site.update({ onlineStoreEnabled: next });
      toast.success(next ? 'Loja Online ativada.' : 'Loja Online desativada — o portal público fica indisponível.');
    } catch (e) {
      setEnabled(prev);
      setErr(e instanceof ApiError ? e.message : 'Falha ao guardar.');
    } finally { setBusy(false); }
  };

  if (enabled === null) return <div className="card"><div className="loading">A carregar…</div></div>;
  return (
    <div className="card">
      <h3><IconBuilding size={18} /> Módulos</h3>
      {err ? <div className="banner danger">{err}</div> : null}
      <div className="switch-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>Loja Online</div>
          <p className="muted" style={{ margin: '3px 0 0', fontSize: 13 }}>
            Portal público de vendas/reservas/pedidos, adaptado ao seu ramo. Quando <strong>desligado</strong>,
            o portal fica indisponível e os menus da loja (Loja & Marca, Encomendas) desaparecem do painel.
            O resto do ERP funciona normalmente.
          </p>
        </div>
        <label className="switch" aria-label="Loja Online">
          <input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
          <span className="tk" /><span className="th" />
        </label>
      </div>
    </div>
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
  const [defaultIva, setDefaultIva] = useState('NOR');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.site.get().then((x) => {
      setS(x); setBrandName(x.brand_name ?? ''); setLogoUrl(x.logo_url ?? '');
      setContactPhone(x.contact_phone ?? ''); setContactEmail(x.contact_email ?? '');
      setAddress(x.address ?? ''); setReceiptMessage(x.receipt_message ?? '');
      setDefaultIva(x.default_iva_code || 'NOR');
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
      await api.site.update({ brandName: brandName.trim() || undefined, logoUrl: logoUrl || undefined, contactPhone, contactEmail, address, receiptMessage, defaultIvaCode: defaultIva });
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
      <div className="field"><label>IVA padrão (usado quando o produto escolhe «Automático»)</label>
        <select value={defaultIva} onChange={(e) => setDefaultIva(e.target.value)}>
          <option value="NOR">NOR (14%)</option>
          <option value="INT">INT (7%)</option>
          <option value="RED">RED (5%)</option>
          <option value="ISE">ISE (0% — isento)</option>
          <option value="OUT">OUT (0% — não sujeito)</option>
        </select>
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
          Ao criar produtos com IVA «Automático», é esta taxa que fica aplicada.
        </p></div>
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
    if (!(await confirmDialog({ message: `Repor a senha de ${u.name}? Será gerada uma senha temporária.` }))) return;
    setBusyId(u.id); setResult(null); setErr(null);
    try {
      const r = await api.staff.resetPassword(u.id);
      setResult(r.temporaryPassword ? `Senha temporária de ${u.name}: ${r.temporaryPassword}` : `Senha de ${u.name} reposta.`);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao repor.'); }
    finally { setBusyId(null); }
  };

  const [pinFor, setPinFor] = useState<ManagerStaff | null>(null);
  const [pinVal, setPinVal] = useState('');
  const savePin = async () => {
    const u = pinFor; if (!u) return;
    // O PIN é SEMPRE de 6 dígitos (regra única em todo o sistema — a API rejeita outros tamanhos).
    if (!/^\d{6}$/.test(pinVal)) { setErr('PIN inválido — tem de ter exatamente 6 dígitos.'); return; }
    setBusyId(u.id); setResult(null); setErr(null);
    try { await api.staff.setPin(u.id, pinVal); setResult(`PIN de ${u.name} actualizado.`); setPinFor(null); setPinVal(''); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao definir PIN.'); }
    finally { setBusyId(null); }
  };

  return (
    <div className="card">
      <h3><IconBuilding size={18} /> Senhas e PIN dos funcionários</h3>
      <p className="muted">Reponha a senha (login) ou o PIN (caixa) de qualquer funcionário, incluindo administradores.</p>
      {err ? <div className="banner danger">{err}</div> : null}
      {result ? <div className="banner success">{result}</div> : null}
      <div className="rc-list">
        {users.map((u) => (
          <div key={u.id} className="rc-row rc-static st-READY pw-row">
            <UserAvatar name={u.name} email={u.email} size={42} />
            <div className="rc-main">
              <strong>{u.name}</strong>
              <div className="muted">{u.email}</div>
            </div>
            <span className="rc-state">{(STAFF_ROLE_LABELS as Record<string, string>)[u.role] ?? u.role}</span>
            <div className="lv-act">
              <button className="btn sm ghost" onClick={() => reset(u)} disabled={busyId === u.id}>Repor senha</button>
              <button className="btn sm ghost" onClick={() => { setPinFor(u); setPinVal(''); setErr(null); }} disabled={busyId === u.id}>Definir PIN</button>
            </div>
          </div>
        ))}
      </div>
      {pinFor ? (
        <Modal title={`PIN da caixa — ${pinFor.name}`} onClose={() => setPinFor(null)}>
          <p className="muted" style={{ marginTop: 0 }}>Defina um PIN de <strong>6 dígitos</strong> para {pinFor.name} entrar na caixa.</p>
          <div className="field"><label>Novo PIN</label>
            <input inputMode="numeric" autoFocus value={pinVal} maxLength={6} placeholder="••••••"
              onChange={(e) => setPinVal(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter') void savePin(); }} /></div>
          <button className="btn lg block" onClick={() => void savePin()} disabled={pinVal.length !== 6 || busyId === pinFor.id}>Guardar PIN</button>
        </Modal>
      ) : null}
    </div>
  );
}

function PrinterCard() {
  const testPrint = () => {
    const w = window.open('', '_blank', 'width=420,height=600');
    if (!w) { toast.error('Permita popups para imprimir a página de teste.'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Teste de impressão</title>
      <style>@page{size:80mm auto;margin:0} body{font-family:Arial,sans-serif;width:80mm;margin:0;padding:8px;text-align:center}
      h2{margin:6px 0} .l{border-top:1px dashed #000;margin:8px 0} small{color:#333}</style></head><body>
      <h2>Página de teste</h2><div class="l"></div>
      <p>Se está a ler isto, a impressora está a funcionar.</p>
      <p>80 mm · ${new Date().toLocaleString('pt-PT')}</p>
      <div class="l"></div><small>LPS Vendas</small>
      <script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  };
  return (
    <div className="card">
      <h3><IconReceipt size={18} /> Impressora &amp; Plano</h3>
      <p className="muted"><strong>Impressora térmica (80/58 mm):</strong> o tamanho do papel escolhe-se no <strong>caixa</strong>, no recibo (botão de tamanho de papel) e fica memorizado nesse dispositivo.</p>
      <div className="pr-steps">
        <div className="pr-step"><i>1</i><div><b>Ligue a impressora</b><span>WiFi/rede: adicione-a uma vez como impressora do sistema (Definições → Impressoras → Adicionar → WiFi/IP).</span></div></div>
        <div className="pr-step"><i>2</i><div><b>Escolha-a ao imprimir</b><span>No caixa ou nos relatórios, toque em Imprimir e escolha essa impressora — fica como predefinida.</span></div></div>
        <div className="pr-step"><i>3</i><div><b>Confirme com um teste</b><span>Imprima a página de teste para validar o tamanho do papel e a ligação.</span></div></div>
      </div>
      <button className="btn" onClick={testPrint}>Imprimir página de teste</button>
      <div className="pr-plan"><b>Plano e pagamentos</b><span>Faça a gestão do plano e do comprovativo na secção <strong>Subscrição &amp; Plano</strong>.</span></div>
    </div>
  );
}
