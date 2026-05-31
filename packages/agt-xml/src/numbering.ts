import { DocumentType } from './document-types';

/**
 * Sequential fiscal numbering per AGT (§7). Format: "FT A/2025/0001".
 *  - prefix: document type (FT, FS, ...)
 *  - series: letter(s)/code identifying the issuing series/POS (e.g. "A")
 *  - year: fiscal year (4 digits)
 *  - sequence: monotonic per (type, series, year), zero-padded to >= 4 digits
 *
 * The sequence MUST be gapless and never reused; the caller (POS module) is
 * responsible for allocating it atomically (DB sequence per series).
 */

const SERIES_RE = /^[A-Z0-9]{1,5}$/;
const PAD = 4;

export interface DocumentNumberParts {
  type: DocumentType;
  series: string;
  year: number;
  sequence: number;
}

export function formatDocumentNumber(parts: DocumentNumberParts): string {
  const { type, series, year, sequence } = parts;
  if (!SERIES_RE.test(series)) {
    throw new Error(`Invalid series "${series}": expected 1-5 chars [A-Z0-9]`);
  }
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new Error(`Invalid year ${year}`);
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Invalid sequence ${sequence}: must be a positive integer`);
  }
  const seq = String(sequence).padStart(PAD, '0');
  return `${type} ${series}/${year}/${seq}`;
}

const PARSE_RE = /^([A-Z]+) ([A-Z0-9]{1,5})\/(\d{4})\/(\d{4,})$/;

export function parseDocumentNumber(value: string): DocumentNumberParts {
  const m = PARSE_RE.exec(value);
  if (!m) {
    throw new Error(`Malformed document number: "${value}"`);
  }
  const [, type, series, year, seq] = m;
  if (!(Object.values(DocumentType) as string[]).includes(type)) {
    throw new Error(`Unknown document type "${type}" in "${value}"`);
  }
  return {
    type: type as DocumentType,
    series,
    year: Number(year),
    sequence: Number(seq),
  };
}
