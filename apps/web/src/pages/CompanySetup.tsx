import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { BankAccount, PublicPlan } from '../api/types';
import { IconBuilding, IconCard, IconImage, IconLogout, IconCheck } from '../components/Icons';
import { LoginShowcase } from '../components/LoginShowcase';
import { ScreenKeyboard } from '../components/ScreenKeyboard';

/**
 * Assistente de ATIVAÇÃO da empresa — reconstruído com a MESMA identidade
 * visual do Login/Criar Conta (layout `.auth`, showcase à direita, cartão de
 * vidro, progresso numerado e validação em tempo real).
 *
 * Fluxo (inalterado):
 *   1) Pagamento — IBAN da plataforma + comprovativo (ou ativação imediata no
 *      plano gratuito / teste grátis).
 *   2) Dados — logótipo, nome e NIF. Só depois o painel desbloqueia.
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

  const payDone = trial || step === 'data';

  return (
    <div className="auth">
      <ScreenKeyboard />
      <div className="auth-panel">
        <div className="auth-form">
          <div className="auth-brandhead">
            <div className="ic"><IconBuilding size={26} /></div>
            <div>
              <h1>Ativar a sua empresa</h1>
              <p className="sub">{trial ? 'Teste grátis ativo — só faltam os dados' : 'Dois passos rápidos e está a faturar'}</p>
            </div>
          </div>

          {!trial ? (
            <div className="setup-steps" aria-hidden>
              <div className={`st ${payDone ? 'done' : 'on'}`}>
                <div className="dot">{payDone ? <IconCheck size={16} /> : '1'}</div>
                <div className="lbl">Pagamento</div>
              </div>
              <div className={`bar ${payDone ? 'done' : ''}`} />
              <div className={`st ${step === 'data' ? 'on' : ''}`}>
                <div className="dot">2</div>
                <div className="lbl">Dados</div>
              </div>
            </div>
          ) : null}

          {!checked ? (
            <div className="auth-glass"><div className="loading" style={{ color: '#9fb0cc' }}>A preparar…</div></div>
          ) : step === 'pay' ? (
            <PayStep auth onNext={() => setStep('data')} />
          ) : (
            <DataStep onDone={onDone} onBack={trial ? undefined : () => setStep('pay')} />
          )}

          <p className="auth-foot logout">
            <a onClick={() => void logout()}><IconLogout size={15} /> Terminar sessão</a>
          </p>
        </div>
      </div>
      <div className="auth-media"><LoginShowcase /></div>
    </div>
  );
}

export function PayStep({ onNext, allowPlanChoice = false, auth = false }: { onNext(): void; allowPlanChoice?: boolean; auth?: boolean }) {
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [plan, setPlan] = useState<{ planId: string; planName: string; priceKz: number; tier?: string } | null>(null);
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [chosenPlanId, setChosenPlanId] = useState<string>('');
  const [file, setFile] = useState<{ name: string; type: string; data: string } | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.banks().then(setBanks).catch(() => undefined);
    api.onboarding.myPlan().then((p) => { setPlan(p); if (p && !chosenPlanId) setChosenPlanId(p.planId); }).catch(() => undefined);
    if (allowPlanChoice) api.plans().then((ps) => setPlans(ps.filter((p) => p.isPublic))).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const chosenPlan = plans.find((p) => p.id === chosenPlanId);
  const dueKz = chosenPlan ? chosenPlan.priceKz : (plan?.priceKz ?? 0);
  // Plano GRATUITO: ativação imediata — sem transferência nem comprovativo.
  const isFree = (chosenPlan ? chosenPlan.tier : plan?.tier) === 'FREE';

  const activateFree = async () => {
    setErr(null); setBusy(true);
    try {
      const wantPlanId = allowPlanChoice ? (chosenPlanId || plan?.planId) : plan?.planId;
      if (!wantPlanId) { setErr('Plano não encontrado. Contacte o suporte.'); setBusy(false); return; }
      await api.subscription.create({ planId: wantPlanId, method: 'IBAN' });
      onNext();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível ativar o plano gratuito.');
    } finally { setBusy(false); }
  };

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
      // Renovação com escolha de plano: força uma nova subscrição com o plano escolhido.
      const wantPlanId = allowPlanChoice ? (chosenPlanId || plan?.planId) : plan?.planId;
      if (allowPlanChoice && wantPlanId && sub && sub.planId !== wantPlanId) sub = undefined;
      if (!sub) {
        if (!wantPlanId) { setErr('Plano não encontrado. Contacte o suporte.'); setBusy(false); return; }
        sub = await api.subscription.create({ planId: wantPlanId, method: 'IBAN', bankAccountId: banks[0]?.id });
      }
      await api.subscription.submitProof(sub.id, { fileName: file.name, fileType: file.type, fileData: file.data, amountKz: amount ? Number(amount) : undefined });
      onNext();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível enviar o comprovativo.');
    } finally { setBusy(false); }
  };

  // ── NOVO visual (identidade do login): usado no CompanySetup ──────────────
  if (auth) {
    return (
      <div className="auth-glass auth-stepanim">
        {err ? <div className="auth-error">{err}</div> : null}
        {allowPlanChoice && plans.length > 0 ? (
          <div className="auth-field">
            <label className="auth-label" style={{ marginTop: 0 }}>Escolha o plano para renovar</label>
            <select className="auth-input" value={chosenPlanId} onChange={(e) => setChosenPlanId(e.target.value)}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {p.priceKz > 0 ? `${p.priceKz.toLocaleString('pt-PT')} Kz` : 'sob consulta'}</option>
              ))}
            </select>
          </div>
        ) : null}

        {isFree ? (
          <>
            <div className="auth-note ok">
              Plano <strong>{chosenPlan?.name ?? plan?.planName ?? 'Gratuito'}</strong> — grátis. Ativação imediata, sem pagamento nem aprovação.
            </div>
            <button className="auth-btn" onClick={activateFree} disabled={busy}>
              {busy ? 'A ativar…' : 'Ativar plano gratuito e continuar'}
            </button>
          </>
        ) : (
          <>
            <p className="auth-hint neutral" style={{ margin: '0 0 12px', fontSize: 13 }}>
              {allowPlanChoice
                ? (chosenPlan ? <>Plano <strong style={{ color: '#fff' }}>{chosenPlan.name}</strong>{dueKz > 0 ? ` — ${dueKz.toLocaleString('pt-PT')} Kz` : ''}. </> : null)
                : (plan ? <>Plano <strong style={{ color: '#fff' }}>{plan.planName}</strong>{plan.priceKz > 0 ? ` — ${plan.priceKz.toLocaleString('pt-PT')} Kz` : ''}. </> : null)}
              Faça a transferência para uma das contas e anexe o comprovativo.
            </p>

            {banks.length > 0 ? (
              <div className="auth-note">
                {banks.map((b) => (
                  <div key={b.id} className="bankrow">
                    <strong>{b.bankName}</strong> · {b.accountHolder}<br />
                    <span className="iban">{b.iban}</span>
                  </div>
                ))}
              </div>
            ) : <p className="auth-hint neutral" style={{ marginBottom: 12 }}>Contas bancárias serão indicadas pelo suporte.</p>}

            <div className="auth-field">
              <label className="auth-label" style={{ marginTop: 0 }}>Valor pago (Kz, opcional)</label>
              <input className="auth-input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="ex.: 15000" />
            </div>

            <label className={`auth-file ${file ? 'has' : ''}`} style={{ marginTop: 10 }}>
              {file ? <IconCheck size={16} /> : <IconImage size={16} />}
              <span>{file ? file.name : 'Carregar comprovativo (screenshot ou PDF)'}</span>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            </label>

            <button className="auth-btn" onClick={submit} disabled={busy}>
              {busy ? 'A enviar…' : 'Enviar comprovativo e continuar'}
            </button>
          </>
        )}
      </div>
    );
  }

  // ── Visual ANTIGO (inalterado) — usado por PlanExpired (.login/.box) ──────
  return (
    <div className="card">
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      {allowPlanChoice && plans.length > 0 ? (
        <div className="field">
          <label>Escolha o plano para renovar</label>
          <select value={chosenPlanId} onChange={(e) => setChosenPlanId(e.target.value)}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.priceKz > 0 ? `${p.priceKz.toLocaleString('pt-PT')} Kz` : 'sob consulta'}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {isFree ? (
        <>
          <div className="banner info" style={{ display: 'block', marginBottom: 12 }}>
            Plano <strong>{chosenPlan?.name ?? plan?.planName ?? 'Gratuito'}</strong> — grátis.
            Ativação imediata, sem pagamento nem aprovação.
          </div>
          <button className="btn lg block" onClick={activateFree} disabled={busy}>
            <IconCheck size={18} /> {busy ? 'A ativar…' : 'Ativar plano gratuito e continuar'}
          </button>
        </>
      ) : (<>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {allowPlanChoice
          ? (chosenPlan ? <>Plano <strong>{chosenPlan.name}</strong>{dueKz > 0 ? <> — {dueKz.toLocaleString('pt-PT')} Kz</> : null}. </> : null)
          : (plan ? <>Plano <strong>{plan.planName}</strong>{plan.priceKz > 0 ? <> — {plan.priceKz.toLocaleString('pt-PT')} Kz</> : null}. </> : null)}
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
      </>)}
    </div>
  );
}

function DataStep({ onDone, onBack }: { onDone(): void; onBack?: () => void }) {
  const [name, setName] = useState('');
  const [nif, setNif] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [touched, setTouched] = useState<{ name?: boolean; nif?: boolean }>({});
  const fileRef = useRef<HTMLInputElement>(null);

  // Validação em tempo real
  const nameOk = name.trim().length >= 2;
  const nifDigits = nif.trim();
  const nifOk = /^\d{9,10}$/.test(nifDigits);
  const canSubmit = useMemo(() => nameOk && nifOk, [nameOk, nifOk]);

  const onLogo = (file?: File) => {
    if (!file) return;
    if (file.size > 1_500_000) { setErr('Logótipo demasiado grande (máx. ~1,5 MB).'); return; }
    const r = new FileReader();
    r.onload = () => setLogoUrl(String(r.result));
    r.readAsDataURL(file);
  };

  const submit = async () => {
    setErr(null);
    setTouched({ name: true, nif: true });
    if (!nameOk) { setErr('Indique o nome da empresa.'); return; }
    if (!nifOk) { setErr('NIF inválido (9 a 10 dígitos).'); return; }
    setBusy(true);
    try {
      // O código da loja é gerado automaticamente a partir do nome (no servidor).
      await api.onboarding.completeSetup({ name: name.trim(), nif: nifDigits, logoUrl: logoUrl || undefined });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível concluir o setup.');
    } finally { setBusy(false); }
  };

  const nameState = !touched.name && !name ? 'neutral' : nameOk ? 'ok' : 'bad';
  const nifState = !touched.nif && !nif ? 'neutral' : nifOk ? 'ok' : 'bad';

  return (
    <div className="auth-glass auth-stepanim">
      {err ? <div className="auth-error">{err}</div> : null}

      <div className="auth-logo">
        <div className="lgbox">
          {logoUrl ? <img src={logoUrl} alt="logótipo" /> : <IconImage size={26} />}
        </div>
        <label className="auth-btn ghost sm">
          <IconImage size={15} /> {logoUrl ? 'Trocar logótipo' : 'Carregar logótipo'}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onLogo(e.target.files?.[0])} />
        </label>
      </div>

      <div className="auth-field">
        <label className="auth-label" style={{ marginTop: 0 }}>Nome da empresa</label>
        <div className="auth-inwrap">
          <input
            className={`auth-input ${nameState === 'neutral' ? '' : nameState}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            placeholder="Ex.: Nova Shop, Lda"
          />
          {nameState === 'ok' ? <span className="vmark" style={{ color: '#22c55e' }}><IconCheck size={16} /></span> : null}
        </div>
        <div className={`auth-hint ${nameState}`}>
          {nameState === 'bad' ? 'Indique o nome legal da empresa.' : nameState === 'ok' ? 'Perfeito.' : 'Nome que aparece nas faturas e na loja.'}
        </div>
      </div>

      <div className="auth-field">
        <label className="auth-label" style={{ marginTop: 0 }}>NIF da empresa</label>
        <div className="auth-inwrap">
          <input
            className={`auth-input ${nifState === 'neutral' ? '' : nifState}`}
            value={nif}
            onChange={(e) => setNif(e.target.value.replace(/\D/g, '').slice(0, 10))}
            onBlur={() => setTouched((t) => ({ ...t, nif: true }))}
            placeholder="5XXXXXXXX"
            inputMode="numeric"
          />
          {nifState === 'ok' ? <span className="vmark" style={{ color: '#22c55e' }}><IconCheck size={16} /></span> : null}
        </div>
        <div className={`auth-hint ${nifState}`}>
          {nifState === 'bad' ? `NIF inválido — ${nifDigits.length}/9 dígitos.` : nifState === 'ok' ? 'NIF válido.' : '9 a 10 dígitos, como na AGT.'}
        </div>
      </div>

      <div className="auth-btnrow" style={{ marginTop: 8 }}>
        {onBack ? <button className="auth-btn ghost" style={{ flex: '0 0 auto', width: 'auto', padding: '0 18px' }} onClick={onBack} disabled={busy}>← Voltar</button> : null}
        <button className="auth-btn" style={{ flex: 1 }} onClick={submit} disabled={busy || !canSubmit}>
          {busy ? 'A concluir…' : 'Concluir e entrar'}
        </button>
      </div>
    </div>
  );
}
