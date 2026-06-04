/**
 * Temas da montra. Por defeito usa o tema claro com a cor da marca de
 * cada loja; "Néon" aplica um visual escuro com brilhos (data-theme no <html>).
 * A escolha do visitante persiste no localStorage.
 */
export interface ThemeDef { id: string; label: string; swatch: string }

export const THEMES: ThemeDef[] = [
  { id: '', label: 'Padrão da loja', swatch: 'var(--accent)' },
  { id: 'neon', label: 'Néon', swatch: 'linear-gradient(120deg, #22d3ee, #a855f7 55%, #ec4899)' },
];

const LS_KEY = 'ndombaxi.store.theme';

export function getTheme(): string {
  try { return localStorage.getItem(LS_KEY) ?? ''; } catch { return ''; }
}
export function applyTheme(id: string): void {
  const el = document.documentElement;
  if (id) el.setAttribute('data-theme', id); else el.removeAttribute('data-theme');
}
export function setTheme(id: string): void {
  try { localStorage.setItem(LS_KEY, id); } catch { /* ignora */ }
  applyTheme(id);
}
export function initTheme(): void { applyTheme(getTheme()); }
