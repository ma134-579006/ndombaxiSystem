import React, { useMemo, useState } from 'react';
import type { PaymentType } from '../api/types';
import { formatKz, parseKz } from '../format';
import { IconClose } from './Icons';
import { KeyboardInput } from '../keyboard/KeyboardInput';
import { UiIcon } from './UiIcon';

interface Props {
  total: number;
  /** Nome do cliente selecionado (obrigatório para venda a crédito). */
  customerName?: string | null;
  onConfirm(p: { paymentType: PaymentType; tendered?: number; changeGiven?: number }): void;
  onClose(): void;
  busy?: boolean;
}

const METHODS: { type: PaymentType; label: string; icon: string }[] = [
  { type: 'CASH', label: 'Numerário', icon: 'money' },
  { type: 'CARD', label: 'Multicaixa (TPA)', icon: 'card' },
  { type: 'TRANSFER', label: 'Transferência', icon: 'building' },
  { type: 'REFERENCE', label: 'Referência', icon: 'receipt' },
  { type: 'EXPRESS', label: 'Express', icon: 'phone' },
  { type: 'CREDIT', label: 'A crédito (fiado)', icon: 'clock' },
];

/** Selecção do método + (numerário) dinheiro entregue → troco automático. */
export function PaymentModal({ total, customerName, onConfirm, onClose, busy }: Props) {
  const [type, setType] = useState<PaymentType>('CASH');
  const [tendered, setTendered] = useState('');

  const tenderedNum = parseKz(tendered) || 0;
  const change = useMemo(() => Math.max(0, tenderedNum - total), [tenderedNum, total]);
  const insufficient = type === 'CASH' && tendered !== '' && tenderedNum < total;
  const creditNoCustomer = type === 'CREDIT' && !customerName;

  // Atalhos de notas Kwanza comuns.
  // Atalhos úteis: o valor exato e as próximas notas/valores redondos ACIMA do total
  // (antes mostrava 1.000/2.000 para uma conta de 10.413).
  const quick = (() => {
    const out = [total];
    for (const step of [500, 1000, 2000, 5000, 10000, 20000, 50000]) {
      const v = Math.ceil(total / step) * step;
      if (v > total && !out.includes(v)) out.push(v);
      if (out.length >= 5) break;
    }
    return out;
  })();

  const confirm = () => {
    // GUARDA: o botão fica desativado quando insuficiente/sem cliente, mas o Enter
    // do teclado (onSubmit) chamava confirm() diretamente, contornando-o e emitindo
    // a fatura com pagamento a menos (furo de caixa). Bloqueia também aqui.
    if (busy || insufficient || creditNoCustomer) return;
    if (type === 'CASH') {
      onConfirm({ paymentType: 'CASH', tendered: tenderedNum || total, changeGiven: change });
    } else {
      onConfirm({ paymentType: type });
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, padding: 22 }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Pagamento</h2>
          <span className="spacer" />
          <button className="trash" onClick={onClose}><IconClose size={22} /></button>
        </div>

        <div className="totals" style={{ marginBottom: 14 }}>
          <div className="t-row grand"><span>Total a pagar</span><span>{formatKz(total)}</span></div>
        </div>

        <div className="pay-methods">
          {METHODS.map((m) => (
            <button key={m.type} className={`pay-method${type === m.type ? ' on' : ''}`} onClick={() => setType(m.type)} aria-pressed={type === m.type}>
              <UiIcon e={m.icon} size={20} className="pay-ic" />
              <span>{m.label}</span>
            </button>
          ))}
        </div>

        {type === 'CASH' ? (
          <div style={{ marginTop: 14 }}>
            <KeyboardInput label="Dinheiro entregue (Kz)" value={tendered} onChange={setTendered} numeric placeholder={String(total)} onSubmit={confirm} />
            <div className="quick-cash">
              {quick.map((v) => (
                <button key={v} className="qc" onClick={() => setTendered(String(v))}>{formatKz(v)}</button>
              ))}
            </div>
            <div className="change-box" style={{ borderColor: insufficient ? 'var(--danger)' : 'var(--success)' }}>
              <span>Troco</span>
              <strong style={{ color: insufficient ? 'var(--danger)' : 'var(--success)' }}>
                {insufficient ? 'Insuficiente' : formatKz(change)}
              </strong>
            </div>
          </div>
        ) : type === 'CREDIT' ? (
          <div style={{ marginTop: 12 }}>
            {customerName ? (
              <p className="muted" style={{ fontSize: 13 }}>
                Venda a crédito em nome de <strong>{customerName}</strong>. Fica em dívida (vencimento a 30 dias)
                e aparece em <strong>Contas a Receber</strong>. A factura é emitida normalmente.
              </p>
            ) : (
              <div className="change-box" style={{ borderColor: 'var(--danger)' }}>
                <span>Cliente</span>
                <strong style={{ color: 'var(--danger)' }}>Selecione um cliente primeiro</strong>
              </div>
            )}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
            Pagamento por {METHODS.find((m) => m.type === type)?.label}. Confirme após receber o pagamento.
          </p>
        )}

        <button className="btn success lg block" style={{ marginTop: 16 }} onClick={confirm} disabled={busy || insufficient || creditNoCustomer}>
          {busy ? 'A emitir…' : type === 'CREDIT' ? 'Confirmar venda a crédito' : 'Confirmar e emitir factura'}
        </button>
      </div>
    </div>
  );
}
