import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { VirtualKeyboard, type KeyboardLayout } from './VirtualKeyboard';

export interface ActiveField {
  id: string;
  layout: KeyboardLayout;
  submitLabel?: string;
  insert(ch: string): void;
  backspace(): void;
  clear(): void;
  submit(): void;
}

interface KeyboardContextValue {
  enabled: boolean;
  setEnabled(enabled: boolean): void;
  toggle(): void;
  activeId: string | null;
  open(field: ActiveField): void;
  close(): void;
  scheduleClose(): void;
}

const KeyboardContext = createContext<KeyboardContextValue | null>(null);
const LS_KEY = 'nexus.pos.virtualKeyboard';

/**
 * Monta UM teclado no ecrã, partilhado por todos os campos (KeyboardInput).
 * Encerra com um pequeno atraso ao perder o foco — para permitir trocar de
 * campo sem o teclado piscar.
 */
export function KeyboardProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean>(() => localStorage.getItem(LS_KEY) === '1');
  const [active, setActive] = useState<ActiveField | null>(null);
  const closeTimer = useRef<number | null>(null);

  const cancelTimer = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    localStorage.setItem(LS_KEY, value ? '1' : '0');
    if (!value) setActive(null);
  }, []);

  const open = useCallback((field: ActiveField) => {
    cancelTimer();
    setActive(field);
  }, []);

  const close = useCallback(() => {
    cancelTimer();
    setActive(null);
  }, []);

  const scheduleClose = useCallback(() => {
    cancelTimer();
    closeTimer.current = window.setTimeout(() => setActive(null), 160);
  }, []);

  // Marca o <html> quando o teclado virtual está aberto (o CSS dá espaço
  // por baixo para o botão ficar acima do teclado).
  useEffect(() => {
    const open = enabled && !!active;
    document.documentElement.classList.toggle('kbd-open', open);
    return () => document.documentElement.classList.remove('kbd-open');
  }, [enabled, active]);

  const value = useMemo<KeyboardContextValue>(
    () => ({
      enabled,
      setEnabled,
      toggle: () => setEnabled(!enabled),
      activeId: active?.id ?? null,
      open,
      close,
      scheduleClose,
    }),
    [enabled, active, setEnabled, open, close, scheduleClose],
  );

  return (
    <KeyboardContext.Provider value={value}>
      {children}
      {enabled && active ? (
        <div className="kbd-overlay">
          <VirtualKeyboard
            layout={active.layout}
            submitLabel={active.submitLabel}
            onInsert={active.insert}
            onBackspace={active.backspace}
            onClear={active.clear}
            onSubmit={active.submit}
            onHide={close}
          />
        </div>
      ) : null}
    </KeyboardContext.Provider>
  );
}

export function useKeyboard(): KeyboardContextValue {
  const ctx = useContext(KeyboardContext);
  if (!ctx) throw new Error('useKeyboard deve ser usado dentro de <KeyboardProvider>');
  return ctx;
}
