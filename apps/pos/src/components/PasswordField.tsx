import React, { useState } from 'react';

/** Input de senha/PIN com botão "olho" para mostrar/esconder. Usa .auth-input. */
export function PasswordField(props: {
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  inputMode?: 'numeric' | 'text';
  maxLength?: number;
  autoComplete?: string;
  digitsOnly?: boolean;
  onEnter?(): void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="auth-pass">
      <input
        className="auth-input"
        type={show ? 'text' : 'password'}
        value={props.value}
        inputMode={props.inputMode}
        maxLength={props.maxLength}
        autoComplete={props.autoComplete}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(props.digitsOnly ? e.target.value.replace(/\D/g, '').slice(0, props.maxLength ?? 8) : e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && props.onEnter) props.onEnter(); }}
      />
      <button type="button" className="auth-eye" onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Esconder' : 'Mostrar'} title={show ? 'Esconder' : 'Mostrar'}>
        {show ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><path d="M1 1l22 22" /><path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 8 10 8a9.7 9.7 0 0 0 5.39-1.61" /></svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8z" /><circle cx="12" cy="12" r="3" /></svg>
        )}
      </button>
    </div>
  );
}
