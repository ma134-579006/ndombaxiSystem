import React, { useCallback, useEffect, useRef, useState } from 'react';
import { readFileProgress } from '../components/feedback';
import { api, ApiError } from '../api/client';
import type { BankAccount, DeviceRow, ManagerStore, PublicPlan, SubMessage, Subscription as Sub, SubStatus } from '../api/types';
import { IconCard, IconCheck, IconReceipt } from '../components/Icons';

function kz(n: number): string { return n.toLocaleString('pt-PT') + ' Kz'; }

const STATUS_LABEL: Record<SubStatus, string> = {
  PENDING_PAYMENT: 'Aguarda pagamento', IN_REVIEW: 'Comprovativo em análise',
  ACTIVE: 'Activa', REJECTED: 'Rejeitada', EXPIRED: 'Expirada',
};
const STATUS_TONE: Record<SubStatus, string> = {
  PENDING_PAYMENT: 'var(--warning)', IN_REVIEW: 'var(--primary)',
  ACTIVE: 'var(--success)', REJECTED: 'var(--danger)', EXPIRED: 'var(--muted)',
};

async function fileToBase64(file: File): Promise<{ data: string; type: string; name: string }> {
  const res = await readFileProgress(file);
  return { data: res.includes(',') ? res.slice(res.indexOf(',') + 1) : res, type: file.type || 'image/jpeg', name: file.name };
}

type SubSummary = Awaited<ReturnType<typeof api.subscription.status>>;

/** Período legível de um plano/subscrição: "1 mês", "3 meses", "30 dias", "sem prazo". */
function periodLabel(months: number, days = 0): string {
  const parts: string[] = [];
  if (months) parts.push(`${months} ${months === 1 ? 'mês' : 'meses'}`);
  if (days) parts.push(`${days} ${days === 1 ? 'dia' : 'dias'}`);
  return parts.join(' e ') || 'sem prazo';
}
const priceLabel = (p: { priceKz: number; durationMonths: number; durationDays?: number }) =>
  p.priceKz > 0 ? `${kz(p.priceKz)} / ${periodLabel(p.durationMonths, p.durationDays)}` : 'Grátis';
const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)) : null);

/** Subscrição & Plano (lado da empresa): plano actual, escolher plano, pagar por IBAN,
 *  enviar comprovativo (imagem) e conversar com o Super Admin. */
