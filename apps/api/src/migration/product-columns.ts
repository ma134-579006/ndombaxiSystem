import {
  PRODUCT_ALIASES, PRODUCT_FIELD_ORDER, PRODUCT_NEGATIVE, ProductField, mapHeaders,
} from './column-aliases';
import { looksLikeBarcode, readBarcode } from './cell-values';

export interface ProductColumns {
  mapping: Partial<Record<ProductField, string>>;
  unmapped: string[];
  /** Como cada coluna foi decidida (mostrado ao utilizador). */
  notes: string[];
  /** A coluna «Código» do ficheiro já traz os códigos de barras (EAN): usa-se também como código de barras. */
  barcodeFromCode: boolean;
}

const SAMPLE_ROWS = 400;

/** Percentagem (0–1) de valores não vazios da coluna que parecem um código de barras. */
function barcodeRatio(rows: Record<string, unknown>[], header: string): { ratio: number; n: number } {
  let n = 0, hit = 0;
  for (const r of rows.slice(0, SAMPLE_ROWS)) {
    const v = readBarcode(r[header]).value;
    if (!v) continue;
    n++;
    if (looksLikeBarcode(v)) hit++;
  }
  return { ratio: n ? hit / n : 0, n };
}

/**
 * Decide que coluna do ficheiro alimenta cada campo do produto:
 *  1. dicionário de cabeçalhos (palavras inteiras, uma coluna por campo);
 *  2. código de barras também pelo CONTEÚDO (coluna com ≥80 % de valores de 8–14
 *     dígitos) — cobre ficheiros com cabeçalho «Ref.», «Cód.» ou sem nome útil;
 *  3. se a coluna «Código» já for o EAN, usa-se também como código de barras;
 *  4. `override` (escolha manual do utilizador) tem a última palavra:
 *     valor vazio = «não usar este campo».
 */
export function detectProductColumns(
  headers: string[],
  rows: Record<string, unknown>[],
  override?: Record<string, string> | null,
): ProductColumns {
  const { mapping } = mapHeaders<ProductField>(headers, PRODUCT_ALIASES, { negative: PRODUCT_NEGATIVE, order: PRODUCT_FIELD_ORDER });
  const notes: string[] = [];
  let barcodeFromCode = false;

  const explicit = new Set<ProductField>();
  if (override) {
    for (const [field, header] of Object.entries(override)) {
      if (!(field in PRODUCT_ALIASES)) continue;
      const f = field as ProductField;
      explicit.add(f);
      if (!header) { delete mapping[f]; continue; }
      if (!headers.includes(header)) continue;
      for (const other of Object.keys(mapping) as ProductField[]) if (other !== f && mapping[other] === header) delete mapping[other];
      mapping[f] = header;
    }
    if (explicit.size) notes.push('Colunas ajustadas manualmente.');
  }

  if (!mapping.barcode && !explicit.has('barcode')) {
    const taken = new Set(Object.values(mapping));
    let best: { header: string; ratio: number } | null = null;
    for (const h of headers) {
      if (taken.has(h)) continue;
      const { ratio, n } = barcodeRatio(rows, h);
      if (n >= 3 && ratio >= 0.8 && (!best || ratio > best.ratio)) best = { header: h, ratio };
    }
    if (best) {
      mapping.barcode = best.header;
      notes.push(`Coluna «${best.header}» reconhecida como CÓDIGO DE BARRAS pelo conteúdo (${Math.round(best.ratio * 100)} % dos valores têm 8–14 dígitos).`);
    } else if (mapping.code) {
      const { ratio, n } = barcodeRatio(rows, mapping.code);
      if (n >= 3 && ratio >= 0.8) {
        barcodeFromCode = true;
        notes.push(`A coluna «${mapping.code}» contém códigos de barras (EAN) — vão ser usados também como código de barras.`);
      }
    }
  }

  const used = new Set(Object.values(mapping));
  return { mapping, unmapped: headers.filter((h) => !used.has(h)), notes, barcodeFromCode };
}
