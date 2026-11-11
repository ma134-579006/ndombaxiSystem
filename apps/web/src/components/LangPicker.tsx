import React, { useEffect, useRef, useState } from 'react';
import { LANGS, getLang, onLangChange, setLang, type Lang } from '@nexus/i18n';

function IconGlobe({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

/**
 * Seletor do idioma do sistema (PT/EN/FR/ES). A escolha vale para a gestão, o
 * super admin e a Caixa (ver @nexus/i18n). `variant="dark"` é o do login.
 */
export function LangPicker({ variant = 'topbar' }: { variant?: 'topbar' | 'dark' }) {
  const [open, setOpen] = useState(false);
  const [lang, setCur] = useState<Lang>(getLang());
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => onLangChange(setCur), []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = (l: Lang) => { setLang(l); setCur(l); setOpen(false); };
  const short = LANGS.find((l) => l.code === lang)?.short ?? 'PT';

  return (
    <div ref={ref} className={`lang-pick lang-pick-${variant}`} translate="no">
      <button type="button" className={variant === 'topbar' ? 'icon-btn lang-pick-btn' : 'lang-pick-btn'}
        aria-haspopup="menu" aria-expanded={open} aria-label="Idioma" title="Idioma" onClick={() => setOpen((v) => !v)}>
        <IconGlobe size={variant === 'topbar' ? 19 : 16} />
        <span className="lang-pick-code">{short}</span>
      </button>
      {open ? (
        <div className="lang-pick-menu" role="menu">
          {LANGS.map((l) => (
            <button key={l.code} type="button" role="menuitemradio" aria-checked={l.code === lang}
              className={l.code === lang ? 'on' : ''} onClick={() => pick(l.code)}>
              <b>{l.short}</b> {l.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Escolha do idioma em linha (PT · EN · FR · ES), para as Configurações e o
 * menu da conta — a barra do topo fica só com os ícones essenciais.
 */
export function LangChoice({ compact = false }: { compact?: boolean }) {
  const [lang, setCur] = useState<Lang>(getLang());
  useEffect(() => onLangChange(setCur), []);
  return (
    <div className={`lang-choice${compact ? ' compact' : ''}`} role="radiogroup" aria-label="Idioma" translate="no">
      {LANGS.map((l) => (
        <button key={l.code} type="button" role="radio" aria-checked={l.code === lang}
          className={l.code === lang ? 'on' : ''} onClick={() => { setLang(l.code); setCur(l.code); }} title={l.label}>
          <b>{l.short}</b>{compact ? null : <span>{l.label}</span>}
        </button>
      ))}
    </div>
  );
}

export { IconGlobe };
