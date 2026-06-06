import React, { useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { IconBuilding, IconImage, IconLogout } from '../components/Icons';

/**
 * Setup OBRIGATÓRIO da empresa (pós-registo/pós-pagamento): logótipo, nome,
 * código da loja e NIF. Enquanto não for concluído, o painel fica bloqueado.
 */
export function CompanySetup({ onDone }: { onDone(): void }) {
  const { logout } = useAuth();
  const [name, setName] = useState('');
  const [companyCode, setCompanyCode] = useState('');
  const [nif, setNif] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onLogo = (file?: File) => {
    if (!file) return;
    if (file.size > 1_500_000) { setErr('Logótipo demasiado grande (máx. ~1,5 MB).'); return; }
    const r = new FileReader();
    r.onload = () => setLogoUrl(String(r.result));
    r.readAsDataURL(file);
  };

  const submit = async () => {
    setErr(null);
    if (!name.trim()) { setErr('Indique o nome da empresa.'); return; }
    if (!/^[a-z0-9-]{2,40}$/.test(companyCode.trim().toLowerCase())) { setErr('Código inválido (minúsculas, dígitos e hífens).'); return; }
    if (!/^\d{9,10}$/.test(nif.trim())) { setErr('NIF inválido (9 a 10 dígitos).'); return; }
    setBusy(true);
    try {
      await api.onboarding.completeSetup({ name: name.trim(), companyCode: companyCode.trim().toLowerCase(), nif: nif.trim(), logoUrl: logoUrl || undefined });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível concluir o setup.');
    } finally { setBusy(false); }
  };

  return (
    <div className="login">
      <div className="box" style={{ maxWidth: 460 }}>
        <div className="brand">
          <div style={{ width: 56, height: 56, borderRadius: 16, display: 'grid', placeItems: 'center', background: 'var(--surface-2)', border: '1px solid var(--border)', marginBottom: 10 }}>
            <IconBuilding size={28} />
          </div>
          <h1>Configure a sua empresa</h1>
          <div className="tg">Passo obrigatório para começar a usar o sistema</div>
        </div>
        <div className="card">
          {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}

          <div className="row" style={{ gap: 14, alignItems: 'center', marginBottom: 10 }}>
            <div style={{ width: 64, height: 64, borderRadius: 14, border: '1px solid var(--border)', display: 'grid', placeItems: 'center', overflow: 'hidden', background: 'var(--surface-2)' }}>
              {logoUrl ? <img src={logoUrl} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <IconImage size={26} />}
            </div>
            <label className="btn ghost sm">
              <IconImage size={15} /> {logoUrl ? 'Trocar logótipo' : 'Carregar logótipo'}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onLogo(e.target.files?.[0])} />
            </label>
          </div>

          <div className="field"><label>Nome da empresa</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Nova Shop, Lda" /></div>
          <div className="field"><label>Código da loja (para login e link da loja online)</label>
            <input value={companyCode} onChange={(e) => setCompanyCode(e.target.value.toLowerCase())} placeholder="ex.: novashop" /></div>
          <div className="field"><label>NIF da empresa</label>
            <input value={nif} onChange={(e) => setNif(e.target.value)} placeholder="5XXXXXXXX" inputMode="numeric" /></div>

          <button className="btn lg block" onClick={submit} disabled={busy}>
            {busy ? 'A concluir…' : 'Concluir e entrar'}
          </button>
        </div>
        <p style={{ textAlign: 'center', marginTop: 12 }}>
          <a onClick={() => void logout()} style={{ color: 'var(--muted)', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconLogout size={15} /> Terminar sessão
          </a>
        </p>
      </div>
    </div>
  );
}
