import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useKeyboard } from './KeyboardProvider';

interface Props {
  value: string;
  onChange(value: string): void;
  type?: 'text' | 'password' | 'tel';
  placeholder?: string;
  label?: string;
  icon?: React.ReactNode;
  /** Layout numérico no ecrã + inputMode decimal no físico. */
  numeric?: boolean;
  maxLength?: number;
  onSubmit?(): void;
  submitLabel?: string;
  autoFocus?: boolean;
}

/**
 * Campo de texto que respeita o "Teclado no ecrã". Quando activo, o campo fica
 * read-only (entrada só pelo teclado virtual — ideal para PCs táteis) e encaminha
 * as teclas; caso contrário, é um input normal com o teclado físico.
 */
export function KeyboardInput({
  value,
  onChange,
  type = 'text',
  placeholder,
  label,
  icon,
  numeric,
  maxLength,
  onSubmit,
  submitLabel,
  autoFocus,
}: Props) {
  const kbd = useKeyboard();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  const valueRef = useRef(value);
  valueRef.current = value;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  const maxRef = useRef(maxLength);
  maxRef.current = maxLength;
  const kbdRef = useRef(kbd);
  kbdRef.current = kbd;

  const insert = useCallback((ch: string) => {
    const max = maxRef.current;
    if (max != null && valueRef.current.length >= max) return;
    changeRef.current(valueRef.current + ch);
  }, []);
  const backspace = useCallback(() => changeRef.current(valueRef.current.slice(0, -1)), []);
  const clear = useCallback(() => changeRef.current(''), []);
  const submit = useCallback(() => {
    submitRef.current?.();
    inputRef.current?.blur();
  }, []);

  const layout = numeric ? 'numeric' : 'text';

  const handleFocus = useCallback(() => {
    setFocused(true);
    if (kbdRef.current.enabled) {
      kbdRef.current.open({ id, layout, submitLabel, insert, backspace, clear, submit });
    }
  }, [id, layout, submitLabel, insert, backspace, clear, submit]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    if (kbdRef.current.enabled) kbdRef.current.scheduleClose();
  }, []);

  useEffect(
    () => () => {
      if (kbdRef.current.activeId === id) kbdRef.current.close();
    },
    [id],
  );

  const active = focused || kbd.activeId === id;

  return (
    <div className="field">
      {label ? <label>{label}</label> : null}
      <div className={`input-wrap${active ? ' active' : ''}`}>
        {icon}
        <input
          ref={inputRef}
          type={type}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          autoFocus={autoFocus}
          readOnly={kbd.enabled}
          inputMode={numeric ? 'decimal' : undefined}
          onChange={(e) => onChange(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && submitRef.current) {
              e.preventDefault();
              submitRef.current();
            }
          }}
        />
      </div>
    </div>
  );
}
