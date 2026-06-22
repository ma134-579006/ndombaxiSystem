/** Tipos que espelham os contratos públicos do storefront (store/:code/...). */

export interface SiteSettings {
  brand_name: string | null;
  tagline: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  secondary_color: string;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  social: unknown;
  is_published: boolean;
}

export interface SitePage {
  id: string;
  slug: string;
  title: string;
  blocks: unknown;
  is_published: boolean;
  sort_order: number;
}

export interface SiteResponse {
  store: string;
  settings: SiteSettings;
  pages: SitePage[];
}

export type IvaCode = 'NOR' | 'RED' | 'ISE' | 'OUT';

export interface CatalogProduct {
  code: string;
  name: string;
  description: string | null;
  ivaCode: IvaCode;
  netPrice: number;
  grossPrice: number;
  inStock: boolean;
  stockQty?: number;
  imageUrl: string | null;
  gallery: string[];
  category?: string | null;
}

export interface CatalogResponse {
  store: string;
  products: CatalogProduct[];
}

export interface PaymentMethod {
  id: string;
  type: string; // BANK_TRANSFER | REFERENCE | MULTICAIXA_EXPRESS | CASH
  label: string;
  instructions: string | null;
  bank_name: string | null;
  iban: string | null;
  account_holder: string | null;
  reference_entity: string | null;
  reference_number: string | null;
  express_phone: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface CheckoutLine {
  productCode: string;
  quantity: number;
}

export interface CheckoutInput {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  customerTaxId?: string;
  shippingAddress?: string;
  province: string;
  municipality: string;
  neighborhood: string;
  paymentMethod?: string;
  /** Localização GPS do cliente (entrega) — obrigatória na loja. */
  geoLat?: number;
  geoLng?: number;
  geoAccuracy?: number;
  geoConsent?: boolean;
  lines: CheckoutLine[];
}

export interface CheckoutResult {
  id: string;
  orderNumber: string;
  grossTotal: number;
}

export interface WebOrderItem {
  id: string;
  line_number: number;
  product_code: string;
  description: string;
  quantity: string;
  unit_price: string;
  gross_amount: string;
}

export interface WebOrder {
  id: string;
  order_number: string;
  customer_name: string;
  status: string;
  payment_method: string | null;
  net_total: string;
  iva_total: string;
  gross_total: string;
  province: string | null;
  municipality: string | null;
  neighborhood: string | null;
  shipping_address: string | null;
  created_at: string;
  items: WebOrderItem[];
}

export interface OrderMessage {
  id: string;
  order_id: string;
  sender_type: 'CUSTOMER' | 'STAFF' | 'ASSISTANT' | string;
  sender_name: string;
  body: string;
  created_at: string;
}

export interface UploadProofInput {
  methodType?: string;
  amount?: number;
  reference?: string;
  fileName?: string;
  fileMime?: string;
  fileData?: string;
}

export interface ExpressPayInput {
  expressPhone: string;
  reference?: string;
}

// ── Conta do cliente (login simples / Google) ───────────────
export interface CustomerInfo { email: string; name: string }
export interface StoreChatMessage {
  id: string; customer_id: string; sender_type: 'CUSTOMER' | 'STAFF'; sender_id: string | null; sender_name: string; body: string; created_at: string;
}
export interface CustomerSession { token: string; customer: CustomerInfo }
export interface CustomerProfile {
  name: string; email: string;
  phone: string | null; address: string | null;
  province: string | null; municipality: string | null; neighborhood: string | null;
  taxId: string | null;
}
export interface MyOrderRow {
  id: string;
  order_number: string;
  status: string;
  payment_method: string | null;
  gross_total: string;
  created_at: string;
}
