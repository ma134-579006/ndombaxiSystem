/**
 * Sistema de temas — aplica-se via atributo `data-theme` no <html>.
 * Cada tema sobrepõe as variáveis CSS no theme.css (`[data-theme="..."]`).
 * A escolha persiste no localStorage e é aplicada antes do render (sem flash).
 */
export interface ThemeDef {
  id: string;
  label: string;
  /** Cor de amostra mostrada no seletor. */
  swatch: string;
  /** Tema claro? (para o ícone/contraste do seletor) */
  light?: boolean;
}

export const THEMES: ThemeDef[] = [
  { id: '', label: 'Meia-noite', swatch: '#3b82f6' },
  { id: 'grafite', label: 'Grafite', swatch: '#5b95ff' },
  { id: 'oceano', label: 'Oceano', swatch: '#22d3ee' },
  { id: 'violeta', label: 'Violeta', swatch: '#a78bfa' },
  { id: 'esmeralda', label: 'Esmeralda', swatch: '#34d399' },
  { id: 'indigo', label: 'Índigo', swatch: '#818cf8' },
  { id: 'neon', label: 'Néon', swatch: 'linear-gradient(120deg, #22d3ee, #a855f7 55%, #ec4899)' },
  { id: 'apple', label: 'Apple Dark', swatch: 'linear-gradient(135deg, #0a84ff, #5e5ce6)' },
  { id: 'claro', label: 'Claro', swatch: '#2563eb', light: true },
  { id: 'profissional', label: 'Profissional', swatch: 'linear-gradient(135deg, #6366f1, #0891b2)', light: true },
];

const LS_KEY = 'ndombaxi.theme';
/** Tema por defeito (até o utilizador escolher outro): CLARO. */
export const DEFAULT_THEME = 'claro';

export function getTheme(): string {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v === null ? DEFAULT_THEME : v; // null = nunca escolheu → claro
  } catch { return DEFAULT_THEME; }
}

export function applyTheme(id: string): void {
  const el = document.documentElement;
  if (id) el.setAttribute('data-theme', id);
  else el.removeAttribute('data-theme');
}

export function setTheme(id: string): void {
  try { localStorage.setItem(LS_KEY, id); } catch { /* ignora */ }
  applyTheme(id);
}

/** Aplica o tema guardado (chamar no arranque, antes do render). */
export function initTheme(): void {
  applyTheme(getTheme());
}
