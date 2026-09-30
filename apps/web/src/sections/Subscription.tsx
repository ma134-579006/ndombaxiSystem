import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { BankAccount, PublicPlan, SubMessage, Subscription as Sub, SubStatus } from '../api/types';
import { IconCheck, IconCard, IconReceipt } from '../components/Icons';

function kz(n: number): string { return n.toLocaleString('pt-PT') + ' Kz'; }

const STATUS_LABEL: Record<SubStatus, string> = {
  PENDING_PAYMENT: 'Aguarda pagamento', IN_REVIEW: 'Comprovativo em análise',
  ACTIVE: 'Activa', REJECTED: 'Rejeitada', EXPIRED: 'Expirada',
};
const STATUS_TONE: Record<SubStatus, string> = {
  PENDING_PAYMENT: 'var(--warning)', IN_REVIEW: 'var(--primary)',
  ACTIVE: 'var(--success)', REJECTED: 'var(--danger)', EXPIRED: 'var(--muted)',
};

function fileToBase64(file: File): Promise<{ data: string; type: string; name: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result);
      resolve({ data: res.includes(',') ? res.slice(res.indexOf(',') + 1) : res, type: file.type || 'image/jpeg', name: file.name });
    };
    r.onerror = () => reject(new Error('read'));
    r.readAsDataURL(file);
  });
}

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
export function Subscription() {
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
  const currentPlan = plans.find((pl) => pl.id === active?.planId);
  const left = daysLeft(active?.expiresAt ?? null);

  return (
    <div className="fx-wide">
      <div className="content-head"><h2>Subscrição &amp; Plano</h2></div>
      {error ? <div className="banner danger">{error}</div> : null}

      {!loading ? (
        <div className="fx-stats">
          <div className="fx-stat"><span className="ic"><IconCard size={20} /></span><div><div className="lb">Plano actual</div><div className="vl">{active?.plan?.name ?? 'Sem plano activo'}</div><div className="sb">{active ? (active.isTrial ? 'período de teste' : priceLabel({ priceKz: active.amountKz, durationMonths: active.durationMonths, durationDays: active.durationDays })) : 'escolhe um plano abaixo'}</div></div></div>
          <div className="fx-stat"><span className="ic"><IconCheck size={20} /></span><div><div className="lb">Válido até</div><div className="vl">{active?.expiresAt ? new Date(active.expiresAt).toLocaleDateString('pt-PT') : '—'}</div><div className="sb">{left != null ? `${left} dia(s) restante(s)` : 'sem data de fim'}</div></div></div>
          <div className="fx-stat"><span className="ic"><IconReceipt size={20} /></span><div><div className="lb">Lojas incluídas</div><div className="vl">{currentPlan ? (currentPlan.maxStores === -1 ? 'Ilimitadas' : currentPlan.maxStores) : '—'}</div><div className="sb">{currentPlan ? `${currentPlan.maxUsers === -1 ? 'utilizadores ilimitados' : `${currentPlan.maxUsers} utilizadores`}` : ''}</div></div></div>
          <div className="fx-stat"><span className="ic"><IconReceipt size={20} /></span><div><div className="lb">Estado</div><div className="vl"><span className={`fx-dot${pending ? '' : active ? ' ok' : ' bad'}`} />{pending ? STATUS_LABEL[pending.status] : active ? 'Em dia' : 'Sem acesso'}</div><div className="sb">{pending ? 'pagamento em curso' : active ? 'a usar o sistema' : 'renova para continuar'}</div></div></div>
        </div>
      ) : null}

      {loading ? <div className="fx-card"><div className="loading">A carregar…</div></div>
        : pending ? <PayAndChat sub={pending} banks={banks} onChanged={load} />
        : active && !changing ? <ActiveCard sub={active} left={left} onChange={() => setChanging(true)} />
        : <CreateForm plans={plans} banks={banks} currentPlanId={active?.planId} onCreated={() => { setChanging(false); void load(); }} onCancel={active ? () => setChanging(false) : undefined} />}

      {/* Histórico */}
      {subs.length > 0 ? (
        <div className="fx-card" style={{ padding: 8 }}>
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

function ActiveCard({ sub, left, onChange }: { sub: Sub; left: number | null; onChange(): void }) {
  const isTrial = !!sub.isTrial || (sub.amountKz === 0 && (sub.durationMonths ?? 0) === 0);
  const total = sub.startsAt && sub.expiresAt ? Math.max(1, (new Date(sub.expiresAt).getTime() - new Date(sub.startsAt).getTime()) / 86_400_000) : null;
  const pct = total != null && left != null ? Math.min(100, Math.max(0, Math.round(((total - left) / total) * 100))) : null;
  return (
    <div className="fx-card">
      <div className="fx-card-h">
        <div>
          <h3>{isTrial ? 'Período de teste gratuito' : `Plano ${sub.plan?.name ?? ''}`}</h3>
          <p>
            {isTrial ? 'Estás a testar o sistema sem custo.' : `${kz(sub.amountKz)} por ${periodLabel(sub.durationMonths, sub.durationDays)}.`}
            {sub.expiresAt ? ` Válido até ${new Date(sub.expiresAt).toLocaleDateString('pt-PT')}.` : ''}
          </p>
        </div>
        <span className="fx-badge ok"><span className="fx-dot ok" />Activa</span>
      </div>
      {pct != null ? (
        <div className="fx-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Tempo do plano já utilizado">
          <span style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      <div className="fx-actions">
        <button className="btn" onClick={onChange}><IconCard size={16} /> {isTrial ? 'Escolher um plano' : 'Trocar ou renovar plano'}</button>
      </div>
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
