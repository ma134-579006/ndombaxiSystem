import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useKeyboardOptional } from './KeyboardProvider';

interface Props {
  value: string;
  onChange(value: string): void;
  type?: 'text' | 'password' | 'tel';
  placeholder?: string;
  label?: string;
  numeric?: boolean;
  maxLength?: number;
  onSubmit?(): void;
  submitLabel?: string;
  autoFocus?: boolean;
}

/**
 * Campo que respeita o "Teclado no ecrã" (terminais táteis). Quando activo, o
 * campo fica read-only e a entrada faz-se pelo teclado virtual. Degrada para
 * input normal se não houver KeyboardProvider acima.
 */
export function KeyboardInput({ value, onChange, type = 'text', placeholder, label, numeric, maxLength, onSubmit, submitLabel, autoFocus }: Props) {
  const kbd = useKeyboardOptional();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [, force] = useState(0);

  const valueRef = useRef(value); valueRef.current = value;
  const changeRef = useRef(onChange); changeRef.current = onChange;
  const submitRef = useRef(onSubmit); submitRef.current = onSubmit;
  const maxRef = useRef(maxLength); maxRef.current = maxLength;
  const kbdRef = useRef(kbd); kbdRef.current = kbd;

  const insert = useCallback((ch: string) => {
    const max = maxRef.current;
    if (max != null && valueRef.current.length >= max) return;
    changeRef.current(valueRef.current + ch);
  }, []);
  const backspace = useCallback(() => changeRef.current(valueRef.current.slice(0, -1)), []);
  const clear = useCallback(() => changeRef.current(''), []);
  const submit = useCallback(() => { submitRef.current?.(); inputRef.current?.blur(); }, []);

  const layout = numeric ? 'numeric' : 'text';

  const handleFocus = useCallback(() => {
    if (kbdRef.current?.enabled) {
      kbdRef.current.open({ id, layout, submitLabel, insert, backspace, clear, submit });
      force((n) => n + 1);
    }
  }, [id, layout, submitLabel, insert, backspace, clear, submit]);

  const handleBlur = useCallback(() => {
    if (kbdRef.current?.enabled) kbdRef.current.scheduleClose();
  }, []);

  useEffect(() => () => { if (kbdRef.current?.activeId === id) kbdRef.current.close(); }, [id]);

  const enabled = kbd?.enabled ?? false;

  return (
    <div className="field">
      {label ? <label>{label}</label> : null}
      <input
        ref={inputRef}
        type={type}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
        readOnly={enabled}
        inputMode={numeric ? 'decimal' : undefined}
        onChange={(e) => onChange(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={(e) => { if (e.key === 'Enter' && submitRef.current) { e.preventDefault(); submitRef.current(); } }}
      />
    </div>
  );
}
