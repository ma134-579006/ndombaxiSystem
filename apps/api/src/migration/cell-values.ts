/**
 * Leitura rigorosa de valores de células na migração. Puro e determinístico:
 * nunca "adivinha" um valor — o que não se consegue ler com certeza é
 * devolvido vazio COM um aviso para o utilizador ver na pré-visualização.
 */
import { parseFlexibleNumber } from './column-aliases';

export interface ReadResult { value: string; warning?: string }

/** Escreve um número como texto inteiro sem notação científica (ex.: 5601234567890). */
function integerToText(n: number): string {
  if (Number.isSafeInteger(n)) return String(n);
  return n.toFixed(0);
}

/**
 * Lê um código de barras de uma célula.
 *  • números do Excel → inteiro em texto (sem "5.6E12", sem ".0");
 *  • texto → sem apóstrofo inicial, sem espaços/hífenes;
 *  • notação científica ("5,60123E+12": o Excel já cortou dígitos) → vazio + aviso;
 *  • zeros à esquerda preservados quando o ficheiro os traz como texto.
 */
export function readBarcode(raw: unknown): ReadResult {
  if (raw === null || raw === undefined) return { value: '' };
  let s: string;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { value: '' };
    s = Number.isInteger(raw) ? integerToText(raw) : String(raw);
  } else {
    s = String(raw);
  }
  s = s.trim().replace(/^'+/, '');
  if (!s) return { value: '' };
  if (/^\d+([.,]\d+)?e[+-]?\d+$/i.test(s)) {
    return { value: '', warning: `«${s}» está em notação científica — o Excel cortou o código; formate a coluna como Texto e exporte de novo` };
  }
  s = s.replace(/[\s-]/g, '');
  if (/^\d+[.,]0+$/.test(s)) s = s.replace(/[.,]0+$/, ''); // "123.0" → "123"
  // Código GS1 completo (DataMatrix/GS1-128: «(01)GTIN(17)validade(10)lote…»):
  // o produto é identificado pelo GTIN — é isso que o leitor encontra na caixa.
  const gs1 = s.match(/^\(?01\)?(\d{14})(?=\(?\d{2}\)?|$)/);
  if (gs1 && s.length >= 16) { // EAN tem no máximo 14 dígitos: 16+ começado por «01» é GS1
    const gtin = gs1[1].startsWith('0') ? gs1[1].slice(1) : gs1[1];
    return { value: gtin, warning: `código GS1 «${s}» — usado o GTIN ${gtin}` };
  }
  return { value: s };
}

/** Código de barras com letras (não é EAN/UPC): mantém-se, mas avisa-se o utilizador. */
export function hasLetters(code: string): boolean {
  return /[A-Za-z]/.test(code);
}

/** Código interno/SKU: texto aparado; números do Excel sem ".0" nem notação científica. */
export function readCode(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number') return Number.isFinite(raw) ? (Number.isInteger(raw) ? integerToText(raw) : String(raw)) : '';
  return String(raw).trim().replace(/^'+/, '').replace(/\s+/g, ' ');
}

/** Valida EAN-8/UPC-A/EAN-13/GTIN-14 pelo dígito de controlo. */
export function isValidGtin(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  // da direita para a esquerda: pesos 3,1,3,1…
  digits.reverse().forEach((d, i) => { sum += d * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

/** Parece um código de barras (só dígitos, 8–14)? Usado para detetar a coluna pelo conteúdo. */
export function looksLikeBarcode(value: string): boolean {
  return /^\d{8,14}$/.test(value);
}

export interface StockRead { value: number | null; warning?: string }

/**
 * Stock: célula VAZIA = desconhecido (null) — nunca vira 0, para não apagar o
 * stock de um produto já existente. Negativo é limitado a 0 com aviso.
 */
export function readStock(raw: unknown): StockRead {
  if (raw === null || raw === undefined) return { value: null };
  if (typeof raw === 'string' && raw.trim() === '') return { value: null };
  // Texto sem algarismos («Sim», «Sem controlo de Stock»…) não é uma quantidade:
  // desconhecido (null) — nunca 0, que apagava o stock real.
  if (typeof raw === 'string' && !/\d/.test(raw)) return { value: null };
  const n = parseFlexibleNumber(raw);
  if (n < 0) return { value: 0, warning: `stock negativo (${n}) tratado como 0` };
  return { value: n };
}

/** Nome do produto: espaços normalizados (sem duplos nem nas pontas). */
export function cleanName(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}
