import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CheckoutResult, PaymentMethod } from '../api/types';
import { formatKz, methodLabel } from '../format';
import { useStore } from '../state/StoreContext';
import { cartTotal } from '../store/cart';
import { useCustomer, shownEmail } from '../store/customer';
import { getHighAccuracyPosition, GeoError } from '../store/geo';

/** Numerário: sempre disponível, para o cliente nunca ficar sem forma de pagar. */
const CASH_FALLBACK: PaymentMethod = {
  id: '__cash__', type: 'CASH', label: 'Numerário', instructions: null,
  bank_name: null, iban: null, account_holder: null, reference_entity: null,
  reference_number: null, express_phone: null, is_active: true, sort_order: 99,
};

/**
 * "Finalizar encomenda" no modelo das lojas online de faturação:
 *   [Método de entrega + Método de pagamento] [Dados pessoais] [Resumo + FINALIZAR]
 * Sem conta obrigatória (a API aceita convidado). Nome e telemóvel obrigatórios.
 * GPS OBRIGATÓRIO em todas as encomendas (entrega e levantamento).
 */
export function GoCheckout({ onBack, onDone }: {
  onBack(): void;
  onDone(result: CheckoutResult, method: PaymentMethod | null): void;
}) {
  const { code, data, cart } = useStore();
  const session = useCustomer(code);
  const configured = data?.paymentMethods ?? [];
  const methods = configured.length > 0 ? configured : [CASH_FALLBACK];
  const [delivery, setDelivery] = useState<'PICKUP' | 'DELIVERY' | ''>('');
  const [methodId, setMethodId] = useState('');
  const [name, setName] = useState('');
  const [nif, setNif] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState<'' | 'gps' | 'send'>('');
  const [error, setError] = useState<string | null>(null);
  const total = useMemo(() => cartTotal(cart), [cart]);
  const selected = methods.find((m) => m.id === methodId) ?? null;

  useEffect(() => { if (methods.length === 1 && !methodId) setMethodId(methods[0].id); }, [methods, methodId]);
  // Com sessão, pré-preenche com o perfil guardado.
  useEffect(() => {
    if (!session?.token) return;
    setEmail((v) => v || shownEmail(session.customer.email));
    setName((v) => v || (session.customer.name === 'Cliente' ? '' : session.customer.name));
    let alive = true;
    void api.myProfile(code, session.token).then((p) => {
      if (!alive || !p) return;
      if (p.name && p.name !== 'Cliente') setName(p.name);
      if (p.phone) setPhone(p.phone);
      if (p.taxId) setNif(p.taxId);
      if (p.address) setAddress(p.address);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [code, session?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setError(null);
    if (!delivery) return setError('Escolha o método de entrega.');
    if (!selected) return setError('Escolha o método de pagamento.');
    if (name.trim().length < 2) return setError('Indique o nome.');
    if (phone.replace(/\D/g, '').length < 9) return setError('Indique um número de telemóvel válido.');
    if (delivery === 'DELIVERY' && address.trim().length < 4) return setError('Indique a morada de entrega.');
    // GPS OBRIGATÓRIO em todas as encomendas (regra da loja): sem localização a
    // encomenda não é criada — também ao levantar na loja.
    let geo: { geoLat?: number; geoLng?: number; geoAccuracy?: number; geoConsent?: boolean };
    setBusy('gps');
    try {
      const fix = await getHighAccuracyPosition();
      geo = { geoLat: fix.lat, geoLng: fix.lng, geoAccuracy: fix.accuracy, geoConsent: true };
    } catch (e) {
      setBusy('');
      return setError(e instanceof GeoError ? e.message : 'É obrigatório partilhar a localização GPS para concluir a encomenda.');
    }
    setBusy('send');
    try {
      const result = await api.checkout(code, {
        customerName: name.trim(), customerPhone: phone.trim(),
        customerEmail: email.trim() || session?.customer.email || undefined,
        customerTaxId: nif.trim() || undefined,
        shippingAddress: delivery === 'DELIVERY' ? address.trim() : undefined,
        deliveryMethod: delivery, notes: notes.trim() || undefined,
        paymentMethod: selected.type, ...geo,
        lines: cart.map((l) => ({ productCode: l.product.code, quantity: l.quantity })),
      }, session?.token);
      onDone(result, selected);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível concluir a encomenda.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="wrap go-co">
      <h2 className="go-co-h">Finalizar Encomenda</h2>
      <p className="go-co-sub">Preencha os seguintes dados para receber a encomenda</p>
      {error ? <div className="banner danger" style={{ marginBottom: 14 }}>{error}</div> : null}
      <div className="go-co-grid">
        <div className="go-co-col">
          <section className="go-box">
            <header>Método de Entrega</header>
            <label className="go-radio"><input type="radio" name="dm" checked={delivery === 'PICKUP'} onChange={() => setDelivery('PICKUP')} /> Levantar na loja</label>
            <label className="go-radio"><input type="radio" name="dm" checked={delivery === 'DELIVERY'} onChange={() => setDelivery('DELIVERY')} /> Entrega numa morada</label>
          </section>
          <section className="go-box">
            <header>Método de Pagamento</header>
            {methods.map((m) => (
              <label className="go-radio" key={m.id}><input type="radio" name="pm" checked={methodId === m.id} onChange={() => setMethodId(m.id)} /> {methodLabel(m)}</label>
            ))}
          </section>
        </div>

        <section className="go-box go-co-data">
          <header>Dados Pessoais</header>
          <div className="go-fields">
            <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Primeiro e último" autoComplete="name" /></label>
            <label>NIF<input value={nif} onChange={(e) => setNif(e.target.value)} placeholder="NIF para faturação" /></label>
            <label>Telemóvel<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9XX XXX XXX" inputMode="tel" autoComplete="tel" /></label>
            <label>E-Mail<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-Mail" inputMode="email" autoComplete="email" /></label>
            {delivery === 'DELIVERY' ? (
              <label className="full">Morada de entrega<input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, nº, bairro, município" autoComplete="street-address" /></label>
            ) : null}
            <label className="full">Observações<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={500} /></label>
          </div>
        </section>

        <div className="go-co-col">
          <section className="go-box">
            <header>Resumo da Encomenda</header>
            <ul className="go-sum">
              {cart.map((l) => (
                <li key={l.product.code}><b>{l.product.name}</b><span>{l.quantity} x {formatKz(l.product.grossPrice)}</span></li>
              ))}
            </ul>
            <div className="go-sum-total"><span>Total</span><strong>{formatKz(total)}</strong></div>
          </section>
          <p className="go-co-gps">Ao finalizar, o telemóvel pede a localização GPS — é obrigatória para concluir a encomenda.</p>
          <button className="go-btn go-co-btn" onClick={() => void submit()} disabled={!!busy || cart.length === 0}>
            {busy === 'gps' ? 'A obter localização…' : busy === 'send' ? 'A processar…' : 'Finalizar'}
          </button>
          <button className="go-btn ghost go-co-btn" onClick={onBack}>Continuar a comprar</button>
        </div>
      </div>
    </div>
  );
}
