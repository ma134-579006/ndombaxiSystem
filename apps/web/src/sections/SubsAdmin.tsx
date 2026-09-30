import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { BankAccount, SubMessage, Subscription, SubStatus } from '../api/types';
import { Modal } from '../components/ui';
import { IconCheck, IconClose, IconPlus } from '../components/Icons';

function kz(n: number): string { return n.toLocaleString('pt-PT') + ' Kz'; }
/** Duração legível de uma subscrição (trial / meses+dias). */
function durLabel(s: { durationMonths: number; durationDays?: number; isTrial?: boolean }): string {
  if (s.isTrial) return 'teste grátis';
  const parts: string[] = [];
  if (s.durationMonths) parts.push(`${s.durationMonths}m`);
  if (s.durationDays) parts.push(`${s.durationDays}d`);
  return parts.join(' ') || '1m';
}
/** Constrói o src do comprovativo: se já vier como data URI completo usa-o tal
 *  e qual; senão prefixa o data:...;base64,. Evita o prefixo duplicado. */
function proofSrc(data: string, fileType: string | undefined, fallback: string): string {
  const d = (data || '').trim();
  if (d.startsWith('data:')) return d;
  return `data:${fileType || fallback};base64,${d}`;
}

const STATUS_LABEL: Record<SubStatus, string> = {
  PENDING_PAYMENT: 'Aguarda pagamento',
  IN_REVIEW: 'Comprovativo p/ rever',
  ACTIVE: 'Activa',
  REJECTED: 'Rejeitada',
  EXPIRED: 'Expirada',
};
const STATUS_TONE: Record<SubStatus, string> = {
  PENDING_PAYMENT: 'var(--warning)',
  IN_REVIEW: 'var(--primary)',
  ACTIVE: 'var(--success)',
  REJECTED: 'var(--danger)',
  EXPIRED: 'var(--muted)',
};

type SubTab = 'ALL' | 'IN_REVIEW' | 'PENDING_PAYMENT' | 'LIVE' | 'EXPIRED' | 'REJECTED';
const TABS: { key: SubTab; label: string }[] = [
  { key: 'ALL', label: 'Todas' },
  { key: 'IN_REVIEW', label: 'Para rever' },
  { key: 'PENDING_PAYMENT', label: 'Por pagar' },
  { key: 'LIVE', label: 'Em vigor' },
  { key: 'EXPIRED', label: 'Expiradas' },
  { key: 'REJECTED', label: 'Rejeitadas' },
];

/** Estado efectivo: uma subscrição ACTIVE cuja validade já passou está EXPIRADA. */
function effStatus(s: Subscription): SubStatus {
  if (s.status === 'ACTIVE' && s.expiresAt && new Date(s.expiresAt).getTime() < Date.now()) return 'EXPIRED';
  return s.status;
}
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('pt-PT') : '—');

