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
export type IvaCode = 'NOR' | 'INT' | 'RED' | 'ISE' | 'OUT';

/** Percentagem legal por código (14 = 14%). */
export const IVA_RATE: Record<IvaCode, number> = {
  NOR: 14,
  INT: 7,
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

export interface SaleRow {
  id: string;
  number: string;
  doc_type: string;
  system_entry_date: string;
  gross_total: string;
  status: string; // N=normal, A=anulada
  cashier_name: string | null;
  customer_name: string | null;
  items: string;
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
/** Operador da caixa (funcionário com acesso por PIN). */
export interface Operator { id: string; name: string; role: string; store_id?: string | null; store_name?: string | null; photo_url?: string | null }

/** Resposta do /auth/operators: empresa resolvida (por e-mail ou código) +
 *  operadores; `choices` quando o e-mail existe em várias empresas. */
export interface OperatorsResponse {
  companyCode: string | null;
  companyName: string | null;
  operators: Operator[];
  choices?: { code: string; name: string }[];
}

export interface CashSession {
  id: string;
  register_code: string | null;
  opened_by_name: string | null;
  opened_at: string;
  opening_float: string;
  status: string;
}
/** Mensagem do chat de equipa 1:1 (caixa ↔ gerente). */
export interface ChatMessage {
  id: string; sender_id: string | null; recipient_id: string | null; sender_name: string; sender_role: string; body: string; created_at: string;
}
/** Contacto da equipa (com presença online + não-lidas). */
export interface ChatContact {
  id: string; name: string; role: string; online: boolean; last_seen_at: string | null; unread: number; last_at: string | null;
}
/** Mensagem do chat com clientes da loja. */
export interface CustomerChatMessage {
  id: string; customer_id: string; sender_type: 'CUSTOMER' | 'STAFF'; sender_id: string | null; sender_name: string; body: string; created_at: string;
}
/** Cliente da loja (contacto) com presença + não-lidas. */
export interface CustomerContact {
  id: string; name: string; email: string | null; phone: string | null; online: boolean; last_seen_at: string | null; unread: number; last_at: string | null;
}
/** Consumo próprio do funcionário (descontado no salário em RH). */
export interface SelfConsumption {
  id: string; product_code: string; description: string; quantity: string; unit_price: string;
  total: string; reason: string; status: string; created_at: string;
}
/** Adiantamento salarial do funcionário. */
export interface SalaryAdvance {
  id: string; staff_name: string; amount: string; reason: string | null;
  status: string; requested_at: string; reviewer_name: string | null;
  reviewed_at: string | null; review_note: string | null;
  period_year: number | null; period_month: number | null;
}
/** Limite disponível para adiantamento (salário − por descontar). */
export interface AdvanceLimit {
  monthlyPay: number; outstanding: number; available: number; employeeLinked: boolean;
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

/** Relatório X — leitura do turno aberto (sem fechar). */
export interface ReportX {
  type: 'X';
  sessionId: string;
  openedByName: string | null;
  openedAt: string;
  now: string;
  openingFloat: number;
  salesTotal: number;
  salesCount: number;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  byPayment: Record<string, number>;
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
  receiptMessage?: string | null;
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
