import React from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  /** Fechar por Escape, clique no fundo ou botão ×. */
  onClose: () => void;
  title: string;
  /** Descrição curta por baixo do título (opcional). */
  description?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Acções do rodapé — a principal à direita, como em todo o sistema. */
  footer?: React.ReactNode;
  /**
   * Corpo sem padding nem `gap`, para listas encostadas às bordas (contactos,
   * conversas, resultados de procura) que trazem o seu próprio espaçamento.
   */
  flush?: boolean;
  /** Substitui as acções à direita do título (ex.: voltar, selecionar). */
  headerActions?: React.ReactNode;
  /**
   * Impede o fecho acidental por clique no fundo. Usar em diálogos
   * com dados por gravar (ex.: fatura a meio).
   */
  dismissable?: boolean;
  children?: React.ReactNode;
}

/**
 * Diálogo do sistema.
 *
 * Faz o que os modais escritos à mão em cada secção não faziam:
 *  · prende o Tab dentro do diálogo (senão o foco passeia pela
 *    página por trás, que continua a ser clicável para o teclado);
 *  · devolve o foco ao elemento que o abriu;
 *  · tranca o scroll do corpo;
 *  · fecha com Escape;
 *  · anuncia-se como `role="dialog"` com nome acessível.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  flush,
  headerActions,
  dismissable = true,
  children,
}: DialogProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const restoreRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  const descId = React.useId();

  React.useEffect(() => {
    if (!open) return;

    restoreRef.current = document.activeElement as HTMLElement | null;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Foca o primeiro controlo útil — não o botão de fechar. O × está
    // primeiro no DOM (fica no cabeçalho), por isso procura-se primeiro
    // dentro do CORPO: quem abre um diálogo quer escrever no primeiro
    // campo, não percorrer o formulário todo ao contrário a partir do fim.
    const panel = panelRef.current;
    const body = panel?.querySelector<HTMLElement>('.nx-dialog__body');
    const first =
      body?.querySelector<HTMLElement>(FOCUSABLE) ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;

      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  // Portal para o <body>: o diálogo sai de qualquer stacking context local
  // (cartões com `transform`, painéis animados) onde o `position: fixed`
  // deixaria de ser relativo à janela e o diálogo cairia para trás do
  // conteúdo. Sem isto, um diálogo aberto de dentro de um cartão animado
  // aparece cortado ou escondido.
  return createPortal(
    <div
      className="nx-dialog__backdrop"
      onMouseDown={(e) => {
        if (dismissable && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={['nx-dialog', size !== 'md' && `nx-dialog--${size}`].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
      >
        <div className="nx-dialog__head">
          <div className="nx-stack-2" style={{ flex: 1 }}>
            <h2 className="nx-dialog__title" id={titleId}>
              {title}
            </h2>
            {description && (
              <span className="nx-caption" id={descId}>
                {description}
              </span>
            )}
          </div>
          {headerActions}
          <button className="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" onClick={onClose} aria-label="Fechar">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className={['nx-dialog__body', flush && 'nx-dialog__body--flush'].filter(Boolean).join(' ')}>
          {children}
        </div>

        {footer && <div className="nx-dialog__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
