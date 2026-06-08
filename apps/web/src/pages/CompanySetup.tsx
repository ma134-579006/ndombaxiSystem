import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { BankAccount } from '../api/types';
import { IconBuilding, IconCard, IconImage, IconLogout, IconCheck } from '../components/Icons';

/**
 * Setup OBRIGATÓRIO da empresa, em 2 passos (estilo Vendus / onboarding pro):
 *   1) Pagamento — IBAN da plataforma + upload do comprovativo (screenshot).
 *   2) Dados — logótipo, nome, código da loja e NIF.
 * Só depois de ambos é que o painel desbloqueia.
 */
export function CompanySetup({ onDone }: { onDone(): void }) {
  const { logout } = useAuth();
  const [step, setStep] = useState<'pay' | 'data'>('pay');
  // Período de TESTE GRÁTIS: se já existe uma subscrição ativa válida (trial),
  // não se pede pagamento — vai direto aos dados da empresa.
  const [trial, setTrial] = useState(false);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let alive = true;
    api.subscription.mine()
      .then((subs) => {
        const active = subs.some((s) => s.status === 'ACTIVE' && (!s.expiresAt || new Date(s.expiresAt) > new Date()));
        if (alive) { setTrial(active); if (active) setStep('data'); }
      })
      .catch(() => undefined)
      .finally(() => { if (alive) setChecked(true); });
    return () => { alive = false; };
  }, []);
  if (!checked) return <div className="login"><div className="box" style={{ maxWidth: 480 }}><div className="card"><div className="loading">A preparar…</div></div></div></div>;
  return (
    <div className="login">
      <div className="box" style={{ maxWidth: 480 }}>
        <div className="brand">
          <div style={{ width: 56, height: 56, borderRadius: 16, display: 'grid', placeItems: 'center', background: 'var(--surface-2)', border: '1px solid var(--border)', marginBottom: 10 }}>
            <IconBuilding size={28} />
          </div>
          <h1>Ativar a sua empresa</h1>
          <div className="tg">{trial ? '🎁 Teste grátis ativo — só faltam os dados da empresa' : `Passo ${step === 'pay' ? '1 de 2 — Pagamento' : '2 de 2 — Dados da empresa'}`}</div>
        </div>
        {!trial ? <div className="steps-bar"><span className={step === 'pay' ? 'on' : 'done'} /><span className={step === 'data' ? 'on' : ''} /></div> : null}
        {step === 'pay'
          ? <PayStep onNext={() => setStep('data')} />
          : <DataStep onDone={onDone} onBack={trial ? undefined : () => setStep('pay')} />}
        <p style={{ textAlign: 'center', marginTop: 12 }}>
          <a onClick={() => void logout()} style={{ color: 'var(--muted)', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconLogout size={15} /> Terminar sessão
          </a>
        </p>
      </div>
    </div>
  );
}

export function PayStep({ onNext }: { onNext(): void }) {
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [plan, setPlan] = useState<{ planId: string; planName: string; priceKz: number } | null>(null);
  const [file, setFile] = useState<{ name: string; type: string; data: string } | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.banks().then(setBanks).catch(() => undefined);
    api.onboarding.myPlan().then(setPlan).catch(() => undefined);
  }, []);

  const onFile = (f?: File) => {
    if (!f) return;
    if (f.size > 4_000_000) { setErr('Imagem demasiado grande (máx. ~4 MB).'); return; }
    const r = new FileReader();
    r.onload = () => setFile({ name: f.name, type: f.type, data: String(r.result) });
    r.readAsDataURL(f);
  };

  const submit = async () => {
    setErr(null);
    if (!file) { setErr('Carregue o comprovativo (screenshot) do pagamento.'); return; }
    setBusy(true);
    try {
      // Reaproveita uma subscrição PENDENTE; se só existir ACTIVE/EXPIRED/REJEITADA
      // (ex.: renovação), cria uma NOVA para o super admin aprovar.
      const subs = await api.subscription.mine().catch(() => []);
      let sub = subs.find((s) => s.status === 'PENDING_PAYMENT' || s.status === 'IN_REVIEW');
      if (!sub) {
        if (!plan) { setErr('Plano não encontrado. Contacte o suporte.'); setBusy(false); return; }
        sub = await api.subscription.create({ planId: plan.planId, method: 'IBAN', bankAccountId: banks[0]?.id });
      }
      await api.subscription.submitProof(sub.id, { fileName: file.name, fileType: file.type, fileData: file.data, amountKz: amount ? Number(amount) : undefined });
      onNext();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível enviar o comprovativo.');
    } finally { setBusy(false); }
  };

  return (
    <div className="card">
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {plan ? <>Plano <strong>{plan.planName}</strong>{plan.priceKz > 0 ? <> — {plan.priceKz.toLocaleString('pt-PT')} Kz</> : null}. </> : null}
        Faça a transferência para uma das contas e anexe o comprovativo.
      </p>
      {banks.length > 0 ? (
        <div className="banner info" style={{ display: 'block', marginBottom: 12 }}>
          {banks.map((b) => (
            <div key={b.id} style={{ marginBottom: 6 }}>
              <strong>{b.bankName}</strong> · {b.accountHolder}<br />
              <span style={{ fontFamily: 'monospace' }}>{b.iban}</span>
            </div>
          ))}
        </div>
      ) : <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>Contas bancárias serão indicadas pelo suporte.</div>}

      <div className="field"><label>Valor pago (Kz, opcional)</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="ex.: 15000" /></div>
      <label className="btn ghost block" style={{ marginBottom: 10 }}>
        <IconImage size={16} /> {file ? `Comprovativo: ${file.name}` : 'Carregar comprovativo (screenshot)'}
        <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      <button className="btn lg block" onClick={submit} disabled={busy}>
        <IconCard size={18} /> {busy ? 'A enviar…' : 'Enviar comprovativo e continuar'}
      </button>
    </div>
  );
}

function DataStep({ onDone, onBack }: { onDone(): void; onBack?: () => void }) {
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
      <div className="field"><label>Código da loja (login e link da loja online)</label>
        <input value={companyCode} onChange={(e) => setCompanyCode(e.target.value.toLowerCase())} placeholder="ex.: novashop" /></div>
      <div className="field"><label>NIF da empresa</label>
        <input value={nif} onChange={(e) => setNif(e.target.value)} placeholder="5XXXXXXXX" inputMode="numeric" /></div>
      <div className="row" style={{ gap: 10 }}>
        {onBack ? <button className="btn ghost" onClick={onBack} disabled={busy}>← Voltar</button> : null}
        <button className="btn lg" style={{ flex: 1 }} onClick={submit} disabled={busy}>
          <IconCheck size={18} /> {busy ? 'A concluir…' : 'Concluir e entrar'}
        </button>
      </div>
    </div>
  );
}
