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
  { id: 'claro', label: 'Claro', swatch: '#1b45f4', light: true },
  { id: 'profissional', label: 'Profissional', swatch: '#1e3a8a', light: true },
  { id: 'grafite', label: 'Grafite', swatch: '#4c7dff' },
  { id: 'meianoite', label: 'Meia-noite', swatch: '#3b82f6' },
];

/** v2: os temas antigos (néon, violeta…) foram retirados e todos recomeçam no Claro. */
const LS_KEY = 'ndombaxi.theme.v2';
/** Tema por defeito (até o utilizador escolher outro): CLARO. */
export const DEFAULT_THEME = 'claro';

/** Tema válido (vazio, desconhecido ou retirado = Claro). */
export function normalizeTheme(id: string | null | undefined): string {
  return id && THEMES.some((t) => t.id === id) ? id : DEFAULT_THEME;
}

export function getTheme(): string {
  try { return normalizeTheme(localStorage.getItem(LS_KEY)); } catch { return DEFAULT_THEME; }
}

/** Meia-noite é o tema base do CSS (sem atributo); os outros usam data-theme. */
export function applyTheme(id: string): void {
  const el = document.documentElement;
  const t = normalizeTheme(id);
  if (t === 'meianoite') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', t);
}

export function setTheme(id: string): void {
  const t = normalizeTheme(id);
  try { localStorage.setItem(LS_KEY, t); } catch { /* ignora */ }
  applyTheme(t);
}

/** Aplica o tema guardado (chamar no arranque, antes do render). */
export function initTheme(): void {
  applyTheme(getTheme());
}
