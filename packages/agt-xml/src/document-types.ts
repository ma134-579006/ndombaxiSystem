/**
 * Fiscal document types recognised by AGT (§7). The string value is the
 * SAF-T document-type prefix used in the document number (e.g. "FT").
 */
export enum DocumentType {
  /** Factura. */
  FT = 'FT',
  /** Factura-recibo (venda a dinheiro). */
  FS = 'FS',
  /** Nota de crédito. */
  NC = 'NC',
  /** Nota de débito. */
  ND = 'ND',
  /** Recibo. */
  RC = 'RC',
  /** Guia de remessa. */
  GR = 'GR',
  /** Orçamento (não fiscal, sem impacto em IVA). */
  ORC = 'ORC',
}

/** Document types that move the IVA ledger and must appear in SAF-T SalesInvoices. */
const FISCAL_TYPES = new Set<DocumentType>([
  DocumentType.FT,
  DocumentType.FS,
  DocumentType.NC,
  DocumentType.ND,
]);

/** Credit-side documents that reduce previously declared tax. */
const CREDIT_TYPES = new Set<DocumentType>([DocumentType.NC]);

export function isFiscalDocument(type: DocumentType): boolean {
  return FISCAL_TYPES.has(type);
}

export function isCreditDocument(type: DocumentType): boolean {
  return CREDIT_TYPES.has(type);
}

export function isDocumentType(value: string): value is DocumentType {
  return (Object.values(DocumentType) as string[]).includes(value);
}
