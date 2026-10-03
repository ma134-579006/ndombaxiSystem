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
  toolbar,
  footer,
}: {
  title: string;
  onClose(): void;
  children: React.ReactNode;
  /** Pesquisa/seleção FIXA por baixo do cabeçalho (não rola). */
  toolbar?: React.ReactNode;
  /** Ação principal FIXA no fundo (não rola). */
  footer?: React.ReactNode;
}) {
  // AÇÃO PRINCIPAL SEMPRE NO RODAPÉ. Muitos formulários terminam com o botão
  // largo (`.btn.block`) dentro do conteúdo; aí ficava "colado" (sticky) ao fundo
  // da zona que rola e, no telemóvel — sobretudo com o teclado aberto, que encolhe
  // o ecrã — aparecia a flutuar a meio do formulário, por cima dos campos. Esse
  // botão final passa para o rodapé fixo, fora do scroll: fica sempre no fundo do
  // modal (logo acima do teclado) e nunca tapa nada.
  let body: React.ReactNode = children;
  let foot = footer;
  if (!foot) {
    const kids = React.Children.toArray(children);
    const last = kids[kids.length - 1];
    if (React.isValidElement<{ className?: string; style?: React.CSSProperties }>(last)
        && last.type === 'button' && /\bbtn\b/.test(last.props.className ?? '') && /\bblock\b/.test(last.props.className ?? '')) {
      const { marginTop: _m, ...style } = last.props.style ?? {};
      foot = React.cloneElement(last, { style });
      body = kids.slice(0, -1);
    }
  }
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
        {toolbar ? <div className="mt">{toolbar}</div> : null}
        <div className="mb">{body}</div>
        {foot ? <div className="mf">{foot}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
