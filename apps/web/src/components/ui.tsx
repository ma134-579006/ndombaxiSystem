import React from 'react';
import { createPortal } from 'react-dom';
import { statusLabel } from '../format';
import { IconClose } from './Icons';

export function Switch({ checked, onChange }: { checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="tk" />
      <span className="th" />
    </label>
  );
}

const STATUS_TONE: Record<string, string> = {
  PENDING: 'var(--warning)',
  ACTIVE: 'var(--success)',
  SUSPENDED: 'var(--danger)',
  CANCELLED: 'var(--muted)',
};

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_TONE[status] ?? 'var(--muted)';
  return (
    <span className="badge" style={{ color, borderColor: color, background: 'transparent' }}>
      <span className="dot" />
      {statusLabel(status)}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: React.ReactNode;
}) {
  // Portal para o <body>: o modal sai de qualquer stacking context local (cartões
  // com transform, painéis animados, etc.), por isso fica SEMPRE à frente e um
  // modal aberto sobre outro nunca cai para trás.
  return createPortal(
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>{title}</h3>
          <span className="spacer" />
          <button className="icon-btn" style={{ width: 36, height: 36 }} onClick={onClose}>
            <IconClose size={18} />
          </button>
        </div>
        <div className="mb">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
