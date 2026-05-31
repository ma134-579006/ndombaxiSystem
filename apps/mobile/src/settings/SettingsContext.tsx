import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { storage } from '../auth/storage';

/** Preferências locais do dispositivo (persistidas em SecureStore). */
export interface Settings {
  /** Teclado no ecrã para PCs/terminais táteis (sem teclado físico). */
  virtualKeyboard: boolean;
}

const DEFAULTS: Settings = { virtualKeyboard: false };

interface SettingsContextValue {
  settings: Settings;
  ready: boolean;
  setVirtualKeyboard(enabled: boolean): void;
  toggleVirtualKeyboard(): void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [ready, setReady] = useState(false);

  // Carrega as preferências guardadas no arranque.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await storage.loadSettings();
        if (alive && raw) {
          const parsed = JSON.parse(raw) as Partial<Settings>;
          setSettings({ ...DEFAULTS, ...parsed });
        }
      } catch {
        // preferências corrompidas — usa os valores por omissão
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Persiste sempre que mudam (depois do carregamento inicial).
  useEffect(() => {
    if (ready) void storage.saveSettings(JSON.stringify(settings));
  }, [settings, ready]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      ready,
      setVirtualKeyboard: (enabled) => setSettings((s) => ({ ...s, virtualKeyboard: enabled })),
      toggleVirtualKeyboard: () =>
        setSettings((s) => ({ ...s, virtualKeyboard: !s.virtualKeyboard })),
    }),
    [settings, ready],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings deve ser usado dentro de <SettingsProvider>');
  return ctx;
}
