import React, { useMemo, useState } from 'react';
import { Button, Dialog } from '@nexus/ui';
import type { PaymentType } from '../api/types';
import { formatKz } from '../format';
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
    <Dialog
      open
      onClose={onClose}
      title="Pagamento"
      size="sm"
      // Enquanto a factura está a ser emitida, o diálogo não se fecha por
      // clique no fundo nem por Escape acidental: fechá-lo a meio deixaria
      // o operador sem saber se o documento chegou a sair.
      dismissable={!busy}
      footer={
        <Button
          variant="primary"
          size="lg"
          block
          loading={busy}
          onClick={confirm}
          disabled={insufficient || creditNoCustomer}
        >
          {busy ? 'A emitir…' : type === 'CREDIT' ? 'Confirmar venda a crédito' : 'Confirmar e emitir factura'}
        </Button>
      }
    >
      <div className="totals">
        <div className="t-row grand">
          <span>Total a pagar</span>
          <span className="nx-num">{formatKz(total)}</span>
        </div>
      </div>

      {/* Grupo de escolha: `aria-pressed` diz ao leitor de ecrã qual o método
          activo. Antes, a selecção existia apenas na classe `.on` — invisível
          para quem não vê o destaque. */}
      <div className="pay-methods" role="group" aria-label="Método de pagamento">
        {METHODS.map((m) => (
          <button
            key={m.type}
            className={`pay-method${type === m.type ? ' on' : ''}`}
            aria-pressed={type === m.type}
            onClick={() => setType(m.type)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {type === 'CASH' ? (
        <div className="nx-stack-2">
          <KeyboardInput
            label="Dinheiro entregue (Kz)"
            value={tendered}
            onChange={setTendered}
            numeric
            placeholder={String(total)}
            onSubmit={confirm}
          />
          <div className="quick-cash">
            {quick.map((v) => (
              <button key={v} className="qc" onClick={() => setTendered(String(v))}>
                {formatKz(v)}
              </button>
            ))}
          </div>
          {/* O troco é lido em voz alta assim que muda: numa caixa com fila,
              o operador não tem os olhos no ecrã enquanto conta as notas. */}
          <div
            className="change-box"
            style={{ borderColor: insufficient ? 'var(--nx-c-danger)' : 'var(--nx-c-success)' }}
            role="status"
            aria-live="polite"
          >
            <span>Troco</span>
            <strong
              className="nx-num"
              style={{ color: insufficient ? 'var(--nx-c-danger)' : 'var(--nx-c-success)' }}
            >
              {insufficient ? 'Insuficiente' : formatKz(change)}
            </strong>
          </div>
        </div>
      ) : type === 'CREDIT' ? (
        customerName ? (
          <p className="nx-body-sm" style={{ color: 'var(--nx-c-text-muted)', margin: 0 }}>
            Venda a crédito em nome de <strong>{customerName}</strong>. Fica em dívida (vencimento a 30 dias) e
            aparece em <strong>Contas a Receber</strong>. A factura é emitida normalmente.
          </p>
        ) : (
          <div className="change-box" style={{ borderColor: 'var(--nx-c-danger)' }} role="alert">
            <span>Cliente</span>
            <strong style={{ color: 'var(--nx-c-danger)' }}>Selecione um cliente primeiro</strong>
          </div>
        )
      ) : (
        <p className="nx-body-sm" style={{ color: 'var(--nx-c-text-muted)', margin: 0 }}>
          Pagamento por {METHODS.find((m) => m.type === type)?.label}. Confirme após receber o pagamento.
        </p>
      )}
    </Dialog>
  );
}
