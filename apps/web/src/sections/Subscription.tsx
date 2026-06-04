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

/** Subscrição & Plano (lado da empresa): escolher plano, pagar por IBAN,
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

  const active = subs.find((s) => s.status === 'ACTIVE');
  const pending = subs.find((s) => s.status === 'PENDING_PAYMENT' || s.status === 'IN_REVIEW');
  const current = active ?? pending ?? null;

  return (
    <>
      <div className="content-head"><h2>Subscrição &amp; Plano</h2></div>
      {error ? <div className="banner danger">{error}</div> : null}

      {loading ? <div className="card"><div className="loading">A carregar…</div></div>
        : active ? <ActiveCard sub={active} />
        : pending ? <PayAndChat sub={pending} banks={banks} onChanged={load} />
        : <CreateForm plans={plans} banks={banks} onCreated={load} />}

      {/* Histórico */}
      {subs.length > 0 ? (
        <div className="card">
          <h3>Histórico de subscrições</h3>
          {subs.map((s) => (
            <div className="list-row" key={s.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{s.plan?.name ?? 'Plano'} <span className="muted" style={{ fontWeight: 500 }}>· {kz(s.amountKz)}/{s.durationMonths}m</span></div>
                <div className="muted" style={{ fontSize: 12 }}>{new Date(s.createdAt).toLocaleDateString('pt-PT')} · {s.method === 'IBAN' ? 'Transferência' : 'Referência'}</div>
              </div>
              <span className="badge" style={{ color: STATUS_TONE[s.status], borderColor: 'currentColor' }}>{STATUS_LABEL[s.status]}</span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

function ActiveCard({ sub }: { sub: Sub }) {
  return (
    <div className="card" style={{ borderColor: 'var(--success)' }}>
      <div className="row" style={{ gap: 12 }}>
        <div className="kpi-ic" style={{ background: 'var(--success)', marginBottom: 0 }}><IconCheck size={20} /></div>
        <div>
          <h3 style={{ margin: 0 }}>{sub.plan?.name ?? 'Plano'} — Activa</h3>
          <div className="muted" style={{ fontSize: 13 }}>
            {kz(sub.amountKz)} / {sub.durationMonths} meses
            {sub.expiresAt ? ` · válida até ${new Date(sub.expiresAt).toLocaleDateString('pt-PT')}` : ''}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateForm({ plans, banks, onCreated }: { plans: PublicPlan[]; banks: BankAccount[]; onCreated(): void }) {
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

  return (
    <div className="card">
      <h3>Escolher plano</h3>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <div className="pgrid" style={{ marginBottom: 14 }}>
        {plans.map((p) => (
          <button key={p.id} className="pcard" onClick={() => setPlanId(p.id)}
            style={{ textAlign: 'left', padding: 14, borderColor: planId === p.id ? 'var(--primary)' : undefined, boxShadow: planId === p.id ? '0 0 0 3px var(--primary-soft)' : undefined }}>
            <div style={{ fontWeight: 800 }}>{p.name}</div>
            <div style={{ fontSize: 20, fontWeight: 900, margin: '4px 0' }}>{kz(p.priceKz)}<span className="muted" style={{ fontSize: 12, fontWeight: 500 }}> /{p.durationMonths}m</span></div>
            <div className="muted" style={{ fontSize: 12 }}>{p.maxStores} loja(s) · {p.maxUsers} util.</div>
          </button>
        ))}
      </div>
      <div className="grid-2">
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
      <button className="btn lg block" onClick={submit} disabled={busy || !planId}>
        {busy ? 'A subscrever…' : `Subscrever ${plan ? `(${kz(plan.priceKz)})` : ''}`}
      </button>
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
    <div className="card">
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