export function Subscription({ onGo }: { onGo?: (section: string) => void } = {}) {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, b, l] = await Promise.all([api.subscription.mine(), api.banks(), api.publicLanding()]);
      setSubs(s); setBanks(b); setPlans(l.plans); setError(null);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // A subscrição em vigor é a ACTIVE ainda válida que expira mais tarde (não a primeira da lista).
  const active = subs
    .filter((s) => s.status === 'ACTIVE' && (!s.expiresAt || new Date(s.expiresAt).getTime() > Date.now()))
    .sort((x, y) => (y.expiresAt ? new Date(y.expiresAt).getTime() : Infinity) - (x.expiresAt ? new Date(x.expiresAt).getTime() : Infinity))[0];
  const pending = subs.find((s) => s.status === 'PENDING_PAYMENT' || s.status === 'IN_REVIEW');
  const [changing, setChanging] = useState(false);
  const histRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const go = () => { try { sessionStorage.removeItem('lps.sub.focus'); } catch { /* */ } histRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    let want = false; try { want = sessionStorage.getItem('lps.sub.focus') === 'history'; } catch { /* */ }
    if (want && !loading) go();
    window.addEventListener('lps:sub-history', go);
    return () => window.removeEventListener('lps:sub-history', go);
  }, [loading]);
  const left = daysLeft(active?.expiresAt ?? null);
  // Estado resumido (o MESMO do anel "Renovar subscrição"): com o motor Cegid
  // Vendus, o plano, o fim e a % são os do Vendus.
  const [st, setSt] = useState<SubSummary | null>(null);
  const [units, setUnits] = useState<{ store: ManagerStore; devices: DeviceRow[] }[] | null>(null);
  useEffect(() => {
    api.subscription.status().then(setSt).catch(() => setSt(null));
    Promise.all([api.staff.listStores(), api.devices.list().catch(() => [] as DeviceRow[])])
      .then(([stores, devs]) => setUnits(stores.filter((x) => x.is_active).map((store) => ({ store, devices: devs.filter((d) => d.is_active && d.store_id === store.id) }))))
      .catch(() => setUnits([]));
  }, [subs]);
  const vendus = st?.provider === 'VENDUS';
  const endIso = st?.expiresAt ?? active?.expiresAt ?? null;
  const pctUsed = st?.active ? st.pct : active?.startsAt && active?.expiresAt && left != null
    ? Math.floor(Math.min(100, Math.max(0, ((Math.max(1, (Date.parse(active.expiresAt) - Date.parse(active.startsAt)) / 864e5) - left + 1) / Math.max(1, (Date.parse(active.expiresAt) - Date.parse(active.startsAt)) / 864e5)) * 100)))
    : null;
  const planName = vendus ? (st?.plan ?? null) : (active?.isTrial ? 'de teste' : active?.plan?.name ?? null);
  const isActive = vendus ? !!st?.active : !!active;
  const renew = () => { if (vendus && st?.renewUrl) window.open(st.renewUrl, '_blank', 'noopener'); else setChanging(true); };

  return (
    <div className="fx-wide sub-vd">
      <div className="content-head"><h2>Subscrição</h2></div>
      {error ? <div className="banner danger">{error}</div> : null}

      {!loading ? (
        <div className="sub-vd-hero">
          <div className="sub-vd-bg" aria-hidden="true" />
          <div className="sub-vd-grid">
            <section className="sub-vd-card sub-vd-main">
              <header className="sub-vd-h">
                <span className="t">Subscrição</span>
                <span className="s">{endIso ? `A sua subscrição termina em ${new Date(endIso).toLocaleDateString('pt-PT')}` : 'Ainda não tem uma subscrição ativa'}</span>
              </header>
              <div className="sub-vd-body">
                <div className="sub-vd-plan">
                  <b>{planName ? `Plano ${planName}` : 'Sem plano ativo'}</b>
                  <span>{pending ? STATUS_LABEL[pending.status] + '.' : isActive ? 'A sua subscrição encontra-se ativa.' : 'A sua subscrição não está ativa.'}</span>
                  {pctUsed != null ? (
                    <div className="sub-vd-track" role="progressbar" aria-valuenow={pctUsed} aria-valuemin={0} aria-valuemax={100} aria-label="Tempo da subscrição já utilizado">
                      <span className={pctUsed >= 90 ? 'bad' : pctUsed >= 75 ? 'warn' : ''} style={{ width: `${Math.max(pctUsed, 3)}%` }} />
                    </div>
                  ) : null}
                </div>
                <div className="sub-vd-act">
                  <button type="button" className="sub-vd-btn" onClick={renew}>Renovar</button>
                  {!vendus ? <button type="button" className="sub-vd-link" onClick={() => setChanging(true)}>Alterar Plano</button>
                    : st?.renewUrl ? <a className="sub-vd-link" href={st.renewUrl} target="_blank" rel="noopener noreferrer">Alterar Plano</a> : null}
                </div>
              </div>
            </section>
            <section className="sub-vd-card sub-vd-side">
              <header className="sub-vd-h left">
                <span className="t">Detalhes</span>
                <span className="s">As unidades configuradas na sua conta</span>
              </header>
              <div className="sub-vd-body">
                {units == null ? <span className="muted">A carregar…</span> : units.length === 0 ? <span className="muted">Sem lojas configuradas.</span> : units.map((u) => (
                  <div className="sub-vd-unit" key={u.store.id}>
                    <b>{u.store.name}</b>
                    <ul>{u.devices.length ? u.devices.map((d) => <li key={d.id}>{d.name}</li>) : <li className="muted">Sem caixas registadas</li>}</ul>
                  </div>
                ))}
              </div>
              {onGo ? <footer className="sub-vd-f"><button type="button" className="sub-vd-link blue" onClick={() => onGo('registers')}>Configurar</button></footer> : null}
            </section>
          </div>
        </div>
      ) : null}


      {loading ? <div className="fx-card"><div className="loading">A carregar…</div></div>
        : pending ? <PayAndChat sub={pending} banks={banks} onChanged={load} />
        : (active || vendus) && !changing ? null
        : <CreateForm plans={plans} banks={banks} currentPlanId={active?.planId} onCreated={() => { setChanging(false); void load(); }} onCancel={active ? () => setChanging(false) : undefined} />}

      {/* Histórico de Pagamentos (o item do painel CONFIG traz aqui) */}
      {subs.length > 0 ? (
        <div className="fx-card" style={{ padding: 8 }} ref={histRef} id="sub-historico">
          <div className="fx-card-h" style={{ padding: '12px 14px 0', marginBottom: 6 }}><div><h3>Histórico de subscrições</h3></div></div>
          {subs.map((s) => {
            const expired = s.status === 'ACTIVE' && s.expiresAt && new Date(s.expiresAt).getTime() < Date.now();
            const st: SubStatus = expired ? 'EXPIRED' : s.status;
            return (
              <div className="co-row" key={s.id}>
                <span className="co-av" aria-hidden="true">{(s.plan?.name ?? 'P').slice(0, 2).toUpperCase()}</span>
                <div className="co-main">
                  <div className="co-name">{s.plan?.name ?? 'Plano'}</div>
                  <div className="co-meta">
                    <span className="co-plan">{s.amountKz > 0 ? `${kz(s.amountKz)} / ${periodLabel(s.durationMonths, s.durationDays)}` : 'Sem custo'}</span>
                    <span>{new Date(s.createdAt).toLocaleDateString('pt-PT')}</span>
                    <span>{s.method === 'IBAN' ? 'Transferência' : 'Referência'}</span>
                  </div>
                </div>
                <span className="badge" style={{ color: STATUS_TONE[st], borderColor: 'currentColor' }}><span className="dot" /> {STATUS_LABEL[st]}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function CreateForm({ plans, banks, currentPlanId, onCreated, onCancel }: { plans: PublicPlan[]; banks: BankAccount[]; currentPlanId?: string; onCreated(): void; onCancel?: () => void }) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? '');
  const [method, setMethod] = useState<'IBAN' | 'REFERENCE'>('IBAN');
  const [bankAccountId, setBankAccountId] = useState(banks[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (!planId && plans[0]) setPlanId(plans[0].id); }, [plans]); // eslint-disable-line
  useEffect(() => { if (!bankAccountId && banks[0]) setBankAccountId(banks[0].id); }, [banks]); // eslint-disable-line
  const plan = plans.find((p) => p.id === planId);

  const submit = async () => {
    setErr(null);
    if (!planId) { setErr('Escolhe um plano.'); return; }
    if (method === 'IBAN' && !bankAccountId) { setErr('Escolhe a conta bancária para a transferência.'); return; }
    setBusy(true);
    try {
      await api.subscription.create({ planId, method, bankAccountId: method === 'IBAN' ? bankAccountId : undefined });
      onCreated();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao subscrever.'); }
    finally { setBusy(false); }
  };

  const lim = (n: number) => (n === -1 ? 'ilimitados' : String(n));

  return (
    <div className="fx-card">
      <div className="fx-card-h">
        <div>
          <h3>Escolher plano</h3>
          <p>Podes trocar de plano quando quiseres. O novo plano fica activo depois de o pagamento ser aprovado.</p>
        </div>
        {onCancel ? <button className="btn sm ghost" onClick={onCancel}>Cancelar</button> : null}
      </div>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <div className="fx-plans" role="radiogroup" aria-label="Planos">
        {plans.map((p) => (
          <button key={p.id} role="radio" aria-checked={planId === p.id} className={`fx-plan${planId === p.id ? ' on' : ''}`} onClick={() => setPlanId(p.id)}>
            <span className="fx-plan-top">
              <b>{p.name}</b>
              {p.id === currentPlanId ? <span className="fx-badge ok" style={{ padding: '2px 9px', fontSize: 11 }}>Actual</span> : p.highlight ? <span className="fx-badge" style={{ padding: '2px 9px', fontSize: 11 }}>Popular</span> : null}
            </span>
            <span className="fx-plan-price">{p.priceKz > 0 ? kz(p.priceKz) : 'Grátis'}</span>
            <span className="fx-plan-per">{p.priceKz > 0 ? `por ${periodLabel(p.durationMonths, p.durationDays)}` : 'sem custo'}</span>
            <span className="fx-plan-lim">{lim(p.maxStores)} loja(s) · {lim(p.maxUsers)} utilizadores</span>
          </button>
        ))}
      </div>
      <div className="fx-grid" style={{ marginTop: 16 }}>
        <div className="field"><label>Método de pagamento</label>
          <select value={method} onChange={(e) => setMethod(e.target.value as 'IBAN' | 'REFERENCE')}>
            <option value="IBAN">Transferência bancária (IBAN)</option>
            <option value="REFERENCE">Referência Multicaixa</option>
          </select></div>
        {method === 'IBAN' ? (
          <div className="field"><label>Conta para transferir</label>
            <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
              {banks.length === 0 ? <option value="">(sem contas configuradas)</option> : null}
              {banks.map((b) => <option key={b.id} value={b.id}>{b.bankName} — {b.iban}</option>)}
            </select></div>
        ) : null}
      </div>
      <div className="fx-actions">
        <button className="btn lg" onClick={submit} disabled={busy || !planId}>
          {busy ? 'A subscrever…' : `Subscrever${plan && plan.priceKz > 0 ? ` (${kz(plan.priceKz)})` : ''}`}
        </button>
      </div>
    </div>
  );
}

function PayAndChat({ sub, banks, onChanged }: { sub: Sub; banks: BankAccount[]; onChanged(): void }) {
  const bank = banks.find((b) => b.id === sub.bankAccountId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<SubMessage[]>([]);
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const loadMsgs = useCallback(async () => {
    try { setMsgs(await api.subscription.messages(sub.id)); } catch { /* ignore */ }
  }, [sub.id]);
  useEffect(() => { void loadMsgs(); }, [loadMsgs]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 4_000_000) { setErr('Imagem demasiado grande (máx. ~4 MB).'); return; }
    setBusy(true); setErr(null);
    try {
      const f = await fileToBase64(file);
      await api.subscription.submitProof(sub.id, { fileName: f.name, fileType: f.type, fileData: f.data, amountKz: sub.amountKz });
      onChanged();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao enviar o comprovativo.'); }
    finally { setBusy(false); }
  };

  const send = async () => {
    if (!text.trim()) return;
    try { const m = await api.subscription.send(sub.id, text.trim()); setMsgs((p) => [...p, m]); setText(''); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao enviar.'); }
  };

  return (
    <div className="fx-card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>{sub.plan?.name ?? 'Plano'} — {kz(sub.amountKz)}</h3>
        <span className="badge" style={{ color: STATUS_TONE[sub.status], borderColor: 'currentColor' }}>{STATUS_LABEL[sub.status]}</span>
      </div>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}

      {sub.method === 'IBAN' ? (
        <div className="banner" style={{ marginBottom: 12, display: 'block' }}>
          <strong>Transfere {kz(sub.amountKz)} para:</strong><br />
          {bank ? (
            <>
              {bank.bankName} · {bank.accountHolder}<br />
              <span className="mono">{bank.iban}</span>
            </>
          ) : 'A plataforma ainda não configurou a conta bancária — fala com o suporte abaixo.'}
        </div>
      ) : sub.reference ? (
        <div className="banner" style={{ marginBottom: 12, display: 'block' }}>
          <strong>Paga por referência Multicaixa:</strong><br /><span className="mono">{sub.reference}</span>
        </div>
      ) : null}

      {sub.status !== 'IN_REVIEW' ? (
        <>
          <button className="btn block" onClick={() => fileRef.current?.click()} disabled={busy}>
            <IconReceipt size={16} /> {busy ? 'A enviar…' : 'Enviar comprovativo (foto)'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
        </>
      ) : (
        <div className="banner success" style={{ marginBottom: 4 }}>
          <IconCheck size={16} /> Comprovativo recebido — a aguardar aprovação do Super Admin.
        </div>
      )}

      {/* Chat com o Super Admin */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 10 }}>
        <strong style={{ fontSize: 14 }}><IconCard size={14} /> Conversa com o suporte</strong>
        <div style={{ maxHeight: 200, overflow: 'auto', margin: '10px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {msgs.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>Sem mensagens. Escreve se precisares de ajuda.</p>
            : msgs.map((m) => (
              <div key={m.id} style={{ alignSelf: m.sender === 'COMPANY' ? 'flex-end' : 'flex-start', maxWidth: '82%', background: m.sender === 'COMPANY' ? 'var(--primary)' : 'var(--surface-2)', color: m.sender === 'COMPANY' ? '#fff' : 'var(--text)', padding: '8px 12px', borderRadius: 12, fontSize: 14 }}>
                {m.sender === 'ADMIN' ? <div style={{ fontSize: 11, fontWeight: 700, opacity: .8, marginBottom: 2 }}>Suporte</div> : null}
                {m.body}
              </div>
            ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', color: 'var(--text)' }}
            value={text} onChange={(e) => setText(e.target.value)} placeholder="Escrever ao suporte…" onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} />
          <button className="btn" onClick={send}>Enviar</button>
        </div>
      </div>
    </div>
  );
}
