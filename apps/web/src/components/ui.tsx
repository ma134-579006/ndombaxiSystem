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
  wide,
}: {
  title: string;
  /** Modal largo (mapas, tabelas). */
  wide?: boolean;
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
  // Acessibilidade: Esc fecha, o foco entra no modal e volta ao sítio ao fechar.
  const boxRef = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  React.useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      // Só o modal de cima fecha (vários abertos: o último no DOM é o da frente).
      const all = document.querySelectorAll('.modal');
      if (e.key === 'Escape' && all[all.length - 1] === boxRef.current) { e.stopPropagation(); closeRef.current(); }
    };
    document.addEventListener('keydown', onKey);
    if (boxRef.current && !boxRef.current.contains(document.activeElement)) boxRef.current.focus({ preventScroll: true });
    return () => { document.removeEventListener('keydown', onKey); before?.focus?.({ preventScroll: true }); };
  }, []);
  // FORMULÁRIO EM PÁGINA (modelo do backoffice de referência): abre DENTRO do
  // painel — por baixo da barra de topo e à direita do menu —, com as migalhas
  // "Secção / Título" (a secção volta atrás), rótulos à esquerda e o botão de
  // gravar por baixo dos campos. A barra fina de carregamento corre no topo,
  // como na referência. Fora do painel (login, etc.) ocupa o ecrã todo.
  // Portal para o <body>: fica sempre à frente de qualquer contexto local.
  const [area, setArea] = React.useState<{ left: number; top: number; crumb: string }>({ left: 0, top: 0, crumb: '' });
  React.useLayoutEffect(() => {
    const measure = () => {
      const main = document.querySelector<HTMLElement>('.main');
      if (!main) { setArea({ left: 0, top: 0, crumb: '' }); return; }
      const bar = main.querySelector<HTMLElement>('.topbar');
      const r = main.getBoundingClientRect();
      setArea({ left: Math.max(0, Math.round(r.left)), top: bar ? Math.round(bar.getBoundingClientRect().bottom) : 0, crumb: main.dataset.crumb ?? '' });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return createPortal(
    <div className="modal-bg vf-page" style={{ left: area.left, top: area.top }}>
      <span className="vf-load" aria-hidden="true" />
      <div className={`modal vf${wide ? ' modal-wide' : ''}`} ref={boxRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <p className="vf-crumb">
          {area.crumb ? <><button type="button" onClick={onClose}>{area.crumb}</button><span className="sep">/</span></> : null}
          <span>{title}</span>
          <span className="spacer" />
          <button type="button" className="vf-x" onClick={onClose} aria-label="Fechar"><IconClose size={18} /></button>
        </p>
        {toolbar ? <div className="mt">{toolbar}</div> : null}
        <div className="mb">{body}</div>
        {foot ? <div className="mf">{foot}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
