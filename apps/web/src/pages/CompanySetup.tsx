import React, { useEffect, useRef, useState } from 'react';
import { readFileProgress } from '../components/feedback';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { BankAccount, PublicPlan } from '../api/types';
import { IconCard, IconImage, IconLogout, IconCheck } from '../components/Icons';
import { lookVars, useAuthPublic, useFitHeight } from './vendusAuth';
import { ScreenKeyboard } from '../components/ScreenKeyboard';
import { LOGO_WIDE } from '../brand';

/** Cargos e objectivos do assistente (iguais aos do Vendus). */
const ROLES: { id: string; label: string }[] = [
  { id: 'OWNER', label: 'Proprietário' },
  { id: 'MANAGER', label: 'Gerente' },
  { id: 'IT', label: 'Técnico de Informática' },
  { id: 'ACCOUNTANT', label: 'Contabilista' },
  { id: 'OTHER', label: 'Outro' },
];
const USAGES: { id: string; label: string }[] = [
  { id: 'INVOICING', label: 'Faturação' },
  { id: 'POS', label: 'POS' },
  { id: 'RESTAURANT', label: 'Restauração' },
  { id: 'ECOMMERCE', label: 'Comércio Eletrónico ou API' },
];
type StepId = 'welcome' | 'pay' | 'company' | 'user' | 'goal';
const STEP_LABEL: Record<StepId, string> = {
  welcome: 'Bem-Vindo!', pay: 'Pagamento', company: 'Dados da Empresa', user: 'Dados do Utilizador', goal: 'Objectivo do LPS Vendas',
};
const HELP_URL = '/guides/criar-conta.png';

/**
 * Assistente de BOAS-VINDAS depois de criar a conta — igual ao do Vendus:
 * coluna de passos à esquerda (Bem-Vindo, Dados da Empresa, Dados do
 * Utilizador, Objectivo) e "Preencher Mais Tarde"; à direita o passo actual com
 * etiquetas flutuantes, "Validar NIF", Anterior/Continuar e "Terminar".
 * Sem teste grátis activo, o Pagamento entra como passo 2.
 */
