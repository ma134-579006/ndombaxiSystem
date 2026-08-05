import React from 'react';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export interface BadgeProps {
  tone?: Tone;
  /** Ponto colorido antes do texto — útil em colunas de estado. */
  dot?: boolean;
  children: React.ReactNode;
}

/** Emblema de estado: cor + texto (nunca só cor). */
export function Badge({ tone = 'neutral', dot, children }: BadgeProps) {
  return (
    <span className={`nx-badge nx-badge--${tone}`}>
      {dot && <span className="nx-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: string;
  /** Nº de linhas empilhadas (a última sai mais curta, como texto real). */
  lines?: number;
}

/**
 * Reserva do espaço enquanto carrega.
 *
 * Preferir a um spinner centrado: o esqueleto mantém o layout no
 * sítio e evita o salto que faz o utilizador clicar no botão errado.
 */
export function Skeleton({ width = '100%', height = 16, radius, lines }: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <div className="nx-stack-2" aria-hidden="true">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="nx-skeleton"
            style={{ width: i === lines - 1 ? '60%' : width, height, borderRadius: radius }}
          />
        ))}
      </div>
    );
  }
  return <div className="nx-skeleton" style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  /** O que fazer a seguir. Um vazio sem saída é um beco. */
  text?: string;
  action?: React.ReactNode;
  variant?: 'default' | 'danger' | 'offline';
}

export function EmptyState({ icon, title, text, action, variant = 'default' }: EmptyStateProps) {
  return (
    <div className={['nx-empty', variant !== 'default' && `nx-empty--${variant}`].filter(Boolean).join(' ')}>
      {icon && <div className="nx-empty__icon">{icon}</div>}
      <div className="nx-empty__title">{title}</div>
      {text && <p className="nx-empty__text">{text}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label = 'A carregar' }: { label?: string }) {
  return (
    <span role="status" aria-live="polite">
      <span className="nx-spinner" aria-hidden="true" />
      <span className="nx-sr-only">{label}</span>
    </span>
  );
}

/* ── Avisos (toasts) ─────────────────────────────────────── */

export interface ToastItem {
  id: number;
  tone: Tone;
  title: string;
  text?: string;
  /** ms até desaparecer. 0 = fica até o utilizador fechar. */
  duration: number;
}

interface ToastApi {
  show: (t: Omit<ToastItem, 'id' | 'duration' | 'tone'> & { tone?: Tone; duration?: number }) => void;
  success: (title: string, text?: string) => void;
  error: (title: string, text?: string) => void;
  warning: (title: string, text?: string) => void;
  info: (title: string, text?: string) => void;
}

const ToastCtx = React.createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = React.useContext(ToastCtx);
  if (!api) throw new Error('useToast() precisa de <ToastProvider> acima na árvore.');
  return api;
}

/**
 * Fila de avisos do sistema.
 *
 * Erros ficam no ecrã até serem fechados — uma falha de gravação
 * que se evapora em 3 segundos é uma falha que o utilizador não viu.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const seq = React.useRef(0);

  const remove = React.useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const api = React.useMemo<ToastApi>(() => {
    const show: ToastApi['show'] = ({ tone = 'info', duration, title, text }) => {
      const id = ++seq.current;
      const ms = duration ?? (tone === 'danger' ? 0 : 4500);
      setItems((list) => [...list, { id, tone, title, text, duration: ms }]);
      if (ms > 0) window.setTimeout(() => remove(id), ms);
    };
    return {
      show,
      success: (title, text) => show({ tone: 'success', title, text }),
      error: (title, text) => show({ tone: 'danger', title, text }),
      warning: (title, text) => show({ tone: 'warning', title, text }),
      info: (title, text) => show({ tone: 'info', title, text }),
    };
  }, [remove]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="nx-toaster" role="region" aria-label="Notificações">
        {items.map((t) => (
          <div
            key={t.id}
            className={`nx-toast nx-toast--${t.tone}`}
            role={t.tone === 'danger' ? 'alert' : 'status'}
            aria-live={t.tone === 'danger' ? 'assertive' : 'polite'}
          >
            <div className="nx-toast__body">
              <span className="nx-toast__title">{t.title}</span>
              {t.text && <span className="nx-toast__text">{t.text}</span>}
            </div>
            <button
              className="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon"
              onClick={() => remove(t.id)}
              aria-label="Dispensar aviso"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
