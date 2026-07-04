import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CheckoutResult, PaymentMethod } from '../api/types';
import { IconChevronLeft } from '../components/Icons';
import { formatKz } from '../format';
import { useStore } from '../state/StoreContext';
import { cartTotal } from '../store/cart';
import { useCustomer } from '../store/customer';
import { getHighAccuracyPosition, GeoError } from '../store/geo';

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
  // Forma de pagamento OBRIGATÓRIA: começa sem seleção — o cliente tem de
  // escolher (IBAN/transferência, Multicaixa Express, Referência ou Numerário).
  const [methodId, setMethodId] = useState<string>('');
  useEffect(() => { if (methods.length === 1 && !methodId) setMethodId(methods[0].id); }, [methods, methodId]);
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(true); // mostra/esconde o formulário de dados

  const session = useCustomer(code);

  // Cliente com sessão: traz o PERFIL guardado no registo e pré-preenche tudo —
  // assim não precisa de reintroduzir nome, telefone, bairro, etc.
  useEffect(() => {
    if (!session?.token) return;
    setEmail((v) => v || session.customer.email);
    setName((v) => v || session.customer.name);
    let alive = true;
    void api.myProfile(code, session.token).then((p) => {
      if (!alive || !p) return;
      if (p.name) setName(p.name);
      if (p.email) setEmail(p.email);
      if (p.phone) setPhone(p.phone);
      if (p.taxId) setNif(p.taxId);
      if (p.province) setProvince(p.province);
      if (p.municipality) setMunicipality(p.municipality);
      if (p.neighborhood) setNeighborhood(p.neighborhood);
      if (p.address) setAddress(p.address);
      // perfil completo → colapsa o formulário (só confirmar e pagar)
      if (p.name && p.province && p.municipality && p.neighborhood) setEditing(false);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [code, session?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = useMemo(() => cartTotal(cart), [cart]);
  const selected = methods.find((m) => m.id === methodId) ?? null;

  const submit = async () => {
    setError(null);
    if (!name.trim() || !province.trim() || !municipality.trim() || !neighborhood.trim()) {
      setError('Preencha o nome e a localização (província, município e bairro).');
      return;
    }
    if (!selected) {
      setError('Escolha a forma de pagamento (IBAN/transferência, Multicaixa Express, Referência ou Numerário).');
      return;
    }

    // GPS OBRIGATÓRIO para a entrega: pedimos a localização ANTES de criar a
    // encomenda. Se o cliente recusar/falhar, a encomenda NÃO é criada (cancelada).
    setError(null);
    setLocating(true);
    let fix;
    try {
      fix = await getHighAccuracyPosition();
    } catch (e) {
      setLocating(false);
      setError(e instanceof GeoError ? e.message : 'É obrigatório partilhar a localização GPS para concluir a encomenda.');
      return;
    }
    setLocating(false);

    setSubmitting(true);
    const base = {
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
    };
    try {
      let result;
      try {
        // Tenta COM o GPS (API atual).
        result = await api.checkout(code, { ...base, geoLat: fix.lat, geoLng: fix.lng, geoAccuracy: fix.accuracy, geoConsent: true });
      } catch (e) {
        // Resiliência: se a API ainda não conhecer os campos GPS, conclui a
        // encomenda à mesma (não perde a venda). O GPS passa a ser guardado
        // automaticamente assim que a API for atualizada.
        const msg = e instanceof ApiError ? e.message : '';
        if (/geo(lat|lng|accuracy|consent)|should not exist/i.test(msg)) {
          result = await api.checkout(code, base);
        } else {
          throw e;
        }
      }
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

      {!editing ? (
        <div className="card">
          <div className="kv" style={{ alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ margin: '0 0 6px' }}>Entrega para {name}</h3>
              <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
                {[neighborhood, municipality, province].filter(Boolean).join(', ')}
                {address ? <><br />{address}</> : null}
                {phone ? <><br />📞 {phone}</> : null}
                {email ? <><br />✉️ {email}</> : null}
              </div>
            </div>
            <button className="btn ghost" onClick={() => setEditing(true)}>Editar</button>
          </div>
          <div className="banner success" style={{ marginTop: 12, fontSize: 13 }}>
            <div>✅ Dados do teu registo — não precisas de os reintroduzir. Confirma e paga.</div>
          </div>
        </div>
      ) : (
      <>
      <div className="card">
        <h3>Os seus dados</h3>
        {session ? <div className="banner info" style={{ marginBottom: 12, fontSize: 13 }}><div>Os dados ficam guardados na tua conta para as próximas compras.</div></div> : null}
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
            <input list="provinces" value={province} onChange={(e) => setProvince(e.target.value)} placeholder="ex.: Luanda" />
            <datalist id="provinces">
              {PROVINCES.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label>Município *</label>
            <input value={municipality} onChange={(e) => setMunicipality(e.target.value)} placeholder="ex.: Belas" />
          </div>
        </div>
        <div className="field">
          <label>Bairro *</label>
          <input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="ex.: Talatona" />
        </div>
        <div className="field">
          <label>Morada (opcional)</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, nº, referência" />
        </div>
      </div>
      </>
      )}

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
        <div className="banner info" style={{ margin: '12px 0', fontSize: 13 }}>
          <div>📍 <strong>Localização GPS obrigatória</strong> — ao confirmar, o telemóvel vai pedir acesso à sua localização para a loja entregar no sítio certo. Sem permissão, a encomenda não é criada.</div>
        </div>
        <button className="btn lg block" onClick={submit} disabled={submitting || locating || cart.length === 0}>
          {locating ? '📍 A obter localização GPS…' : submitting ? 'A processar…' : 'Confirmar encomenda'}
        </button>
      </div>
    </div>
  );
}
