/**
 * Idioma do sistema (gestão, super admin e caixa).
 *
 * - A ESCOLHA é uma só para todo o sistema: guarda-se em `localStorage`
 *   (`lps:lang`, a mesma chave da página inicial) e num cookie do domínio
 *   `.ndombaxisystem.com`, para a Caixa (`caixa.`) e a gestão abrirem no mesmo
 *   idioma. Sem escolha guardada, o sistema abre em português.
 * - O português é a BASE: os textos estão escritos em PT no código e o
 *   dicionário (carregado só quando o idioma não é PT) traduz o ecrã.
 */
import { applyDom, startDom, stopDom } from './dom';

export type Lang = 'pt' | 'en' | 'fr' | 'es';

export const LANGS: { code: Lang; short: string; label: string }[] = [
  { code: 'pt', short: 'PT', label: 'Português' },
  { code: 'en', short: 'EN', label: 'English' },
  { code: 'fr', short: 'FR', label: 'Français' },
  { code: 'es', short: 'ES', label: 'Español' },
];

const KEY = 'lps:lang';
const COOKIE = 'lps_lang';
const EVENT = 'lps:lang-change';
const isLang = (v: unknown): v is Lang => v === 'pt' || v === 'en' || v === 'fr' || v === 'es';

function readCookie(): Lang | null {
  try {
    const m = document.cookie.match(/(?:^|;\s*)lps_lang=([a-z]{2})/);
    return m && isLang(m[1]) ? m[1] : null;
  } catch { return null; }
}

function writeCookie(lang: Lang): void {
  try {
    const host = location.hostname;
    const domain = /(^|\.)ndombaxisystem\.com$/.test(host) ? '; domain=.ndombaxisystem.com' : '';
    const secure = location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax${domain}${secure}`;
  } catch { /* cookies indisponíveis (app instalada) */ }
}

/** Idioma atual: cookie do domínio (partilhado) → localStorage → português. */
export function getLang(): Lang {
  const c = readCookie();
  if (c) return c;
  try {
    const s = localStorage.getItem(KEY);
    if (isLang(s)) return s;
  } catch { /* sem armazenamento */ }
  return 'pt';
}

type DictMap = Map<string, string>;
let current: Lang = 'pt';
let dict: DictMap | null = null;
let loading: Promise<void> | null = null;

async function loadDict(lang: Lang): Promise<DictMap | null> {
  if (lang === 'pt') return null;
  const mod = await import('./dict');
  return mod.buildDict(lang);
}

/** Tradução de um texto em português (para mensagens que não passam pelo ecrã). */
export function t(pt: string): string {
  if (current === 'pt' || !dict) return pt;
  const k = pt.replace(/\s+/g, ' ').trim();
  return dict.get(k) ?? pt;
}

function apply(lang: Lang): Promise<void> {
  current = lang;
  try { document.documentElement.lang = lang === 'pt' ? 'pt-AO' : lang; } catch { /* */ }
  if (lang === 'pt') {
    dict = null;
    stopDom();
    return Promise.resolve();
  }
  const p = loadDict(lang).then((d) => {
    if (current !== lang) return; // trocou entretanto
    dict = d;
    if (d) { startDom(); applyDom(d); }
  }).catch(() => { /* sem dicionário: fica em português */ });
  loading = p;
  return p;
}

/** Muda o idioma de todo o sistema (e avisa os outros separadores). */
export function setLang(lang: Lang): void {
  if (!isLang(lang)) return;
  try { localStorage.setItem(KEY, lang); } catch { /* */ }
  writeCookie(lang);
  void apply(lang);
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: lang })); } catch { /* */ }
}

/** Avisa quando o idioma muda (neste ou noutro separador). */
export function onLangChange(cb: (lang: Lang) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<Lang>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

let started = false;
const nativeAlert = typeof window !== 'undefined' ? window.alert.bind(window) : null;
const nativeConfirm = typeof window !== 'undefined' ? window.confirm.bind(window) : null;

/**
 * Arranque (uma vez, no `main.tsx` de cada app): aplica o idioma guardado,
 * acompanha a troca noutros separadores e traduz também os avisos nativos
 * (`alert`/`confirm`), que não passam pelo ecrã.
 */
export function startI18n(): Promise<void> {
  if (started) return loading ?? Promise.resolve();
  started = true;
  if (nativeAlert && nativeConfirm) {
    window.alert = (m?: unknown) => nativeAlert(t(String(m ?? '')));
    window.confirm = (m?: unknown) => nativeConfirm(t(String(m ?? '')));
  }
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && isLang(e.newValue) && e.newValue !== current) {
      void apply(e.newValue);
      try { window.dispatchEvent(new CustomEvent(EVENT, { detail: e.newValue })); } catch { /* */ }
    }
  });
  const lang = getLang();
  // Mantém as duas cópias alinhadas (ex.: escolhido na Caixa, abre a gestão).
  try { localStorage.setItem(KEY, lang); } catch { /* */ }
  return apply(lang);
}

export function currentLang(): Lang { return current; }
