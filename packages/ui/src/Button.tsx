import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Ocupa a largura toda do contentor. */
  block?: boolean;
  /** Mostra o indicador e bloqueia cliques repetidos. */
  loading?: boolean;
  /** Ícone antes do texto. */
  icon?: React.ReactNode;
  /** Ícone depois do texto (ex.: seta de "seguinte"). */
  iconAfter?: React.ReactNode;
}

/**
 * Botão do sistema.
 *
 * Duas garantias que o `.btn` antigo não dava:
 *  · `loading` desactiva o botão — impede o duplo-clique que
 *    chegou a gerar documentos fiscais em duplicado;
 *  · botão só-de-ícone sem `aria-label` avisa em consola, em vez
 *    de chegar a produção mudo para um leitor de ecrã.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', block, loading, icon, iconAfter, children, className, disabled, ...rest },
  ref,
) {
  const iconOnly = !children && (!!icon || !!iconAfter);

  // Lido através do `globalThis` de propósito: assim o Design System não
  // precisa dos tipos do Node nem de declarações ambientais, que não
  // atravessavam a fronteira do pacote e faziam o `tsc` das apps queixar-se.
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV;
  if (nodeEnv !== 'production' && iconOnly && !rest['aria-label']) {
    console.warn('[@nexus/ui] <Button> só com ícone precisa de aria-label.');
  }

  const cls = [
    'nx-btn',
    `nx-btn--${variant}`,
    size !== 'md' && `nx-btn--${size}`,
    block && 'nx-btn--block',
    iconOnly && 'nx-btn--icon',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="nx-spinner" aria-hidden="true" /> : icon}
      {children}
      {!loading && iconAfter}
    </button>
  );
});
