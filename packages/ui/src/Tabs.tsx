import React from 'react';

export interface TabDef {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Contador à direita (ex.: nº de pendentes). */
  count?: number;
}

export interface TabsProps {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  /** Nome do conjunto, para leitores de ecrã. */
  label: string;
}

/**
 * Separadores com navegação por teclado (setas, Home/End), como
 * manda o padrão ARIA. Os separadores escritos à mão nas secções
 * eram `<div onClick>` — inalcançáveis por teclado.
 */
export function Tabs({ tabs, active, onChange, label }: TabsProps) {
  const ref = React.useRef<HTMLDivElement>(null);

  function onKeyDown(e: React.KeyboardEvent) {
    const i = tabs.findIndex((t) => t.id === active);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    ref.current?.querySelectorAll<HTMLElement>('.nx-tab')[next]?.focus();
  }

  return (
    <div className="nx-tabs" role="tablist" aria-label={label} ref={ref} onKeyDown={onKeyDown}>
      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            className="nx-tab"
            role="tab"
            aria-selected={selected}
            aria-controls={`panel-${t.id}`}
            id={`tab-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
          >
            {t.icon}
            {t.label}
            {t.count != null && t.count > 0 && <span className="nx-badge nx-badge--accent">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, active, children }: { id: string; active: string; children: React.ReactNode }) {
  if (id !== active) return null;
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0}>
      {children}
    </div>
  );
}
