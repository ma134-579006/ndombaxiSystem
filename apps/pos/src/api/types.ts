/** Tipos que espelham os contratos reais do backend POS (apps/api/src/pos). */

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface TenantLoginInput {
  companyCode?: string;
  email: string;
  password: string;
  twoFaToken?: string;
}

/** Códigos de IVA de Angola (AGT §7.1) — fixos pela autoridade tributária. */
export type IvaCode = 'NOR' | 'RED' | 'ISE' | 'OUT';

/** Percentagem legal por código (14 = 14%). */
export const IVA_RATE: Record<IvaCode, number> = {
  NOR: 14,
  RED: 5,
  ISE: 0,
  OUT: 0,
};

export interface Product {
  id: string;
  code: string;
  barcode: string | null;
  name: string;
  description: string | null;
  category_id: string | null;
  iva_code: IvaCode;
  unit_price: string; // NUMERIC → string (preço líquido, antes de IVA)
  stock_qty: string;
  image_url: string | null;
  gallery: unknown;
  show_online: boolean;
  is_active: boolean;
}

export interface Customer {
  id: string;
  tax_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
}

export interface EmitInvoiceLine {
  productCode: string;
  quantity: number;
  discountRate?: number;
}

export interface EmitInvoiceInput {
  docType?: string; // default FT
  series?: string; // default A
  customerId?: string;
  lines: EmitInvoiceLine[];
}

export interface EmittedInvoice {
  id: string;
  number: string;
  hash: string;
  previousHash: string;
  netTotal: number;
  ivaTotal: number;
  grossTotal: number;
}

/** Identidade da empresa (logo + dados) para os documentos. */
export interface DocumentIdentity {
  companyName: string;
  nif: string;
  brandName: string | null;
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  copyright: string;
}

/** Informação fiscal imprimível no recibo (config do Super Admin). */
export interface ReceiptFiscalInfo {
  subscribed: boolean;
  environment: string;
  softwareCertificateNumber: string;
  productId: string;
  productVersion: string;
  receiptLegend: string | null;
  fields: { label: string; value: string }[];
}
