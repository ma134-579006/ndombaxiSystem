import React from 'react';
import { Badge, Dialog, type Tone } from '@nexus/ui';
import { statusLabel } from '../format';

export function Switch({ checked, onChange }: { checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="tk" />
      <span className="th" />
    </label>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  PENDING: 'warning',
  ACTIVE: 'success',
  SUSPENDED: 'danger',
  CANCELLED: 'neutral',
};

/**
 * Estado de uma empresa/subscrição.
 *
 * Passou a usar o `Badge` do Design System: a mesma cor de "activo" que a
 * Caixa e a Loja mostram, em vez de uma escala própria do Gestor.
 */
export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge dot tone={STATUS_TONE[status] ?? 'neutral'}>
      {statusLabel(status)}
    </Badge>
  );
}

/**
 * Modal do Gestor — agora só um invólucro fino sobre o `<Dialog>` partilhado.
 *
 * A API mantém-se igual (`title`, `onClose`, `children`), por isso as 35
 * secções que a usam não mudaram uma linha. O que ganharam, todas de uma vez:
 * fecho com Escape, foco preso dentro do modal, foco devolvido a quem o abriu,
 * scroll do corpo trancado e `role="dialog"` com nome acessível — nada disto
 * existia antes.
 *
 * O portal para o <body> não se perdeu: mudou-se para dentro do `<Dialog>`,
 * onde beneficia também a Caixa e a Loja.
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open onClose={onClose} title={title}>
      {children}
    </Dialog>
  );
}
