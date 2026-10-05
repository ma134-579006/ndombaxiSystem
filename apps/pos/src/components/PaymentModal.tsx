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
  /** Medicamentos do carrinho sujeitos a receita (pede o nº da receita). */
  prescriptionItems?: string[];
  onConfirm(p: { paymentType: PaymentType; tendered?: number; changeGiven?: number; prescriptionRef?: string; payments?: { type: Exclude<PaymentType, 'CREDIT'>; amount: number }[] }): void;
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
export function PaymentModal({ total, customerName, prescriptionItems = [], onConfirm, onClose, busy }: Props) {
  const [type, setType] = useState<PaymentType>('CASH');
  const [tendered, setTendered] = useState('');
  const [rxRef, setRxRef] = useState('');
  // PAGAMENTO MISTO: parte em numerário + o resto noutro meio (TPA, transferência…).
  const [mixed, setMixed] = useState(false);
  const [mixCash, setMixCash] = useState('');
  const [mixOther, setMixOther] = useState<Exclude<PaymentType, 'CREDIT' | 'CASH'>>('CARD');
  const mixCashNum = Math.min(total, Math.max(0, parseKz(mixCash) || 0));
  const mixRest = Math.round((total - mixCashNum) * 100) / 100;
  const mixInvalid = mixed && (!(mixCashNum > 0) || !(mixRest > 0));
  const rxMissing = prescriptionItems.length > 0 && !rxRef.trim();

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
    if (busy || (!mixed && (insufficient || creditNoCustomer)) || rxMissing || mixInvalid) return;
    const rx = prescriptionItems.length ? { prescriptionRef: rxRef.trim() } : {};
    if (mixed) {
      onConfirm({ paymentType: 'CASH', tendered: mixCashNum, changeGiven: 0, payments: [{ type: 'CASH', amount: mixCashNum }, { type: mixOther, amount: mixRest }], ...rx });
      return;
    }
    if (type === 'CASH') {
      onConfirm({ paymentType: 'CASH', tendered: tenderedNum || total, changeGiven: change, ...rx });
    } else {
      onConfirm({ paymentType: type, ...rx });
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

        {prescriptionItems.length ? (
          <div style={{ marginBottom: 12 }}>
            <KeyboardInput label={`Nº da receita médica (${prescriptionItems.join(', ')})`} value={rxRef} onChange={setRxRef} placeholder="Ex.: RX/2026/0012 ou nº da receita em papel" />
            {rxMissing ? <p className="muted" style={{ fontSize: 12, margin: '4px 0 0', color: 'var(--danger)' }}>Medicamento sujeito a receita: indique o nº da receita para vender.</p> : null}
          </div>
        ) : null}

        <div className="pay-methods">
          {METHODS.map((m) => (
            <button key={m.type} className={`pay-method${!mixed && type === m.type ? ' on' : ''}`} onClick={() => { setMixed(false); setType(m.type); }} aria-pressed={!mixed && type === m.type}>
              <UiIcon e={m.icon} size={20} className="pay-ic" />
              <span>{m.label}</span>
            </button>
          ))}
          <button className={`pay-method${mixed ? ' on' : ''}`} onClick={() => setMixed(true)} aria-pressed={mixed}>
            <UiIcon e="money" size={20} className="pay-ic" />
            <span>Misto</span>
          </button>
        </div>

        {mixed ? (
          <div style={{ marginTop: 14 }}>
            <KeyboardInput label="Parte em numerário (Kz)" value={mixCash} onChange={setMixCash} numeric placeholder="0" onSubmit={confirm} />
            <div className="pay-methods" style={{ marginTop: 10 }}>
              {METHODS.filter((m) => m.type !== 'CASH' && m.type !== 'CREDIT').map((m) => (
                <button key={m.type} className={`pay-method${mixOther === m.type ? ' on' : ''}`} onClick={() => setMixOther(m.type as Exclude<PaymentType, 'CREDIT' | 'CASH'>)} aria-pressed={mixOther === m.type}>
                  <UiIcon e={m.icon} size={20} className="pay-ic" />
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
            <div className="change-box" style={{ borderColor: mixInvalid ? 'var(--danger)' : 'var(--success)' }}>
              <span>Restante em {METHODS.find((m) => m.type === mixOther)?.label}</span>
              <strong style={{ color: mixInvalid ? 'var(--danger)' : 'var(--success)' }}>
                {mixInvalid ? 'Indique a parte em numerário' : formatKz(mixRest)}
              </strong>
            </div>
          </div>
        ) : type === 'CASH' ? (
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

        <button className="btn success lg block" style={{ marginTop: 16 }} onClick={confirm} disabled={busy || (!mixed && (insufficient || creditNoCustomer)) || rxMissing || mixInvalid}>
          {busy ? 'A emitir…' : type === 'CREDIT' ? 'Confirmar venda a crédito' : 'Confirmar e emitir factura'}
        </button>
      </div>
    </div>
  );
}
