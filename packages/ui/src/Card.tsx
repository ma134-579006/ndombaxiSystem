import React from 'react';

// `title` é omitido do HTML: no DOM significa "tooltip" e só aceita string.
// Aqui é o título do cartão e aceita nós React (ex.: título com emblema).
export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Título do cartão. Rende o cabeçalho com separador. */
  title?: React.ReactNode;
  /** Acções alinhadas à direita do título (botões, filtros). */
  actions?: React.ReactNode;
  /** Rodapé com fundo próprio, para acções de confirmação. */
  footer?: React.ReactNode;
  /** Corpo sem padding — para tabelas encostadas às bordas. */
  flush?: boolean;
}

export function Card({ title, actions, footer, flush, children, className, ...rest }: CardProps) {
  return (
    <section className={['nx-card', flush && 'nx-card--flush', className].filter(Boolean).join(' ')} {...rest}>
      {(title || actions) && (
        <header className="nx-card__head">
          {title && <h3 className="nx-card__title">{title}</h3>}
          {actions && (
            <>
              <span className="nx-spacer" />
              {actions}
            </>
          )}
        </header>
      )}
      <div className="nx-card__body">{children}</div>
      {footer && <footer className="nx-card__foot">{footer}</footer>}
    </section>
  );
}

export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  /** Variação face ao período anterior, em pontos percentuais. */
  delta?: number;
  /** Texto do período comparado (ex.: "vs. mês anterior"). */
  deltaLabel?: string;
  icon?: React.ReactNode;
  /**
   * Numa métrica onde subir é MAU (devoluções, rupturas de stock),
   * pôr `invert` para o verde/vermelho não mentirem ao gestor.
   */
  invert?: boolean;
}

/**
 * Indicador de topo de dashboard.
 *
 * A variação é dita por texto além da cor e da seta — quem não
 * distingue verde de vermelho continua a ler "subiu 12%".
 */
export function KpiCard({ label, value, delta, deltaLabel, icon, invert }: KpiCardProps) {
  const dir = delta == null || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down';
  const good = invert ? dir === 'down' : dir === 'up';
  const tone = dir === 'flat' ? 'flat' : good ? 'up' : 'down';
  const arrow = dir === 'flat' ? '—' : dir === 'up' ? '↑' : '↓';
  const word = dir === 'flat' ? 'sem variação' : dir === 'up' ? 'subiu' : 'desceu';

  return (
    <article className="nx-card nx-kpi">
      <div className="nx-row">
        <span className="nx-kpi__label">{label}</span>
        {icon && (
          <>
            <span className="nx-spacer" />
            <span style={{ color: 'var(--nx-c-text-faint)' }} aria-hidden="true">
              {icon}
            </span>
          </>
        )}
      </div>
      <div className="nx-kpi__value">{value}</div>
      {delta != null && (
        <div className={`nx-kpi__delta nx-kpi__delta--${tone}`}>
          <span aria-hidden="true">{arrow}</span>
          <span className="nx-sr-only">{word}</span>
          {Math.abs(delta).toLocaleString('pt-PT', { maximumFractionDigits: 1 })}%
          {deltaLabel && <span style={{ color: 'var(--nx-c-text-muted)', fontWeight: 400 }}>{deltaLabel}</span>}
        </div>
      )}
    </article>
  );
}
