import { confirmDialog, toast } from '../components/feedback';
import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { PaymentMethodInput, PaymentMethodType, PaymentProof, StorePaymentMethod } from '../api/types';
import { Modal } from '../components/ui';
import { IconCard, IconCheck, IconClose, IconEdit, IconPlus, IconTrash } from '../components/Icons';

const TYPE_LABEL: Record<PaymentMethodType, string> = {
  BANK_TRANSFER: 'Transferência bancária (IBAN)',
  REFERENCE: 'Pagamento por referência (Multicaixa)',
  MULTICAIXA_EXPRESS: 'Multicaixa Express',
  CASH: 'Numerário / na entrega',
};

function kz(v: string | number): string {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n.toLocaleString('pt-PT', { minimumFractionDigits: 2 }) + ' Kz' : '—';
}

export function Payments() {
  const [methods, setMethods] = useState<StorePaymentMethod[]>([]);
  const [proofs, setProofs] = useState<PaymentProof[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StorePaymentMethod | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, p] = await Promise.all([api.payments.listMethods(), api.payments.listProofs('PENDING')]);
      setMethods(m);
      setProofs(p);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar pagamentos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const review = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    try {
      await api.payments.reviewProof(id, status);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Falha ao rever.');
    }
  };

  const remove = async (m: StorePaymentMethod) => {
    if (!(await confirmDialog({ message: `Remover "${m.label}"?`, danger: true }))) return;
    try { await api.payments.deleteMethod(m.id); await load(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao remover.'); }
  };

  return (
    <>
      <div className="content-head">
        <h2>Pagamentos da loja</h2>
        <span className="spacer" />
        <button className="btn" onClick={() => setEditing('new')}><IconPlus size={16} /> Novo método</button>
      </div>
      {error ? <div className="banner danger">{error}</div> : null}

      {/* Comprovativos a aprovar */}
      {proofs.length > 0 ? (
        <div className="card">
          <h3>Comprovativos por aprovar ({proofs.length})</h3>
          {proofs.map((p) => (
            <div className="list-row" key={p.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{TYPE_LABEL[p.method_type as PaymentMethodType] ?? p.method_type}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {p.amount ? kz(p.amount) : ''}{p.reference ? ` · ref ${p.reference}` : ''} · {new Date(p.uploaded_at).toLocaleString('pt-PT')}
                </div>
              </div>
              <button className="btn sm success" onClick={() => review(p.id, 'APPROVED')}><IconCheck size={15} /> Aprovar</button>
              <button className="btn sm ghost" onClick={() => review(p.id, 'REJECTED')}><IconClose size={15} /> Rejeitar</button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Métodos de pagamento */}
      <div className="card">
        <h3>Métodos de pagamento</h3>
        {loading ? (
          <div className="loading">A carregar…</div>
        ) : methods.length === 0 ? (
          <div className="empty"><IconCard size={40} /><p>Nenhum método. Adicione IBAN, referência ou Express.</p></div>
        ) : methods.map((m) => (
          <div className="list-row" key={m.id}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>
                {m.label} <span className="muted" style={{ fontWeight: 500 }}>· {TYPE_LABEL[m.type] ?? m.type}</span>
                {!m.is_active ? <span className="muted"> · inactivo</span> : null}
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                {m.type === 'BANK_TRANSFER' ? `${m.bank_name ?? ''} · ${m.iban ?? ''}` : ''}
                {m.type === 'REFERENCE' ? `Entidade ${m.reference_entity ?? '—'}` : ''}
                {m.type === 'MULTICAIXA_EXPRESS' ? `Tel. ${m.express_phone ?? '—'}` : ''}
                {m.type === 'CASH' ? (m.instructions ?? 'Pagamento na entrega') : ''}
              </div>
            </div>
            <button className="btn sm ghost" onClick={() => setEditing(m)}><IconEdit size={15} /> Editar</button>
            <button className="icon-btn" style={{ width: 36, height: 36 }} onClick={() => remove(m)}><IconTrash size={16} /></button>
          </div>
        ))}
      </div>

      {editing ? (
        <MethodEditor
          method={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      ) : null}
    </>
  );
}

function MethodEditor({ method, onClose, onSaved }: { method: StorePaymentMethod | null; onClose(): void; onSaved(): void }) {
  const [type, setType] = useState<PaymentMethodType>(method?.type ?? 'BANK_TRANSFER');
  const [label, setLabel] = useState(method?.label ?? '');
  const [instructions, setInstructions] = useState(method?.instructions ?? '');
  const [bankName, setBankName] = useState(method?.bank_name ?? '');
  const [iban, setIban] = useState(method?.iban ?? '');
  const [accountHolder, setAccountHolder] = useState(method?.account_holder ?? '');
  const [referenceEntity, setReferenceEntity] = useState(method?.reference_entity ?? '');
  const [expressPhone, setExpressPhone] = useState(method?.express_phone ?? '');
  const [isActive, setIsActive] = useState(method?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    setSaving(true);
    try {
      const dto: PaymentMethodInput = {
        type,
        label: label.trim() || undefined,
        instructions: instructions.trim() || undefined,
        isActive,
      };
      if (type === 'BANK_TRANSFER') { dto.bankName = bankName.trim(); dto.iban = iban.trim().replace(/\s/g, ''); dto.accountHolder = accountHolder.trim(); }
      if (type === 'REFERENCE') { dto.referenceEntity = referenceEntity.trim(); }
      if (type === 'MULTICAIXA_EXPRESS') { dto.expressPhone = expressPhone.trim(); }
      if (method) await api.payments.updateMethod(method.id, dto);
      else await api.payments.createMethod(dto);
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível guardar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={method ? 'Editar método de pagamento' : 'Novo método de pagamento'} onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <div className="field">
        <label>Tipo</label>
        <select value={type} onChange={(e) => setType(e.target.value as PaymentMethodType)}>
          {(Object.keys(TYPE_LABEL) as PaymentMethodType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Rótulo (opcional)</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={TYPE_LABEL[type]} />
      </div>

      {type === 'BANK_TRANSFER' ? (
        <>
          <div className="field"><label>Banco</label><input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="ex.: BAI, BFA, BIC" list="bancos-loja" />
            <datalist id="bancos-loja">
              <option value="BAI" /><option value="BFA" /><option value="BIC" /><option value="Atlântico" /><option value="Standard Bank" /><option value="Banco Sol" /><option value="Banco Económico" />
            </datalist>
          </div>
          <div className="field"><label>IBAN (AO06 + 21 dígitos)</label><input className="mono" value={iban} onChange={(e) => setIban(e.target.value)} placeholder="AO06 0000 0000 0000 0000 0000 0" /></div>
          <div className="field"><label>Titular da conta</label><input value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)} /></div>
        </>
      ) : null}

      {type === 'REFERENCE' ? (
        <div className="field">
          <label>Entidade (5 dígitos, do contrato EMIS da loja)</label>
          <input className="mono" value={referenceEntity} onChange={(e) => setReferenceEntity(e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="01234" inputMode="numeric" />
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Com a entidade, o sistema gera a referência de cada encomenda automaticamente.</p>
        </div>
      ) : null}

      {type === 'MULTICAIXA_EXPRESS' ? (
        <div className="field"><label>Telemóvel Express</label><input value={expressPhone} onChange={(e) => setExpressPhone(e.target.value)} placeholder="9XX XXX XXX" inputMode="tel" /></div>
      ) : null}

      <div className="field"><label>Instruções (opcional)</label><textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Mensagem mostrada ao cliente" /></div>

      <div className="switch-row">
        <span>Activo</span>
        <label className="switch"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /><span className="tk" /><span className="th" /></label>
      </div>
      <button className="btn lg block" style={{ marginTop: 12 }} onClick={save} disabled={saving}>{saving ? 'A guardar…' : 'Guardar método'}</button>
    </Modal>
  );
}
