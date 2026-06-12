import React, { useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CheckoutResult, PaymentMethod } from '../api/types';
import { IconChevronLeft } from '../components/Icons';
import { formatKz } from '../format';
import { useStore } from '../state/StoreContext';
import { cartTotal } from '../store/cart';

// As 21 províncias de Angola (reforma da divisão político-administrativa de 2024:
// Cuando Cubango → Cuando + Cubango; novas Icolo e Bengo e Moxico Leste).
const PROVINCES = [
  'Bengo', 'Benguela', 'Bié', 'Cabinda', 'Cuando', 'Cuanza Norte', 'Cuanza Sul', 'Cubango',
  'Cunene', 'Huambo', 'Huíla', 'Icolo e Bengo', 'Luanda', 'Lunda Norte', 'Lunda Sul', 'Malanje',
  'Moxico', 'Moxico Leste', 'Namibe', 'Uíge', 'Zaire',
];

const PM_DESC: Record<string, string> = {
  BANK_TRANSFER: 'Transferência bancária — envia o comprovativo',
  REFERENCE: 'Pagamento por referência',
  MULTICAIXA_EXPRESS: 'Multicaixa Express',
  CASH: 'Numerário (na entrega/levantamento)',
};

// Numerário na entrega — opção SEMPRE disponível mesmo que a loja ainda não
// tenha configurado métodos eletrónicos, para o cliente nunca ficar "sem forma
// de pagamento" no checkout (era o sintoma reportado: só aparecia numerário na confirmação).
const CASH_FALLBACK: PaymentMethod = {
  id: '__cash__', type: 'CASH', label: 'Numerário', instructions: null,
  bank_name: null, iban: null, account_holder: null, reference_entity: null,
  reference_number: null, express_phone: null, is_active: true, sort_order: 99,
};

export function Checkout({
  onBack,
  onDone,
}: {
  onBack(): void;
  onDone(result: CheckoutResult, method: PaymentMethod | null): void;
}) {
  const { code, data, cart } = useStore();
  const configured = data?.paymentMethods ?? [];
  // Nunca deixar o cliente sem forma de pagamento: se a loja não configurou
  // métodos, oferecemos "Numerário" por omissão.
  const methods = configured.length > 0 ? configured : [CASH_FALLBACK];

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [nif, setNif] = useState('');
  const [province, setProvince] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [address, setAddress] = useState('');
  const [methodId, setMethodId] = useState<string>(() => methods[0]?.id ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(() => cartTotal(cart), [cart]);
  const selected = methods.find((m) => m.id === methodId) ?? null;

  const submit = async () => {
    setError(null);
    if (!name.trim() || !province.trim() || !municipality.trim() || !neighborhood.trim()) {
      setError('Preencha o nome e a localização (província, município e bairro).');
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.checkout(code, {
        customerName: name.trim(),
        customerPhone: phone.trim() || undefined,
        customerEmail: email.trim() || undefined,
        customerTaxId: nif.trim() || undefined,
        shippingAddress: address.trim() || undefined,
        province: province.trim(),
        municipality: municipality.trim(),
        neighborhood: neighborhood.trim(),
        paymentMethod: selected?.type,
        lines: cart.map((l) => ({ productCode: l.product.code, quantity: l.quantity })),
      });
      onDone(result, selected);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível concluir a encomenda.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <button className="back" onClick={onBack}>
        <IconChevronLeft size={18} /> Voltar à loja
      </button>
      <h1 style={{ margin: '0 0 18px', fontSize: 26, fontWeight: 900 }}>Finalizar compra</h1>

      {error ? <div className="banner danger" style={{ marginBottom: 16 }}>{error}</div> : null}

      <div className="card">
        <h3>Os seus dados</h3>
        <div className="field">
          <label>Nome completo *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="O seu nome" />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Telefone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9XX XXX XXX" inputMode="tel" />
          </div>
          <div className="field">
            <label>E-mail</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@email.ao" inputMode="email" />
          </div>
        </div>
        <div className="field">
          <label>NIF (opcional — para factura com contribuinte)</label>
          <input value={nif} onChange={(e) => setNif(e.target.value)} placeholder="NIF" />
        </div>
      </div>

      <div className="card">
        <h3>Entrega</h3>
        <div className="grid-2">
          <div className="field">
            <label>Província *</label>
            <input list="provinces" value={province} onChange={(e) => setProvince(e.target.value)} placeholder="Luanda" />
            <datalist id="provinces">
              {PROVINCES.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label>Município *</label>
            <input value={municipality} onChange={(e) => setMunicipality(e.target.value)} placeholder="Belas" />
          </div>
        </div>
        <div className="field">
          <label>Bairro *</label>
          <input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Talatona" />
        </div>
        <div className="field">
          <label>Morada (opcional)</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, nº, referência" />
        </div>
      </div>

      {methods.length > 0 ? (
        <div className="card">
          <h3>Forma de pagamento</h3>
          {methods.map((m) => (
            <div
              key={m.id}
              className={`pay-opt${methodId === m.id ? ' active' : ''}`}
              onClick={() => setMethodId(m.id)}
            >
              <div className="radio" />
              <div>
                <div className="lbl">{m.label}</div>
                <div className="ds">{PM_DESC[m.type] ?? m.type}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="card">
        <div className="kv">
          <span className="k">Total a pagar</span>
          <span className="v" style={{ fontSize: 22, fontWeight: 900 }}>{formatKz(total)}</span>
        </div>
        <button className="btn lg block" onClick={submit} disabled={submitting || cart.length === 0}>
          {submitting ? 'A processar…' : 'Confirmar encomenda'}
        </button>
      </div>
    </div>
  );
}