export function SubsAdmin() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Subscription | null>(null);
  const [showBank, setShowBank] = useState(false);
  const [tab, setTab] = useState<SubTab>('ALL');
  const [q, setQ] = useState('');
  const [withTrials, setWithTrials] = useState(false);
  const [limit, setLimit] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, b] = await Promise.all([api.subsAdmin.list(), api.subsAdmin.banksAll()]);
      setSubs(s);
      setBanks(b);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const paid = subs.filter((s) => !s.isTrial && s.amountKz > 0);
  const count = (st: SubStatus) => subs.filter((s) => effStatus(s) === st).length;
  const live = count('ACTIVE');
  const filtered = subs.filter((s) => {
    const st = effStatus(s);
    if (!withTrials && (s.isTrial || s.amountKz === 0) && tab === 'ALL') return false;
    if (tab === 'LIVE' && st !== 'ACTIVE') return false;
    if (tab !== 'ALL' && tab !== 'LIVE' && st !== tab) return false;
    const needle = q.trim().toLowerCase();
    if (needle && !`${s.company?.name ?? ''} ${s.plan?.name ?? ''}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  const shown = filtered.slice(0, limit);

  return (
    <div className="fx-wide">
      <div className="content-head">
        <h2>Subscrições & Pagamentos</h2>
        <span className="spacer" />
        <button className="btn" onClick={() => setShowBank(true)}><IconPlus size={16} /> Conta bancária</button>
      </div>
      {error ? <div className="banner danger">{error}</div> : null}

      <div className="fx-stats">
        <div className="fx-stat"><span className="ic"><IconCheck size={20} /></span><div><div className="lb">Em vigor</div><div className="vl"><span className="fx-dot ok" />{live}</div><div className="sb">subscrições activas e válidas</div></div></div>
        <div className="fx-stat"><span className="ic"><IconCheck size={20} /></span><div><div className="lb">Para rever</div><div className="vl"><span className="fx-dot" />{count('IN_REVIEW')}</div><div className="sb">comprovativos submetidos</div></div></div>
        <div className="fx-stat"><span className="ic"><IconCheck size={20} /></span><div><div className="lb">Por pagar</div><div className="vl"><span className="fx-dot" />{count('PENDING_PAYMENT')}</div><div className="sb">à espera de pagamento</div></div></div>
        <div className="fx-stat"><span className="ic"><IconCheck size={20} /></span><div><div className="lb">Expiradas</div><div className="vl"><span className="fx-dot bad" />{count('EXPIRED')}</div><div className="sb">{paid.length} pagas no total</div></div></div>
      </div>

      <div className="fx-card">
        <div className="fx-card-h">
          <div><h3>Contas bancárias da plataforma</h3><p>IBAN para onde as empresas transferem o valor das subscrições.</p></div>
        </div>
        {banks.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Sem contas. Adicione uma para receber transferências.</p>
        ) : banks.map((b) => (
          <div className="co-row" key={b.id} style={{ padding: '10px 4px' }}>
            <div className="co-main">
              <div className="co-name">{b.bankName} <span className="co-code">{b.accountHolder}</span></div>
              <div className="mono muted" style={{ marginTop: 2 }}>{b.iban}</div>
            </div>
            <span className={`fx-badge ${b.isActive ? 'ok' : 'off'}`}><span className={`fx-dot ${b.isActive ? 'ok' : ''}`} />{b.isActive ? 'Activa' : 'Inactiva'}</span>
          </div>
        ))}
      </div>

      <div className="fx-toolbar">
        <div className="fx-tabs" role="tablist" aria-label="Filtrar subscrições">
          {TABS.map((x) => (
            <button key={x.key} role="tab" aria-selected={tab === x.key} className={tab === x.key ? 'on' : ''} onClick={() => { setTab(x.key); setLimit(30); }}>{x.label}</button>
          ))}
        </div>
        <label className="fx-search">
          <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(30); }} placeholder="Procurar empresa ou plano…" aria-label="Procurar subscrições" />
        </label>
      </div>
      <label className="row" style={{ gap: 8, fontSize: 13, margin: '0 0 12px', color: 'var(--muted)' }}>
        <input type="checkbox" checked={withTrials} onChange={(e) => setWithTrials(e.target.checked)} /> Incluir testes grátis e planos a 0 Kz na vista "Todas"
      </label>

      <div className="fx-card" style={{ padding: 8 }}>
        {loading ? <div className="loading">A carregar…</div> : filtered.length === 0 ? (
          <div className="empty"><p>Sem subscrições neste filtro.</p></div>
        ) : shown.map((s) => {
          const st = effStatus(s);
          return (
            <div className="co-row" key={s.id} style={{ cursor: 'pointer' }} onClick={async () => setDetail(await api.subsAdmin.get(s.id))}>
              <span className="co-av" aria-hidden="true">{(s.company?.name ?? '?').slice(0, 2).toUpperCase()}</span>
              <div className="co-main">
                <div className="co-name">{s.company?.name ?? '—'} <span className="co-code">{s.plan?.name}</span></div>
                <div className="co-meta">
                  <span className="co-plan">{s.amountKz > 0 ? kz(s.amountKz) : 'Sem custo'} / {durLabel(s)}</span>
                  <span>{s.method === 'IBAN' ? 'Transferência' : 'Referência'}</span>
                  {s.startsAt ? <span>{fmtDate(s.startsAt)} → {fmtDate(s.expiresAt)}</span> : <span>criada em {fmtDate(s.createdAt)}</span>}
                </div>
              </div>
              <span className="badge" style={{ color: STATUS_TONE[st], borderColor: STATUS_TONE[st] }}>
                <span className="dot" /> {STATUS_LABEL[st]}
              </span>
            </div>
          );
        })}
        {filtered.length > shown.length ? (
          <div style={{ textAlign: 'center', padding: 12 }}>
            <button className="btn ghost" onClick={() => setLimit((n) => n + 30)}>Mostrar mais ({filtered.length - shown.length})</button>
          </div>
        ) : null}
      </div>

      {detail ? (
        <SubDetail sub={detail} onClose={() => setDetail(null)} onChanged={() => { setDetail(null); void load(); }} />
      ) : null}
      {showBank ? <BankModal onClose={() => setShowBank(false)} onSaved={() => { setShowBank(false); void load(); }} /> : null}
    </div>
  );
}

// ── Detalhe da subscrição (rever comprovativo + chat) ───────
function SubDetail({ sub, onClose, onChanged }: { sub: Subscription; onClose(): void; onChanged(): void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<SubMessage[]>(sub.messages ?? []);
  const [text, setText] = useState('');

  const review = async (decision: 'APPROVE' | 'REJECT') => {
    setBusy(true); setErr(null);
    try {
      await api.subsAdmin.review(sub.id, decision);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Falha.');
      setBusy(false);
    }
  };

  const send = async () => {
    if (!text.trim()) return;
    const m = await api.subsAdmin.send(sub.id, text.trim());
    setMsgs((prev) => [...prev, m]);
    setText('');
  };

  return (
    <Modal title={`${sub.company?.name ?? 'Subscrição'} — ${sub.plan?.name ?? ''}`} onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <div className="kv"><span className="k">Valor</span><span className="v">{kz(sub.amountKz)} / {durLabel(sub)}</span></div>
      <div className="kv"><span className="k">Método</span><span className="v">{sub.method === 'IBAN' ? 'Transferência (IBAN)' : 'Referência Multicaixa'}</span></div>
      <div className="kv"><span className="k">Estado</span><span className="v">{STATUS_LABEL[sub.status]}</span></div>
      {sub.reference ? <div className="kv"><span className="k">Referência</span><span className="v mono">{sub.reference}</span></div> : null}

      {/* Comprovativos (imagem) */}
      {sub.payments && sub.payments.length > 0 ? (
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 10 }}>
          <strong style={{ fontSize: 14 }}>Comprovativo(s) de pagamento</strong>
          {sub.payments.map((p) => (
            <div key={p.id} style={{ marginTop: 8 }}>
              <div className="kv"><span className="k">{p.fileName}</span><span className="v">{p.amountKz ? kz(p.amountKz) : ''}</span></div>
              {p.fileData ? (
                (p.fileType ?? '').startsWith('image') || /\.(png|jpe?g|webp|gif)$/i.test(p.fileName) ? (
                  <a href={proofSrc(p.fileData, p.fileType, 'image/jpeg')} target="_blank" rel="noreferrer">
                    <img
                      src={proofSrc(p.fileData, p.fileType, 'image/jpeg')}
                      alt={p.fileName}
                      style={{ width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-2)', marginTop: 4 }}
                    />
                  </a>
                ) : (
                  <a className="btn sm ghost" href={proofSrc(p.fileData, p.fileType, 'application/octet-stream')} download={p.fileName} style={{ marginTop: 4 }}>
                    Abrir comprovativo
                  </a>
                )
              ) : null}
              {p.note ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{p.note}</div> : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* Ações de aprovação */}
      {(sub.status === 'IN_REVIEW' || sub.status === 'PENDING_PAYMENT') ? (
        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <button className="btn success" disabled={busy} onClick={() => review('APPROVE')}><IconCheck size={16} /> Aprovar e activar</button>
          <button className="btn ghost" disabled={busy} onClick={() => review('REJECT')}><IconClose size={16} /> Rejeitar</button>
        </div>
      ) : null}

      {/* Chat */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 10 }}>
        <strong style={{ fontSize: 14 }}>Conversa com a empresa</strong>
        <div style={{ maxHeight: 180, overflow: 'auto', margin: '10px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {msgs.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>Sem mensagens.</p> : msgs.map((m) => (
            <div key={m.id} style={{ alignSelf: m.sender === 'ADMIN' ? 'flex-end' : 'flex-start', maxWidth: '80%', background: m.sender === 'ADMIN' ? 'var(--primary)' : 'var(--surface-2)', color: m.sender === 'ADMIN' ? '#fff' : 'var(--text)', padding: '8px 12px', borderRadius: 12, fontSize: 14 }}>
              {m.body}
            </div>
          ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', color: 'var(--text)' }}
            value={text} onChange={(e) => setText(e.target.value)} placeholder="Escrever…" onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} />
          <button className="btn" onClick={send}>Enviar</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Modal adicionar conta bancária ──────────────────────────
function BankModal({ onClose, onSaved }: { onClose(): void; onSaved(): void }) {
  const [bankName, setBankName] = useState('');
  const [accountHolder, setAccountHolder] = useState('');
  const [iban, setIban] = useState('AO06');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    if (!bankName.trim() || !accountHolder.trim() || !iban.trim()) { setErr('Preencha todos os campos.'); return; }
    setSaving(true);
    try {
      await api.subsAdmin.createBank({ bankName: bankName.trim(), accountHolder: accountHolder.trim(), iban: iban.trim().replace(/\s/g, ''), isActive: true, sortOrder: 0 });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Falha ao guardar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Adicionar conta bancária" onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <div className="field">
        <label>Banco</label>
        <input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="ex.: BAI, BFA, BIC, Atlântico" list="bancos" />
        <datalist id="bancos">
          <option value="Banco Angolano de Investimentos (BAI)" />
          <option value="Banco de Fomento Angola (BFA)" />
          <option value="Banco BIC" />
          <option value="Banco Millennium Atlântico" />
          <option value="Standard Bank Angola" />
          <option value="Banco Económico" />
          <option value="Banco Sol" />
          <option value="Banco Caixa Geral Angola" />
        </datalist>
      </div>
      <div className="field">
        <label>Titular da conta</label>
        <input value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)} placeholder="LPS Vendas, Lda" />
      </div>
      <div className="field">
        <label>IBAN (AO06 + 21 dígitos)</label>
        <input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="AO06 0000 0000 0000 0000 0000 0" className="mono" />
      </div>
      <button className="btn lg block" style={{ marginTop: 12 }} onClick={save} disabled={saving}>
        {saving ? 'A guardar…' : 'Guardar conta'}
      </button>
    </Modal>
  );
}
