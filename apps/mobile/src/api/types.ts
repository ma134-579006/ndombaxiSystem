/**
 * Tipos que espelham EXACTAMENTE os contratos da API NEXUS (back-office).
 * Mantidos alinhados com os controladores/serviços do `apps/api`.
 */

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

// ── Dashboard (dashboard.service.ts) ─────────────────────────
export interface SalesSummary {
  invoiceCount: number;
  netTotal: number;
  ivaTotal: number;
  grossTotal: number;
  averageTicket: number;
}

export type SalesRange = 'today' | 'yesterday' | '7d' | '1m' | '3m' | '6m' | '1y';
export type SeriesGranularity = 'hour' | 'day' | 'week' | 'month';

export interface SalesSeriesPoint {
  bucket: string;
  grossTotal: number;
  ivaTotal: number;
  invoiceCount: number;
}

export interface SalesSeries {
  range: SalesRange;
  granularity: SeriesGranularity;
  points: SalesSeriesPoint[];
  summary: SalesSummary;
}

export interface TopProduct {
  productCode: string;
  description: string;
  quantity: number;
  grossTotal: number;
}

export interface LowStockItem {
  productCode: string;
  productName: string;
  warehouseCode: string;
  quantity: number;
  minQty: number;
}

// ── Encomendas online (web_orders) ───────────────────────────
export type OrderStatus = 'PENDING' | 'PAID' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

export interface WebOrder {
  id: string;
  order_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  customer_tax_id: string | null;
  shipping_address: string | null;
  province: string | null;
  municipality: string | null;
  neighborhood: string | null;
  payment_method: string | null;
  status: OrderStatus | string;
  net_total: string;
  iva_total: string;
  gross_total: string;
  invoice_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebOrderItem {
  id: string;
  order_id: string;
  line_number: number;
  product_id: string | null;
  product_code: string;
  description: string;
  quantity: string;
  unit_price: string;
  iva_code: string;
  iva_rate: string;
  net_amount: string;
  iva_amount: string;
  gross_amount: string;
}

export interface WebOrderDetail extends WebOrder {
  items: WebOrderItem[];
}

export interface OrderMessage {
  id: string;
  order_id: string;
  sender_type: 'CUSTOMER' | 'STAFF' | 'ASSISTANT' | string;
  sender_id: string | null;
  sender_name: string;
  body: string;
  created_at: string;
}

// ── Eventos WebSocket (realtime.service.ts) ──────────────────
export interface SaleEmittedEvent {
  number: string;
  grossTotal: number;
  ivaTotal: number;
  at: string;
}

// ── Equipa & Lojas (staff module) ────────────────────────────
export interface Store {
  id: string;
  code: string;
  name: string;
  address: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: string;
  store_id: string | null;
  two_fa_enabled: boolean;
  is_active: boolean;
  must_reset_pw: boolean;
  has_pin: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface CreatedStaff {
  user: StaffUser;
  /** Só presente quando a senha foi gerada automaticamente. */
  temporaryPassword?: string;
}

export interface CreateStaffInput {
  name: string;
  email: string;
  role: string;
  storeId?: string;
  pin?: string;
}

export interface CreateStoreInput {
  code: string;
  name: string;
  address?: string;
  isDefault?: boolean;
}
