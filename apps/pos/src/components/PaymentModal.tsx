import React, { useMemo, useState } from 'react';
import type { PaymentType } from '../api/types';
import { formatKz } from '../format';
import { IconClose } from './Icons';
import { KeyboardInput } from '../keyboard/KeyboardInput';

interface Props {
  total: number;
  /** Nome do cliente selecionado (obrigatório para venda a crédito). */
  customerName?: string | null;
  onConfirm(p: { paymentType: PaymentType; tendered?: number; changeGiven?: number }): void;
  onClose(): void;
  busy?: boolean;
}

const METHODS: { type: PaymentType; label: string }[] = [
  { type: 'CASH', label: 'Numerário' },
  { type: 'CARD', label: 'Multicaixa (TPA)' },
  { type: 'TRANSFER', label: 'Transferência' },
  { type: 'REFERENCE', label: 'Referência' },
  { type: 'EXPRESS', label: 'Express' },
  { type: 'CREDIT', label: 'A crédito (fiado)' },
];

/** Selecção do método + (numerário) dinheiro entregue → troco automático. */
export function PaymentModal({ total, customerName, onConfirm, onClose, busy }: Props) {
  const [type, setType] = useState<PaymentType>('CASH');
  const [tendered, setTendered] = useState('');

  const tenderedNum = Number(tendered) || 0;
  const change = useMemo(() => Math.max(0, tenderedNum - total), [tenderedNum, total]);
  const insufficient = type === 'CASH' && tendered !== '' && tenderedNum < total;
  const creditNoCustomer = type === 'CREDIT' && !customerName;

  // Atalhos de notas Kwanza comuns.
  const quick = [total, 1000, 2000, 5000, 10000].filter((v, i, a) => a.indexOf(v) === i);

  const confirm = () => {
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
            <button key={m.type} className={`pay-method${type === m.type ? ' on' : ''}`} onClick={() => setType(m.type)}>
              {m.label}
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
