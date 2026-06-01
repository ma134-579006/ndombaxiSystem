import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { BankAccount, SubMessage, Subscription, SubStatus } from '../api/types';
import { Modal } from '../components/ui';
import { IconCheck, IconClose, IconPlus } from '../components/Icons';

function kz(n: number): string { return n.toLocaleString('pt-PT') + ' Kz'; }

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

export function SubsAdmin() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Subscription | null>(null);
  const [showBank, setShowBank] = useState(false);

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

  return (
    <>
      <div className="content-head">
        <h2>Subscrições & Pagamentos</h2>
        <span className="spacer" />
        <button className="btn" onClick={() => setShowBank(true)}><IconPlus size={16} /> Conta bancária</button>
      </div>
      {error ? <div className="banner danger">{error}</div> : null}

      {/* CONTAS BANCÁRIAS */}
      <div className="card">
        <h3>Contas bancárias da plataforma (IBAN)</h3>
        {banks.length === 0 ? (
          <p className="muted">Sem contas. Adicione uma para receber transferências.</p>
        ) : banks.map((b) => (
          <div className="list-row" key={b.id}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{b.bankName} <span className="muted" style={{ fontWeight: 500 }}>· {b.accountHolder}</span></div>
              <div className="muted mono" style={{ fontSize: 13 }}>{b.iban}</div>
            </div>
            <span className="badge" style={{ color: b.isActive ? 'var(--success)' : 'var(--muted)', borderColor: 'currentColor' }}>
              {b.isActive ? 'Activa' : 'Inactiva'}
            </span>
          </div>
        ))}
      </div>

      {/* SUBSCRIÇÕES */}
      <div className="card">
        <h3>Subscrições</h3>
        {loading ? <div className="loading">A carregar…</div> : subs.length === 0 ? (
          <p className="muted">Ainda não há subscrições.</p>
        ) : subs.map((s) => (
          <div className="list-row" key={s.id} style={{ cursor: 'pointer' }} onClick={async () => setDetail(await api.subsAdmin.get(s.id))}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{s.company?.name ?? '—'} <span className="muted" style={{ fontWeight: 500 }}>· {s.plan?.name}</span></div>
              <div className="muted" style={{ fontSize: 13 }}>{kz(s.amountKz)} / {s.durationMonths}m · {s.method}</div>
            </div>
            <span className="badge" style={{ color: STATUS_TONE[s.status], borderColor: STATUS_TONE[s.status] }}>
              <span className="dot" /> {STATUS_LABEL[s.status]}
            </span>
          </div>
        ))}
      </div>

      {detail ? (
        <SubDetail sub={detail} onClose={() => setDetail(null)} onChanged={() => { setDetail(null); void load(); }} />
      ) : null}
      {showBank ? <BankModal onClose={() => setShowBank(false)} onSaved={() => { setShowBank(false); void load(); }} /> : null}
    </>
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
      <div className="kv"><span className="k">Valor</span><span className="v">{kz(sub.amountKz)} / {sub.durationMonths} meses</span></div>
      <div className="kv"><span className="k">Método</span><span className="v">{sub.method === 'IBAN' ? 'Transferência (IBAN)' : 'Referência Multicaixa'}</span></div>
      <div className="kv"><span className="k">Estado</span><span className="v">{STATUS_LABEL[sub.status]}</span></div>
      {sub.reference ? <div className="kv"><span className="k">Referência</span><span className="v mono">{sub.reference}</span></div> : null}

      {/* Comprovativos */}
      {sub.payments && sub.payments.length > 0 ? (
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 10 }}>
          <strong style={{ fontSize: 14 }}>Comprovativos</strong>
          {sub.payments.map((p) => (
            <div className="kv" key={p.id}><span className="k">{p.fileName}</span><span className="v">{p.amountKz ? kz(p.amountKz) : ''}</span></div>
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
        <input value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)} placeholder="Ndombaxi System, Lda" />
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
