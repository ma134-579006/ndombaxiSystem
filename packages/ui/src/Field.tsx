import React from 'react';

interface FieldShellProps {
  label: string;
  /** Marca o campo como obrigatório (visual + `required` no controlo). */
  required?: boolean;
  /** Texto de ajuda permanente, por baixo do campo. */
  hint?: string;
  /** Mensagem de erro. Presente = campo inválido. */
  error?: string;
  className?: string;
}

/**
 * Liga rótulo, ajuda e erro ao controlo pelos ids certos.
 *
 * É este atalho que garante que um leitor de ecrã anuncia
 * "Nome do cliente, obrigatório, inválido: preencha o nome" em vez
 * de apenas "campo de texto" — que era o que acontecia com os
 * formulários montados à mão em cada secção.
 */
function useFieldIds(hint?: string, error?: string) {
  const id = React.useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return { id, hintId, errorId, describedBy };
}

function FieldShell({
  label,
  required,
  hint,
  error,
  className,
  id,
  hintId,
  errorId,
  children,
}: FieldShellProps & {
  id: string;
  hintId?: string;
  errorId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={['nx-field', className].filter(Boolean).join(' ')}>
      <label className="nx-field__label" htmlFor={id}>
        {label}
        {required && (
          <span className="nx-field__req" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <span className="nx-field__hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="nx-field__error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export type InputProps = FieldShellProps &
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, required, hint, error, className, ...rest },
  ref,
) {
  const { id, hintId, errorId, describedBy } = useFieldIds(hint, error);
  return (
    <FieldShell
      label={label}
      required={required}
      hint={hint}
      error={error}
      className={className}
      id={id}
      hintId={hintId}
      errorId={errorId}
    >
      <input
        ref={ref}
        id={id}
        className="nx-input"
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
    </FieldShell>
  );
});

export type TextareaProps = FieldShellProps &
  Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, required, hint, error, className, ...rest },
  ref,
) {
  const { id, hintId, errorId, describedBy } = useFieldIds(hint, error);
  return (
    <FieldShell
      label={label}
      required={required}
      hint={hint}
      error={error}
      className={className}
      id={id}
      hintId={hintId}
      errorId={errorId}
    >
      <textarea
        ref={ref}
        id={id}
        className="nx-textarea"
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
    </FieldShell>
  );
});

export type SelectProps = FieldShellProps &
  Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'className'>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, required, hint, error, className, children, ...rest },
  ref,
) {
  const { id, hintId, errorId, describedBy } = useFieldIds(hint, error);
  return (
    <FieldShell
      label={label}
      required={required}
      hint={hint}
      error={error}
      className={className}
      id={id}
      hintId={hintId}
      errorId={errorId}
    >
      <span className="nx-select__wrap">
        <select
          ref={ref}
          id={id}
          className="nx-select"
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        >
          {children}
        </select>
        <svg
          className="nx-select__chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
    </FieldShell>
  );
});
