import { DocumentType } from './document-types';
import { IvaCode } from './iva';

/** A single invoice line as supplied by the POS before tax computation. */
export interface InvoiceLineInput {
  productCode: string;
  description: string;
  /** Quantity sold. */
  quantity: number;
  /** Unit price NET of IVA, in AOA. */
  unitPrice: number;
  ivaCode: IvaCode;
  /** Line-level discount as a fraction [0,1] applied to net before IVA. */
  discountRate?: number;
  /** Required when ivaCode is ISE/OUT (AGT exemption reason text). */
  exemptionReason?: string;
  /** AGT exemption code (e.g. "M07") when applicable. */
  exemptionCode?: string;
}

/** A computed invoice line, with net/IVA/gross resolved. */
export interface InvoiceLineComputed extends InvoiceLineInput {
  ivaRate: number;
  /** Net amount after discount (taxable base). */
  netAmount: number;
  ivaAmount: number;
  grossAmount: number;
}

/** Totals grouped by IVA code, for the SAF-T tax table. */
export interface TaxGroupTotal {
  ivaCode: IvaCode;
  ivaRate: number;
  netTotal: number;
  ivaTotal: number;
}

export interface InvoiceTotals {
  netTotal: number;
  ivaTotal: number;
  grossTotal: number;
  byTaxCode: TaxGroupTotal[];
}

/** Minimal document header needed for hashing and SAF-T emission. */
export interface FiscalDocument {
  type: DocumentType;
  /** Full document number, e.g. "FT A/2025/0001". */
  number: string;
  /** Invoice date, ISO yyyy-mm-dd. */
  invoiceDate: string;
  /** System entry timestamp, ISO 8601. */
  systemEntryDate: string;
  customerTaxId?: string;
  lines: InvoiceLineComputed[];
  totals: InvoiceTotals;
  /** Assinatura digital / hash do documento (vai no campo Hash do SAF-T). */
  hash?: string;
}
