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

export type PaymentType = 'CASH' | 'CARD' | 'TRANSFER' | 'REFERENCE' | 'EXPRESS' | 'CREDIT';

export interface EmitInvoiceInput {
  docType?: string; // default FT
  series?: string; // default A
  customerId?: string;
  paymentType?: PaymentType;
  tendered?: number;
  changeGiven?: number;
  /** Vencimento da dívida (venda a crédito); default +30 dias no servidor. */
  dueDate?: string;
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

/** Turno de caixa aberto. */
export interface CashSession {
  id: string;
  register_code: string | null;
  opened_by_name: string | null;
  opened_at: string;
  opening_float: string;
  status: string;
}
/** Resumo do fecho de turno (para o recibo de fecho). */
export interface ShiftClose {
  sessionId: string;
  openedByName: string | null;
  openedAt: string;
  closedAt: string;
  openingFloat: number;
  salesTotal: number;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  expected: number;
  counted: number;
  difference: number;
  verdict: 'OK' | 'QUEBRA' | 'SOBRA';
  salesCount: number;
  products: { productCode: string; description: string; quantity: number; grossTotal: number }[];
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
