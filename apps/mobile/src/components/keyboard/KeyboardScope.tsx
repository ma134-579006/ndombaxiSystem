import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings } from '../../settings/SettingsContext';
import { VirtualKeyboard, type KeyboardLayout } from './VirtualKeyboard';

/** Campo actualmente em edição que recebe as teclas do teclado no ecrã. */
export interface ActiveField {
  id: string;
  layout: KeyboardLayout;
  submitLabel?: string;
  insert(ch: string): void;
  backspace(): void;
  clear(): void;
  submit(): void;
}

interface KeyboardScopeValue {
  /** Teclado no ecrã activado nas preferências. */
  enabled: boolean;
  activeId: string | null;
  open(field: ActiveField): void;
  close(): void;
}

const KeyboardScopeContext = createContext<KeyboardScopeValue | null>(null);

/**
 * Monta UM único teclado virtual no fundo do ecrã, partilhado por todos os
 * campos (KeyboardField). O campo em foco regista-se via `open()` e recebe as
 * teclas; some-se quando o utilizador esconde o teclado ou abandona o campo.
 */
export function KeyboardScopeProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const enabled = settings.virtualKeyboard;
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState<ActiveField | null>(null);

  const open = useCallback((field: ActiveField) => setActive(field), []);
  const close = useCallback(() => setActive(null), []);

  // Se o teclado for desativado nas preferências, fecha já o que estiver aberto.
  useEffect(() => {
    if (!enabled) setActive(null);
  }, [enabled]);

  const value = useMemo<KeyboardScopeValue>(
    () => ({ enabled, activeId: active?.id ?? null, open, close }),
    [enabled, active, open, close],
  );

  return (
    <KeyboardScopeContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        {enabled && active ? (
          <View style={[styles.overlay, { paddingBottom: insets.bottom }]} pointerEvents="box-none">
            <VirtualKeyboard
              layout={active.layout}
              submitLabel={active.submitLabel}
              onInsert={active.insert}
              onBackspace={active.backspace}
              onClear={active.clear}
              onSubmit={active.submit}
              onHide={close}
            />
          </View>
        ) : null}
      </View>
    </KeyboardScopeContext.Provider>
  );
}

export function useKeyboardScope(): KeyboardScopeValue {
  const ctx = useContext(KeyboardScopeContext);
  if (!ctx) throw new Error('useKeyboardScope deve ser usado dentro de <KeyboardScopeProvider>');
  return ctx;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    zIndex: 1000,
    elevation: 1000,
  },
});
