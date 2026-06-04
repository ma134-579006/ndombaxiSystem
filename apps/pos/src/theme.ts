/** Sistema de temas do POS — igual ao do painel (data-theme no <html>). */
export interface ThemeDef { id: string; label: string; swatch: string; light?: boolean }

export const THEMES: ThemeDef[] = [
  { id: '', label: 'Meia-noite', swatch: '#3b82f6' },
  { id: 'grafite', label: 'Grafite', swatch: '#5b95ff' },
  { id: 'oceano', label: 'Oceano', swatch: '#22d3ee' },
  { id: 'violeta', label: 'Violeta', swatch: '#a78bfa' },
  { id: 'esmeralda', label: 'Esmeralda', swatch: '#34d399' },
  { id: 'indigo', label: 'Índigo', swatch: '#818cf8' },
  { id: 'neon', label: 'Néon', swatch: 'linear-gradient(120deg, #22d3ee, #a855f7 55%, #ec4899)' },
  { id: 'claro', label: 'Claro', swatch: '#2563eb', light: true },
];

const LS_KEY = 'ndombaxi.theme';
export function getTheme(): string { try { return localStorage.getItem(LS_KEY) ?? ''; } catch { return ''; } }
export function applyTheme(id: string): void {
  const el = document.documentElement;
  if (id) el.setAttribute('data-theme', id); else el.removeAttribute('data-theme');
}
export function setTheme(id: string): void { try { localStorage.setItem(LS_KEY, id); } catch { /* ignora */ } applyTheme(id); }
export function initTheme(): void { applyTheme(getTheme()); }
