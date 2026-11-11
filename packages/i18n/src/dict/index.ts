/**
 * Dicionário PT → EN/FR/ES (carregado só quando o idioma não é português).
 * Cada lote é `{ "texto em PT": [EN, FR, ES] }`. Para acrescentar textos novos:
 * `node scripts/i18n/extract.cjs apps/web/src apps/pos/src` lista os textos do
 * ecrã e `node scripts/i18n/coverage.cjs` mostra os que faltam traduzir.
 */
import p01 from './part01';
import p02 from './part02';
import p03 from './part03';
import p04 from './part04';
import p05 from './part05';
import p06 from './part06';
import p07 from './part07';
import p08 from './part08';

const PARTS = [p01, p02, p03, p04, p05, p06, p07, p08];
const COL = { en: 0, fr: 1, es: 2 } as const;

export function buildDict(lang: 'en' | 'fr' | 'es' | 'pt'): Map<string, string> | null {
  if (lang === 'pt') return null;
  const i = COL[lang];
  const m = new Map<string, string>();
  for (const part of PARTS) {
    for (const k in part) {
      const v = part[k][i];
      if (v) m.set(k.replace(/\s+/g, ' ').trim(), v);
    }
  }
  return m;
}
