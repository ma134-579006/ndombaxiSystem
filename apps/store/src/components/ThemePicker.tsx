import React, { useEffect, useRef, useState } from 'react';
import { THEMES, getTheme, setTheme } from '../theme';

function IconPalette({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="17" cy="10.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="7" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1-.2-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-5-4.5-9-10-9z" />
    </svg>
  );
}

/** Seletor de tema da montra (botão de paleta no cabeçalho). */
export function ThemePicker() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(getTheme());
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (id: string) => { setTheme(id); setCurrent(id); setOpen(false); };

  return (
    <div className="theme-pick" ref={ref}>
      <button className="acct-btn" onClick={() => setOpen((v) => !v)} aria-label="Mudar tema" title="Mudar tema">
        <IconPalette size={22} />
      </button>
      {open ? (
        <div className="theme-pop">
          <div className="h">Tema</div>
          {THEMES.map((t) => (
            <button key={t.id || 'def'} className={current === t.id ? 'on' : ''} onClick={() => pick(t.id)}>
              <span className="sw" style={{ background: t.swatch }} />
              <span>{t.label}</span>
              {current === t.id ? <span className="ck">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