export function CompanySetup({ onDone }: { onDone(): void }) {
  const { logout } = useAuth();
  const pub = useAuthPublic();
  const fitRef = useFitHeight<HTMLDivElement>(0, true);
  const [trial, setTrial] = useState(false);
  const [checked, setChecked] = useState(false);
  const [step, setStep] = useState<StepId>('welcome');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Dados
  const [nif, setNif] = useState('');
  const [nifMsg, setNifMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [person, setPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('');
  const [usage, setUsage] = useState('');
  const [mobileSteps, setMobileSteps] = useState(false);

  useEffect(() => {
    let alive = true;
    api.subscription.mine()
      .then((subs) => {
        const active = subs.some((s) => s.status === 'ACTIVE' && (!s.expiresAt || new Date(s.expiresAt) > new Date()));
        if (alive) setTrial(active);
      })
      .catch(() => undefined)
      .finally(() => { if (alive) setChecked(true); });
    api.onboarding.setupStatus().then((s) => { if (alive && s.nif) setNif((v) => v || s.nif!); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const steps: StepId[] = trial ? ['welcome', 'company', 'user', 'goal'] : ['welcome', 'pay', 'company', 'user', 'goal'];
  const idx = steps.indexOf(step);
  const go = (s: StepId) => { setErr(null); setStep(s); setMobileSteps(false); };
  const next = () => go(steps[Math.min(steps.length - 1, idx + 1)]);
  const prev = () => go(steps[Math.max(0, idx - 1)]);

  const nifNorm = nif.trim().toUpperCase();
  const nifOk = /^(\d{9,10}|\d{9}[A-Z]{2}\d{3})$/.test(nifNorm);

  const validateNif = async () => {
    setNifMsg(null);
    if (!nifNorm) { setNifMsg({ ok: false, text: 'Indique o NIF.' }); return; }
    try {
      const r = await api.onboarding.validateNif(nifNorm);
      setNifMsg(r.valid ? { ok: true, text: 'NIF válido.' } : { ok: false, text: r.reason ?? 'NIF inválido.' });
    } catch (e) { setNifMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Não foi possível validar o NIF.' }); }
  };

  const companyNext = () => {
    if (!nifOk) { setErr('NIF inválido (9–10 dígitos, ou 14 caracteres do BI).'); return; }
    if (name.trim().length < 2) { setErr('Indique o nome da empresa.'); return; }
    if (!address.trim()) { setErr('Indique a morada.'); return; }
    if (!city.trim()) { setErr('Indique a localidade.'); return; }
    next();
  };
  const userNext = () => {
    if (person.trim().split(/\s+/).length < 2) { setErr('Indique o primeiro e o último nome.'); return; }
    if (!/^[+\d\s()-]{9,30}$/.test(phone.trim())) { setErr('Indique um telefone válido.'); return; }
    if (!role) { setErr('Selecione o cargo na empresa.'); return; }
    next();
  };
  const finish = async () => {
    if (!usage) { setErr('Selecione como pretende utilizar o LPS Vendas.'); return; }
    setBusy(true); setErr(null);
    try {
      await api.onboarding.completeSetup({
        name: name.trim(), nif: nifNorm, logoUrl: logoUrl || undefined, address: address.trim(), city: city.trim(),
        responsibleName: person.trim(), responsiblePhone: phone.trim(), responsibleRole: role, usage,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível concluir.');
    } finally { setBusy(false); }
  };
  const later = async () => {
    setErr(null);
    try { await api.onboarding.skipSetup(); onDone(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível continuar mais tarde.'); go('company'); }
  };
  const onLogo = (file?: File) => {
    if (!file) return;
    if (file.size > 1_500_000) { setErr('Logótipo demasiado grande (máx. ~1,5 MB).'); return; }
    void readFileProgress(file).then((data) => setLogoUrl(data));
  };

  const Help = () => <a className="vw-help" href={HELP_URL} target="_blank" rel="noreferrer"><span aria-hidden>?</span>Ajuda</a>;
  const Req = () => <span className="vw-req">*</span>;

  const stepList = (
    <ol className="vw-steps">
      {steps.map((s, i) => (
        <li key={s} className={i < idx ? 'done' : i === idx ? 'on' : ''}>
          <button type="button" onClick={() => (i <= idx ? go(s) : undefined)} disabled={i > idx}>
            <span className="vw-num">{i + 1}</span><span>{STEP_LABEL[s]}</span>
          </button>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="va vw" style={lookVars(pub?.look)}>
      <ScreenKeyboard />
      <aside className="vw-side">
        <img className="vw-logo" src={LOGO_WIDE} alt="LPS Vendas" />
        {stepList}
        <div className="vw-side-foot">
          <a onClick={() => void later()}><span aria-hidden>↗</span> Preencher Mais Tarde</a>
          <a onClick={() => void logout()}><IconLogout size={14} /> Terminar sessão</a>
        </div>
      </aside>

      <header className="vw-mhead">
        <img src={LOGO_WIDE} alt="LPS Vendas" />
        <button type="button" onClick={() => setMobileSteps((v) => !v)}>☰ Etapas</button>
      </header>
      {mobileSteps ? <div className="vw-mpanel">{stepList}<a onClick={() => void later()}>↗ Preencher Mais Tarde</a></div> : null}

      <main className="vw-main">
        <div className="vw-body" ref={fitRef}>
          {!checked ? <div className="vw-loading">A preparar…</div> : step === 'welcome' ? (
            <section className="vw-welcome">
              <h2>Bem-Vindo ao LPS Vendas</h2>
              <p>Fature em segundos e acompanhe as suas vendas no computador, telemóvel ou tablet, de forma simples e prática!</p>
              <button type="button" className="vw-btn" onClick={next}>Continuar →</button>
              <a className="vw-needhelp" href={HELP_URL} target="_blank" rel="noreferrer">Precisa de ajuda?</a>
              <img className="vw-hero" src="/landing/painel.webp" alt="" />
              <div className="vw-promo">
                {trial
                  ? <><b>Teste grátis de {pub?.trialDays ?? 14} dias ativo</b> — preencha os dados do seu negócio para começar a faturar.</>
                  : <><b>Ative o seu plano</b> e preencha os dados do seu negócio para começar a faturar.</>}
              </div>
            </section>
          ) : step === 'pay' ? (
            <section>
              <div className="vw-head"><h4>Pagamento</h4><Help /></div>
              <PayStep auth onNext={next} />
              <div className="vw-actions"><button type="button" className="vw-btn ghost" onClick={prev}>Anterior</button></div>
            </section>
          ) : step === 'company' ? (
            <section>
              <div className="vw-head"><h4>Dados da Empresa</h4><Help /></div>
              {err ? <div className="vw-err" role="alert">{err}</div> : null}
              <div className="vw-group">
                <div className="vw-fl">
                  <input id="vw-nif" placeholder="NIF" value={nif} inputMode="numeric"
                    onChange={(e) => { setNif(e.target.value.replace(/[^0-9a-zA-Z]/g, '').toUpperCase().slice(0, 14)); setNifMsg(null); }} />
                  <label htmlFor="vw-nif">NIF <Req /></label>
                </div>
                <button type="button" className="vw-append" onClick={() => void validateNif()}>Validar NIF</button>
              </div>
              {nifMsg ? <div className={`vw-hint ${nifMsg.ok ? 'ok' : 'bad'}`}>{nifMsg.text}</div> : null}
              <div className="vw-fl"><input id="vw-name" placeholder="Nome da Empresa" value={name} onChange={(e) => setName(e.target.value)} /><label htmlFor="vw-name">Nome da Empresa <Req /></label></div>
              <div className="vw-fl"><input id="vw-addr" placeholder="Morada" value={address} onChange={(e) => setAddress(e.target.value)} /><label htmlFor="vw-addr">Morada <Req /></label></div>
              <div className="vw-fl"><input id="vw-city" placeholder="Localidade" value={city} onChange={(e) => setCity(e.target.value)} /><label htmlFor="vw-city">Localidade <Req /></label></div>
              <label className="vw-logo-up">
                <span className="vw-logo-box">{logoUrl ? <img src={logoUrl} alt="" /> : <IconImage size={18} />}</span>
                <span>{logoUrl ? 'Trocar logótipo' : 'Logótipo (opcional)'}</span>
                <input type="file" accept="image/*" hidden onChange={(e) => onLogo(e.target.files?.[0])} />
              </label>
              <div className="vw-actions">
                <button type="button" className="vw-btn ghost" onClick={prev}>Anterior</button>
                <button type="button" className="vw-btn" onClick={companyNext}>Continuar →</button>
              </div>
              <p className="vw-reqnote"><Req /> Campos de preenchimento obrigatório</p>
            </section>
          ) : step === 'user' ? (
            <section>
              <div className="vw-head"><h4>Dados Utilizador</h4><Help /></div>
              {err ? <div className="vw-err" role="alert">{err}</div> : null}
              <div className="vw-fl"><input id="vw-person" placeholder="Nome Completo" value={person} onChange={(e) => setPerson(e.target.value)} autoComplete="name" /><label htmlFor="vw-person">Primeiro e Último Nome <Req /></label></div>
              <div className="vw-fl"><input id="vw-phone" type="tel" placeholder="Telefone" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" /><label htmlFor="vw-phone">Telefone <Req /></label></div>
              <div className="vw-fl">
                <select id="vw-role" value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="">Selecione uma opção</option>
                  {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                <label htmlFor="vw-role">Cargo na Empresa <Req /></label>
              </div>
              <div className="vw-actions">
                <button type="button" className="vw-btn ghost" onClick={prev}>Anterior</button>
                <button type="button" className="vw-btn" onClick={userNext}>Continuar →</button>
              </div>
              <p className="vw-reqnote"><Req /> Campos de preenchimento obrigatório</p>
            </section>
          ) : (
            <section>
              <div className="vw-head"><h4>Como pretende utilizar o LPS Vendas? <Req /></h4><Help /></div>
              {err ? <div className="vw-err" role="alert">{err}</div> : null}
              {USAGES.map((u) => (
                <label key={u.id} className={`vw-radio${usage === u.id ? ' on' : ''}`}>
                  <input type="radio" name="vw-usage" value={u.id} checked={usage === u.id} onChange={() => setUsage(u.id)} />
                  <span>{u.label}</span>
                </label>
              ))}
              <div className="vw-actions">
                <button type="button" className="vw-btn ghost" onClick={prev} disabled={busy}>Anterior</button>
                <button type="button" className="vw-btn" onClick={() => void finish()} disabled={busy}>{busy ? 'A concluir…' : '✓ Terminar'}</button>
              </div>
              <p className="vw-reqnote"><Req /> Campos de preenchimento obrigatório</p>
            </section>
          )}
        </div>
      </main>
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
    void readFileProgress(f).then((data) => setFile({ name: f.name, type: f.type, data: data }));
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
