/** Tipos dos contratos do painel Super Admin. */

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// ── Dashboard global da plataforma (Super Admin) ───────────
export interface PlatformKpis {
  companies: { total: number; pending: number; active: number; suspended: number; newToday: number; new7d: number };
  subscriptions: { total: number; active: number; inReview: number; pendingPayment: number };
  revenue: { activeMonthlyKz: number; collectedKz: number; pendingKz: number };
  plans: { tier: string; name: string; companies: number; priceKz: number }[];
}
export interface PlatformSeriesPoint { day: string; companies: number; subscriptions: number }
export interface RecentCompany {
  id: string; name: string; code: string; status: string; createdAt: string; plan: { name: string } | null;
}
export interface PlatformLoginInput {
  email: string;
  password: string;
  twoFaToken?: string;
}
export type PlanTier = 'FREE' | 'STARTER' | 'BUSINESS' | 'ENTERPRISE' | 'WHITE_LABEL';

/** Registo público de empresa (espelha RegisterCompanyDto da API). */
export interface RegisterCompanyInput {
  companyCode: string;
  name: string;
  nif: string;
  responsibleName: string;
  responsibleEmail: string;
  responsiblePhone?: string;
  sector?: string;
  planTier: PlanTier;
}
export interface RegisterCompanyResult {
  companyId: string;
  companyCode: string;
  status: string;
  adminEmail: string;
  temporaryPassword: string;
  setupToken: string;
}

/** Plano público (landing) — preço em Kwanzas. */
export interface PublicPlan {
  id: string;
  tier: PlanTier;
  name: string;
  priceKz: number;
  durationMonths: number;
  durationDays: number;
  maxStores: number;
  maxUsers: number;
  maxProducts: number;
  maxTxPerMonth: number;
  modules: string[];
  tagline: string | null;
  highlight: boolean;
  sortOrder: number;
  isPublic: boolean;
}

// ── Subscrições & pagamento da plataforma ──────────────────
export interface BankAccount {
  id: string;
  bankName: string;
  accountHolder: string;
  iban: string;
  isActive: boolean;
  sortOrder: number;
}
export type SubStatus = 'PENDING_PAYMENT' | 'IN_REVIEW' | 'ACTIVE' | 'REJECTED' | 'EXPIRED';
export interface SubMessage {
  id: string;
  sender: 'COMPANY' | 'ADMIN';
  senderName: string | null;
  body: string;
  createdAt: string;
}
export interface Subscription {
  id: string;
  companyId: string;
  planId: string;
  method: 'IBAN' | 'REFERENCE';
  status: SubStatus;
  amountKz: number;
  durationMonths: number;
  durationDays?: number;
  isTrial?: boolean;
  bankAccountId: string | null;
  reference: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  plan?: { name: string; tier: string };
  company?: { name: string; code: string };
  payments?: { id: string; fileName: string; fileType?: string; fileData?: string; createdAt: string; amountKz: number | null; note?: string | null }[];
  messages?: SubMessage[];
}

export interface LandingFeature { icon?: string; title: string; text: string }
export interface LandingAd { title: string; text?: string; imageUrl?: string; ctaLabel?: string; ctaUrl?: string; active?: boolean }

/** Conteúdo da landing pública (editável pelo Super Admin). */
export interface LandingConfig {
  brandName: string;
  heroTitle: string;
  heroSubtitle: string;
  heroCtaPrimary: string;
  heroCtaSecondary: string;
  heroImageUrl: string | null;
  heroImages: string[];
  heroIntervalMs: number;
  primaryColor: string;
  accentColor: string;
  features: LandingFeature[];
  ads: LandingAd[];
  footerText: string;
  contactEmail: string | null;
  contactPhone: string | null;
  showPricing: boolean;
  showAds: boolean;
  trialDays: number;
}
export interface PublicLanding { config: LandingConfig; plans: PublicPlan[] }

export interface MailConfigView {
  host: string | null; port: number; secure: boolean;
  username: string | null; fromAddr: string | null; enabled: boolean;
  hasPassword: boolean; passwordMask: string | null; source: 'db' | 'env' | 'none';
}
export interface MailConfigInput {
  host?: string; port?: number; secure?: boolean; username?: string;
  password?: string; fromAddr?: string; enabled?: boolean;
}

export interface TenantLoginInput {
  /** Opcional — a empresa é encontrada pelo e-mail; só é preciso para
   *  desempatar quando o mesmo e-mail existe em várias empresas. */
  companyCode?: string;
  email: string;
  password: string;
  twoFaToken?: string;
}

/** Resposta de login do tenant: tokens + empresa resolvida pelo e-mail. */
export interface TenantTokenPair extends TokenPair {
  companyCode: string;
  companyName: string;
}

// ════════════════════════════════════════════════════════════
// Back-office do GESTOR da empresa (login tenant)
// ════════════════════════════════════════════════════════════

/** Código de IVA de Angola (AGT §7.1). */
export type IvaCode = 'NOR' | 'INT' | 'RED' | 'ISE' | 'OUT';
export const IVA_RATE: Record<IvaCode, number> = { NOR: 14, INT: 7, RED: 5, ISE: 0, OUT: 0 };

/** Produto tal como devolvido por GET /pos/products (NUMERIC vem como string). */
export interface ManagerProduct {
  id: string;
  code: string;
  barcode: string | null;
  name: string;
  description: string | null;
  category_id: string | null;
  brand: string | null;
  iva_code: IvaCode;
  exemption_reason: string | null;
  exemption_code: string | null;
  unit_price: string;
  cost_price: string;
  stock_qty: string;
  image_url: string | null;
  gallery: unknown;
  show_online: boolean;
  shared_stock: boolean;
  is_ingredient?: boolean;
  is_production?: boolean;
  /** Unidade de medida (un, kg, g, L, ml, fatia, folha…). */
  unit?: string | null;
  /** TRUE = tem ficha técnica (pode ser produzido em fornada / vendido sob encomenda). */
  has_recipe?: boolean;
  /** Doses possíveis com o stock atual dos ingredientes. */
  portions_available?: string | number | null;
  is_active: boolean;
}
export interface CreateProductInput {
  /** Código de barras — opcional: vazio gera um EAN-13 automaticamente. */
  code?: string;
  barcode?: string;
  name: string;
  description?: string;
  categoryId?: string;
  brand?: string;
  ivaCode: IvaCode | 'AUTO';
  exemptionReason?: string;
  exemptionCode?: string;
  unitPrice: number;
  costPrice?: number;
  stockQty?: number;
  storeIds?: string[];
  sharedStock?: boolean;
  imageUrl?: string;
  showOnline?: boolean;
  isIngredient?: boolean;
  isProduction?: boolean;
  unit?: string;
}
export interface UpdateProductInput {
  name?: string;
  description?: string;
  categoryId?: string;
  brand?: string;
  ivaCode?: IvaCode | 'AUTO';
  exemptionReason?: string;
  exemptionCode?: string;
  unitPrice?: number;
  costPrice?: number;
  stockQty?: number;
  imageUrl?: string;
  showOnline?: boolean;
  sharedStock?: boolean;
  isActive?: boolean;
  isIngredient?: boolean;
  isProduction?: boolean;
  unit?: string;
}

/** Encomenda online (web_orders). Campos snake_case do raw SQL. */
export type OrderStatus = 'PENDING' | 'PAID' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
export interface WebOrder {
  id: string;
  order_number: string;
  status: OrderStatus;
  customer_name: string | null;
  customer_phone: string | null;
  customer_tax_id: string | null;
  province: string | null;
  municipality: string | null;
  neighborhood: string | null;
  payment_method: string | null;
  payment_entity?: string | null;
  payment_reference?: string | null;
  net_total: string;
  iva_total: string;
  gross_total: string;
  invoice_id: string | null;
  /** Cozinha (restauração): tempo estimado dado pelo cozinheiro e estado de produção. */
  prep_eta_min?: number | null;
  kitchen_status?: string | null;
  created_at: string;
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
export interface WebOrderDetail extends WebOrder {
  items: WebOrderItem[];
}

/** Localização GPS do cliente de uma encomenda (entrega, tempo real). */
export interface OrderLocation {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  customerName: string;
  customerPhone: string | null;
  province: string | null;
  municipality: string | null;
  neighborhood: string | null;
  shippingAddress: string | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  consent: boolean;
  updatedAt: string | null;
}

/** Pedido de adiantamento salarial (vista do gestor — sino de notificações). */
export interface SalaryAdvanceReq {
  id: string;
  staff_name: string;
  amount: string;
  reason: string | null;
  status: string;
  requested_at: string;
  monthly_pay: string | null;
}

/** Branding da montra (site_settings). */
export interface SiteSettings {
  id: string;
  brand_name: string | null;
  tagline: string | null;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  receipt_message: string | null;
  default_iva_code: string;
  is_published: boolean;
  online_store_enabled: boolean;
}
export interface UpdateSiteSettingsInput {
  brandName?: string;
  tagline?: string;
  logoUrl?: string;
  onlineStoreEnabled?: boolean;
  defaultIvaCode?: string;
  primaryColor?: string;
  secondaryColor?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  receiptMessage?: string;
  isPublished?: boolean;
}

/** Métodos de pagamento da loja (configurados pelo gerente). */
export type PaymentMethodType = 'BANK_TRANSFER' | 'REFERENCE' | 'MULTICAIXA_EXPRESS' | 'CASH';
export interface StorePaymentMethod {
  id: string;
  type: PaymentMethodType;
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
export interface PaymentMethodInput {
  type: PaymentMethodType;
  label?: string;
  instructions?: string;
  bankName?: string;
  iban?: string;
  accountHolder?: string;
  referenceEntity?: string;
  referenceNumber?: string;
  expressPhone?: string;
  /** Segredo do callback EMIS do gestor (write-only). */
  callbackSecret?: string;
  isActive?: boolean;
  sortOrder?: number;
}
/** Comprovativo de pagamento enviado por um cliente da loja. */
export interface PaymentProof {
  id: string;
  order_id: string;
  method_type: string;
  amount: string | null;
  reference: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_url: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  note: string | null;
  uploaded_at: string;
}

// ── Integrações externas (Super Admin) ──────────────────────
export interface IntegrationField { name: string; label: string }
export interface Integration {
  key: string; label: string; description: string;
  hasBaseUrl: boolean; baseUrlLabel: string;
  settingsFields: IntegrationField[]; secretLabel: string;
  enabled: boolean; environment: 'TEST' | 'PRODUCTION';
  baseUrl: string | null; settings: Record<string, string>;
  hasSecret: boolean; lastStatus: string | null; lastTestAt: string | null;
}
export interface UpdateIntegrationInput {
  enabled?: boolean; environment?: 'TEST' | 'PRODUCTION';
  baseUrl?: string; settings?: Record<string, string>; secret?: string;
}

// ── Empresas (tenants) ───────────────────────────────────────
export type CompanyStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
export interface Plan {
  id: string;
  tier: string;
  name: string;
}

// ── Caixa / Auditoria / Inventário (gestor) ────────────────
export interface AuditEvent {
  seq: number;
  timestamp: string;
  actor_name: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
}
export interface CashSessionRow {
  id: string;
  register_code: string | null;
  opened_by_name: string | null;
  opened_at: string;
  closed_by_name: string | null;
  closed_at: string | null;
  opening_float: string;
  counted_cash: string | null;
  expected_cash: string | null;
  difference: string | null;
  status: string;
  total_sales: string;
  sales_count: number;
}
export interface StockCountRow {
  id: string;
  reference: string;
  status: string;
  created_at: string;
  closed_at: string | null;
  warehouse_name: string;
  items: number;
}
export interface StockCountItem {
  id: string;
  product_id: string;
  product_code: string;
  description: string;
  system_qty: string;
  counted_qty: string | null;
  difference: string | null;
}
export interface StockCountDetail {
  id: string;
  reference: string;
  status: string;
  warehouse_id: string;
  items: StockCountItem[];
}
export interface WarehouseRow { id: string; code: string; name: string; is_default: boolean }

/** Movimento de stock (consulta). */
export interface StockMovementRow {
  created_at: string;
  type: string;
  quantity: string;
  balance_after: string;
  reference: string | null;
  product_name: string;
  product_code: string;
  warehouse_name: string | null;
  created_by: string | null;
}
export interface StockEntryInput {
  productId: string; warehouseId: string; quantity: number; unitCost: number; salePrice?: number;
  batchCode?: string; expiryDate?: string; minQty?: number;
}
export interface BatchInput {
  productId: string; warehouseId: string; batchCode?: string; quantity: number; expiryDate?: string;
}
export interface StockAnalysisRow {
  product_id: string; product_code: string; product_name: string;
  category_name: string | null; store_id: string; store_name: string;
  cost_price: string; unit_price: string; quantity: string; stock_value: string;
  units_sold: number; units_in: number; sales_per_day: number; days_left: number | null;
}
export interface StockAnalysis {
  rows: StockAnalysisRow[];
  summary: { stockValue: number; products: number; positive: number; unitsSold: number; forecastValue: number };
  period: { from: string; to: string; days: number };
}
// ── Inventário empresarial (ABC, reposição, valorização, antifraude…) ──
export interface AbcRow {
  productId: string; code: string; name: string; category: string | null;
  stockQty: number; costPrice: number; unitPrice: number;
  salesValue: number; unitsSold: number; rotation: number | null;
  sharePct: number; cumulativePct: number; abcClass: 'A' | 'B' | 'C';
}
export interface AbcReport {
  rows: AbcRow[];
  summary: {
    totalSales: number; products: number;
    aCount: number; bCount: number; cCount: number;
    aValue: number; bValue: number; cValue: number;
  };
  period: { from: string; to: string };
}
export interface ReplenishmentRow {
  productId: string; code: string; name: string; storeId: string; storeName: string;
  location: string | null; quantity: number; minQty: number; soldPeriod: number;
  perDay: number; daysLeft: number | null; suggestedQty: number; suggestedCost: number;
  reason: 'STOCK_MINIMO' | 'ACABA_ANTES_DO_LEAD' | null;
}
export interface ReplenishmentReport {
  rows: ReplenishmentRow[];
  params: { days: number; coverage: number; leadDays: number };
}
export interface ValuationRow {
  productId: string; code: string; name: string; quantity: number;
  value: number; unitValue: number; valueFIFO: number; valueLIFO: number; valueCMP: number;
}
export interface ValuationReport {
  rows: ValuationRow[];
  totals: { FIFO: number; LIFO: number; CMP: number };
  method: string;
}
export interface FraudSignal {
  type: string; severity: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string; detail: string; who?: string | null; count: number;
}
export interface FraudReport { signals: FraudSignal[]; periodDays: number }
export interface LocationRow {
  product_id: string; code: string; name: string;
  store_id: string; store_name: string; quantity: number; location: string | null;
}
export interface TransferRequestRow {
  id: string; status: string; quantity: number; note: string | null; reject_reason: string | null;
  requested_by_name: string | null; approved_by_name: string | null; received_by_name: string | null;
  created_at: string; approved_at: string | null; received_at: string | null;
  product_code: string; product_name: string; from_store: string; to_store: string;
}
export interface AuditTrailRow {
  seq: number; timestamp: string; actor_name: string | null;
  action: string; entity: string | null; entity_id: string | null; details: unknown;
}
export interface AuditFilters {
  actors: Array<{ id: string | null; name: string | null }>;
  actions: string[];
}

export interface DocumentIdentity {
  companyName: string; nif: string; brandName: string | null; logoUrl: string | null;
  address: string | null; phone: string | null; email: string | null;
  receiptMessage?: string | null; businessType?: string; onlineStoreEnabled?: boolean; copyright: string;
}

/** Detalhe de um documento fiscal emitido (2ª via / reimpressão). */
export interface SaleDetailItem { productCode: string; description: string; quantity: number; unitPrice: number; total: number; returnedQuantity: number }
export interface SaleDetail {
  invoice: { id: string; number: string; hash: string; previousHash: string; netTotal: number; ivaTotal: number; grossTotal: number };
  docType: string; date: string; operationDate: string | null; status: string;
  customerName: string | null; cashierName: string | null;
  items: SaleDetailItem[];
}

export interface ReportUserRow { name: string; sales: number; net: number; gross: number }
export interface ReportCategoryRow { name: string; qty: number; net: number; gross: number }
export interface ReportTaxRow { rate: number; net: number; iva: number; gross: number }
export interface ReportPaymentRow { method: string; count: number; total: number }
export interface ReportDocRow {
  number: string; doc_type: string; system_entry_date: string;
  gross_total: string; net_total: string; iva_total: string; status: string;
  customer_tax_id: string | null; store_name: string | null; cashier_name: string | null;
}
export interface ReportCashSession {
  opened_at: string; closed_at: string; opened_by_name: string | null; closed_by_name: string | null;
  opening_float: string; total_sales: string; total_cash_in: string; total_cash_out: string;
  counted_cash: string; expected_cash: string; difference: string; sales_count: number; store_name: string | null;
}

export interface ExpiringBatch {
  id: string; batch_code: string | null; quantity: string;
  expiry_date: string; product_name: string; days_left: number;
}

// ── Conversa das encomendas (admin ↔ cliente) ───────────────
export interface OrderMessage {
  id: string; order_id: string;
  sender_type: 'CUSTOMER' | 'STAFF' | 'ASSISTANT' | string;
  sender_name: string; body: string; created_at: string;
}

// ── Compras (fornecedores + encomendas de compra) ───────────
export interface SupplierRow {
  id: string; code: string; name: string; nif: string | null;
  email: string | null; phone: string | null; address: string | null; is_active: boolean;
}
export interface CreateSupplierInput {
  code: string; name: string; nif?: string; email?: string; phone?: string; address?: string;
}
export interface PurchaseOrderRow {
  id: string; number: string; supplier_id: string; supplier_name: string;
  warehouse_id: string; status: string; order_date: string; expected_date: string | null;
  net_total: string; iva_total: string; gross_total: string; notes: string | null; created_at: string;
}
export interface PurchaseOrderLineInput { productCode: string; quantity: number; unitCost: number }
export interface CreatePurchaseOrderInput {
  supplierId: string; warehouseId: string; expectedDate?: string; notes?: string;
  lines: PurchaseOrderLineInput[];
}

// ── Promoções & Alertas ────────────────────────────────────
export type PromoType = 'PERCENT' | 'AMOUNT' | 'BUY_X_PAY_Y' | 'QTY_TIERED';
export interface Promotion {
  id: string;
  name: string;
  type: PromoType;
  scope: string;
  percent: string | null;
  amount: string | null;
  buy_qty: number | null;
  pay_qty: number | null;
  min_qty: number | null;
  tier_percent: string | null;
  priority: number;
  is_active: boolean;
}
export interface PromotionInput {
  name: string;
  type: PromoType;
  scope?: string;
  percent?: number;
  amount?: number;
  buyQty?: number;
  payQty?: number;
  minQty?: number;
  tierPercent?: number;
  priority?: number;
  isActive?: boolean;
  startTime?: string;
  endTime?: string;
}
export interface OpsAlert {
  level: 'info' | 'warning' | 'danger';
  category: 'STOCK' | 'CASH' | 'SALES';
  title: string;
  detail: string;
}

// ── Dashboard do gestor (visão geral em tempo real) ─────────
export type SalesRange = 'today' | 'yesterday' | '7d' | '1m' | '3m' | '6m' | '1y';
export interface DashSalesSummary {
  invoiceCount: number; netTotal: number; ivaTotal: number; grossTotal: number; averageTicket: number;
}
export interface DashSalesPoint { bucket: string; grossTotal: number; ivaTotal: number; invoiceCount: number; cancelledTotal: number; expenseTotal: number }
export interface DashSalesSeries {
  range: SalesRange; granularity: 'hour' | 'day' | 'week' | 'month';
  points: DashSalesPoint[]; summary: DashSalesSummary;
}
export interface DashTopProduct { productCode: string; description: string; quantity: number; grossTotal: number }
export interface DashLowStock {
  productCode: string; productName: string; warehouseCode: string; quantity: number; minQty: number;
}
export interface DashStoreSales {
  storeId: string; storeName: string; isDefault: boolean; invoiceCount: number; grossTotal: number;
}

// ── Lucros (gestor) ─────────────────────────────────────────
export interface ProfitSummary {
  from: string; to: string;
  salesGross: number; salesNet: number; ivaTotal: number;
  costTotal: number; grossProfit: number; marginPct: number;
  otherExpenses: number; netProfit: number;
  salesCount: number; ticketAvg: number;
  cancelledCount: number; cancelledAmount: number;
}
export interface ProfitPoint { bucket: string; salesNet: number; cost: number; profit: number }
export interface ProfitProduct {
  productCode: string; description: string; qty: number;
  salesNet: number; cost: number; profit: number; marginPct: number;
}
export interface ProfitAbcRow {
  productCode: string; description: string; sales: number;
  sharePct: number; cumulativePct: number; abcClass: 'A' | 'B' | 'C';
}

// ── Despesas operacionais (gestor) ──────────────────────────
export type ExpenseCategory =
  | 'RENDA' | 'SALARIOS' | 'ENERGIA' | 'AGUA' | 'FORNECEDORES' | 'TRANSPORTE'
  | 'MARKETING' | 'MANUTENCAO' | 'IMPOSTOS' | 'COMUNICACOES' | 'SEGURANCA' | 'OUTROS';

/** Rótulos PT-PT das categorias (e ordem de apresentação). */
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  RENDA: 'Renda', SALARIOS: 'Salários', ENERGIA: 'Energia', AGUA: 'Água',
  FORNECEDORES: 'Fornecedores', TRANSPORTE: 'Transporte', MARKETING: 'Marketing',
  MANUTENCAO: 'Manutenção', IMPOSTOS: 'Impostos', COMUNICACOES: 'Comunicações',
  SEGURANCA: 'Segurança', OUTROS: 'Outros',
};
export const EXPENSE_CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[];

export type ExpensePayment = 'CASH' | 'TRANSFER' | 'REFERENCE' | 'CARD';

export interface Expense {
  id: string;
  category: ExpenseCategory;
  description: string | null;
  amount: string;
  supplier: string | null;
  payment_method: ExpensePayment | null;
  document_ref: string | null;
  expense_date: string;
  created_by_name: string | null;
  created_at: string;
}
export interface ExpenseCategoryTotal { category: ExpenseCategory; total: number; count: number }
export interface ExpenseSummary { from: string; to: string; total: number; byCategory: ExpenseCategoryTotal[] }
export interface CreateExpenseInput {
  category: ExpenseCategory;
  amount: number;
  description?: string;
  supplier?: string;
  paymentMethod?: ExpensePayment;
  documentRef?: string;
  expenseDate?: string;
}

// ── Contas a receber (venda a crédito) ──────────────────────
export type ReceivableStatus = 'OPEN' | 'PARTIAL' | 'PAID';
export interface Receivable {
  id: string;
  customer_name: string | null;
  invoice_number: string | null;
  original_amount: string;
  paid_amount: string;
  outstanding: string;
  due_date: string | null;
  status: ReceivableStatus;
  days_overdue: number;
  created_at: string;
}
export interface ReceivablePayment {
  id: string; amount: string; method: string | null; receipt_number: string | null;
  notes: string | null; paid_at: string; created_by_name: string | null;
}
export interface ReceivableDetail extends Receivable { payments: ReceivablePayment[] }
export interface ReceivableSummary { outstanding: number; overdue: number; openCount: number; overdueCount: number }
export interface CreateReceivableInput { customerId?: string; customerName: string; amount: number; dueDate?: string; notes?: string }

// ── Contas a pagar (fornecedores) ───────────────────────────
export type PayableStatus = 'OPEN' | 'PARTIAL' | 'PAID' | 'CANCELLED';
export interface Payable {
  id: string; supplier_name: string | null; reference: string | null;
  original_amount: string; paid_amount: string; outstanding: string;
  due_date: string | null; status: PayableStatus; days_overdue: number; created_at: string;
}
export interface PayablePayment {
  id: string; amount: string; method: string | null; reference_number: string | null;
  notes: string | null; paid_at: string; created_by_name: string | null;
}
export interface PayableDetail extends Payable { payments: PayablePayment[] }
export interface PayableSummary { outstanding: number; overdue: number; openCount: number; overdueCount: number }
export interface CreatePayableInput { supplierId?: string; supplierName: string; amount: number; reference?: string; dueDate?: string; notes?: string }
export interface RecordPayablePaymentInput { amount: number; method?: 'CASH' | 'TRANSFER' | 'REFERENCE' | 'CARD' | 'EXPRESS'; notes?: string }
export interface PayableVoucher { referenceNumber: string; amount: number; paidAmount: number; outstanding: number; status: PayableStatus }

// ── Comissões de vendedores (gestor) ────────────────────────
export interface CommissionRow {
  userId: string; name: string; rate: number; sales: number; salesCount: number; commission: number;
}
export interface CommissionReport {
  from: string; to: string; rows: CommissionRow[]; totalSales: number; totalCommission: number;
}

// ── Equipa (utilizadores/credenciais) + Lojas (RBAC) ────────
export type StaffRoleName =
  | 'COMPANY_ADMIN' | 'REGIONAL_MANAGER' | 'STORE_MANAGER'
  | 'SHIFT_SUPERVISOR' | 'CASHIER' | 'ATTENDANT';
export const STAFF_ROLE_LABELS: Record<StaffRoleName, string> = {
  COMPANY_ADMIN: 'Administrador', REGIONAL_MANAGER: 'Gerente regional',
  STORE_MANAGER: 'Gerente de loja', SHIFT_SUPERVISOR: 'Supervisor de turno',
  CASHIER: 'Operador de caixa', ATTENDANT: 'Atendente',
};
export const STAFF_ROLES = Object.keys(STAFF_ROLE_LABELS) as StaffRoleName[];

export interface ManagerStore {
  id: string; code: string; name: string; address: string | null;
  is_default: boolean; is_active: boolean;
}
export interface ManagerStaff {
  id: string; email: string; name: string; role: StaffRoleName;
  store_id: string | null; two_fa_enabled: boolean; is_active: boolean;
  must_reset_pw: boolean; has_pin: boolean; photo_url: string | null; last_login_at: string | null;
  locked_until: string | null;
}
export interface CreateStoreInput { code: string; name: string; address?: string; isDefault?: boolean }
export interface UpdateStoreInput { name?: string; address?: string; isActive?: boolean; isDefault?: boolean }
export interface CreateStaffInput { name: string; email: string; role: StaffRoleName; storeId?: string; password?: string; pin?: string }
export interface UpdateStaffInput { name?: string; role?: StaffRoleName; storeId?: string; isActive?: boolean; photoUrl?: string }
export interface CreatedStaff { user: ManagerStaff; temporaryPassword?: string }
export interface ChatMessage { id: string; sender_id: string | null; recipient_id: string | null; sender_name: string; sender_role: string; body: string; created_at: string }
export interface ChatContact { id: string; name: string; role: string; online: boolean; last_seen_at: string | null; unread: number; last_at: string | null }
export interface CustomerChatMessage { id: string; customer_id: string; sender_type: 'CUSTOMER' | 'STAFF'; sender_id: string | null; sender_name: string; body: string; created_at: string }
export interface CustomerContact { id: string; name: string; email: string | null; phone: string | null; online: boolean; last_seen_at: string | null; unread: number; last_at: string | null }
export interface RestaurantTableMapRow { id: string; code: string; name: string; area: string | null; seats: number; order_id: string | null; order_total: string | null; guests: number | null; opened_at_label: string | null }
export interface RestaurantOrderItem { id: string; product_code: string; description: string; unit_price: string; quantity: string; kitchen_status: string; notes: string | null; created_at: string }
export interface RestaurantOrderDetail { order: { id: string; table_name: string | null; status: string; total: string; guests: number; customer_name: string | null }; items: RestaurantOrderItem[] }
export interface RestaurantKitchenItem { id: string; product_id?: string | null; description: string; quantity: string; kitchen_status: string; notes: string | null; created_at: string; table_name: string | null; order_id: string; prep_eta_min?: number | null; priority?: number; is_counter?: boolean }
export interface RestaurantOnlineTicket {
  id: string; orderNumber: string; customerName: string; paymentStatus: string;
  kitchenStatus: string; etaMin: number | null; waitMin: number;
  items: { product_id?: string | null; description: string; quantity: string }[];
}
export interface RestaurantDashboard {
  service: { tablesTotal: number; tablesOpen: number; occupancyPct: number; guestsSeated: number; openValue: number; avgTab: number };
  kitchen: { pending: number; preparing: number; queue: number; oldestWaitMin: number; online?: number };
  today: { closedCount: number; revenue: number; avgTicket: number };
  sales: { total: number; online: number; counter: number; invoices: number; dineIn: number };
  menu: { dishesWithRecipe: number; outOfStock: number; lowStock: number };
}
export interface HotelDashboardArrival { id: string; number: string; guest: string; room: string; nights: number }
export interface HotelDashboardDeparture { id: string; number: string; guest: string; room: string; total: number }
export interface HotelDashboard {
  rooms: { total: number; available: number; occupied: number; cleaning: number; maintenance: number; blocked: number; occupancyPct: number };
  inHouse: { reservations: number; guests: number; openFolioValue: number };
  today: { arrivals: HotelDashboardArrival[]; departures: HotelDashboardDeparture[]; pendingOnline: number };
  ops: { housekeepingPending: number; maintenanceOpen: number };
  sales: { total: number; online: number; counter: number; invoices: number };
}
export interface ClinicAgendaItem { id: string; time: string; patient: string; professional: string; reason: string; overdue: boolean }
export interface ClinicHospitalKpis {
  admitted: number; bedsFree: number; bedsTotal: number; emergencyWaiting: number;
  emergencyRed: number; onCallDoctors: number; examsPending: number; rxToDispense: number;
}
export interface ClinicDashboard {
  today: { scheduled: number; done: number; noShow: number; cancelled: number; overdue: number; agenda: ClinicAgendaItem[] };
  patients: { active: number; newToday: number };
  hospital?: ClinicHospitalKpis;
  sales: { total: number; online: number; counter: number; invoices: number };
}
// ── HOSPITAL (HIS) ──
export interface ClinicProfessional { id: string; name: string; category: string; license_number: string | null; specialty: string | null; subspecialty: string | null; office: string | null; schedule: string | null; on_call: boolean; is_active: boolean }
export interface ClinicMedication { id: string; code: string; name: string; active_ingredient: string | null; requires_prescription: boolean; stock_qty: string; unit: string | null; next_expiry: string | null }
export interface ClinicPrescriptionRow { id: string; number: string; patient_name: string | null; professional: string | null; status: string; issued_at: string; dispensed_at: string | null; item_count: number; invoice_id?: string | null; has_billable?: boolean }
export interface ClinicPrescriptionItem { id: string; product_id: string | null; medication: string; dosage: string | null; posology: string | null; route: string | null; duration: string | null; quantity: string; dispensed_qty: string; product_code?: string | null; product_stock?: string | null }
export interface ClinicPrescriptionDetail { prescription: ClinicPrescriptionRow & { notes: string | null; patient_id: string | null }; items: ClinicPrescriptionItem[] }
export interface ClinicBed { id: string; code: string; ward: string; room: string | null; status: string; daily_rate: string; admission_id: string | null; admitted_patient: string | null; admitted_at: string | null }
export interface ClinicAdmission { id: string; number: string; patient_name: string | null; bed_label: string | null; professional: string | null; reason: string | null; status: string; daily_rate: string; total: string; admitted_at: string; discharged_at: string | null; invoice_id: string | null }
export interface ClinicTriageRow { id: string; patient_name: string; complaint: string | null; risk: string; room: string | null; professional: string | null; status: string; arrived_at: string; wait_min: number }
export interface ClinicExamRow { id: string; patient_name: string | null; exam_type: string; requested_by: string | null; status: string; result_text: string | null; fee: string; requested_at: string; done_at: string | null; invoice_id: string | null }
export interface ClinicInsurer { id: string; name: string; plan: string | null; coverage_pct: string; is_active: boolean }
export interface ClinicClaim { id: string; insurer_name: string | null; patient_name: string | null; source_type: string; gross_total: string; covered: string; copay: string; status: string; created_at: string }
export interface ClinicVitalsRow { id: string; recorded_at: string; temperature_c: string | null; systolic: number | null; diastolic: number | null; heart_rate: number | null; resp_rate: number | null; spo2: number | null; weight_kg: string | null; height_cm: string | null; notes: string | null }
export interface ClinicPatientRecord {
  patient: Record<string, unknown>;
  consultations: Array<Record<string, unknown>>;
  prescriptions: Array<Record<string, unknown>>;
  vitals: ClinicVitalsRow[];
  admissions: Array<Record<string, unknown>>;
  exams: Array<Record<string, unknown>>;
}
export interface ServiceOrderRow { id: string; number: string; customer_name: string | null; equipment_label: string | null; status: string; total: string; assigned_to: string | null; source?: string; created_at: string }
export interface ServiceOrderItem { id: string; kind: string; product_code: string | null; description: string; unit_price: string; quantity: string; created_at: string }
export interface ServiceChecklistItem { key: string; label: string; ok?: boolean; note?: string }
export interface ServiceReceptionPhoto { url: string; caption?: string }
export interface ServiceOrderDetail { order: { id: string; number: string; customer_name: string | null; customer_phone: string | null; equipment_id?: string | null; equipment_type: string | null; equipment_label: string | null; equipment_ref: string | null; problem: string | null; diagnosis: string | null; status: string; total: string; assigned_to: string | null; notes: string | null; warranty_days?: number; warranty_until?: string | null; invoice_id?: string | null;
  // Mecânica (oficina auto)
  km_in?: number | null; fuel_level?: string | null; vehicle_state?: string | null;
  checklist?: ServiceChecklistItem[] | null; photos?: ServiceReceptionPhoto[] | null; signature?: string | null;
  est_minutes?: number | null; actual_minutes?: number | null; work_started_at?: string | null;
  scheduled_at?: string | null; received_at?: string | null; quote_approved_at?: string | null; quote_approved_by?: string | null;
  imei?: string | null; unlock_code?: string | null; track_token?: string | null;
}; items: ServiceOrderItem[] }
export interface ServiceAgendaRow { id: string; number: string; customer_name: string | null; equipment_label: string | null; equipment_ref: string | null; status: string; scheduled_at: string; assigned_to: string | null }
export interface ServiceEquipment { id: string; customer_id: string | null; customer_name: string | null; kind: string; label: string; brand: string | null; model: string | null; serial: string | null; plate: string | null; vin: string | null; color: string | null; year: number | null; km: number | null; next_service_km: number | null; notes: string | null }

// ── Hotelaria (HOSPITALITY) ─────────────────────────────────
export interface HotelRoomMapRow {
  id: string; code: string; name: string; room_type: string | null; category?: string | null; floor?: string | null; capacity: number; rate: string; photo_url?: string | null; status: string;
  reservation_id: string | null; guest_name: string | null; check_out: string | null; res_total: string | null;
}
export interface HotelHousekeepingRow {
  id: string; room_id: string | null; room_name: string | null; task: string; status: string; assigned_to: string | null; notes: string | null; created_at: string; done_at: string | null;
}
export interface HotelMaintenanceRow {
  id: string; room_id: string | null; room_name: string | null; problem: string; status: string; assigned_to: string | null; created_at: string; done_at: string | null;
}
export interface HotelReservationRow {
  id: string; number: string; room_name: string | null; guest_name: string | null;
  check_in: string; check_out: string; nights: number; status: string; total: string; source?: string;
}
export interface RecipeIngredient { id: string; ingredient_id: string; ingredient_name: string; ingredient_code: string; quantity: string; ingredient_unit?: string | null; waste_pct?: string | number | null }

// ── Farmácia ───────────────────────────────────────────────
export interface PharmacyBatch { id: string; batch_code: string | null; quantity: string; expiry_date: string; days_left: number; product_name: string; product_code: string; active_ingredient: string | null }

// ── Clínica / Saúde ────────────────────────────────────────
export interface ClinicPatient { id: string; name: string; phone: string | null; nif: string | null; birth_date: string | null; sex: string | null; blood_type: string | null; allergies: string | null; notes: string | null; customer_id: string | null }
export interface ClinicConsultationRow { id: string; professional: string | null; symptoms?: string | null; diagnosis: string | null; prescription: string | null; fee: string; invoice_id: string | null; created_at: string }
export interface ClinicPatientDetail { patient: ClinicPatient; consultations: ClinicConsultationRow[] }
export interface ClinicAppointment { id: string; patient_id: string | null; patient_name: string | null; professional: string | null; scheduled_at: string; reason: string | null; status: string }

export interface VerticalKpi { label: string; value: string; hint?: string; tone?: 'ok' | 'warn' | 'info' }
export interface VerticalMetrics { businessType: string; title: string; kpis: VerticalKpi[] }

export interface HotelFolioItem { id: string; product_code: string | null; description: string; unit_price: string; quantity: string; created_at: string }
export interface HotelReservationDetail {
  reservation: { id: string; number: string; room_name: string | null; guest_name: string | null; guest_phone: string | null; check_in: string; check_out: string; nights: number; rate: string; guests: number; status: string; total: string; notes: string | null };
  folio: HotelFolioItem[];
}

// ── Funcionários (RH) ───────────────────────────────────────
export interface ManagerEmployee {
  id: string; employee_number: string; full_name: string;
  tax_id: string | null; inss_number: string | null; position: string | null;
  department: string | null; base_salary: string; iban: string | null;
  photo_url: string | null; status: string;
  bonus?: string; absence_discount_pct?: string;
}
export interface CreateEmployeeInput {
  employeeNumber?: string; fullName: string; position?: string; department?: string;
  baseSalary: number; iban?: string; taxId?: string; inssNumber?: string; photoUrl?: string;
}
export interface UpdateEmployeeInput {
  employeeNumber?: string; fullName?: string; position?: string; department?: string;
  taxId?: string; inssNumber?: string;
  baseSalary?: number; iban?: string; photoUrl?: string;
  /** Bónus/faltas movidos para a folha salarial (no pagamento). Mantidos por compat. */
  bonus?: number;
  absenceDays?: number;
}

// ── Férias / ausências (RH) ─────────────────────────────────
export type LeaveType = 'FERIAS' | 'FALTA' | 'LICENCA' | 'OUTRO';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export interface LeaveRow {
  id: string; employee_name: string | null; type: LeaveType;
  start_date: string; end_date: string; days: number; reason: string | null;
  status: LeaveStatus; reviewed_by_name: string | null; created_at: string;
}
export interface LeaveEmployee { id: string; full_name: string }
export interface LeaveSummary { pending: number; ferasDaysYear: number }
export interface CreateLeaveInput { employeeId: string; type: LeaveType; startDate: string; endDate: string; reason?: string }

// ── Folha salarial (RH · INSS + IRT) ────────────────────────
export interface PayrollRun {
  id: string; period_year: number; period_month: number; status: string;
  employee_count: number; gross_total: string; inss_employee_total: string;
  inss_employer_total: string; irt_total: string; net_total: string;
  employer_cost_total: string; processed_at: string; paid_at: string | null;
}
export interface PayrollItem {
  id: string; employee_number: string; employee_name: string; base_salary: string;
  taxable_allowances: string; exempt_allowances: string; gross_salary: string;
  inss_base: string; inss_employee: string; inss_employer: string; irt_base: string;
  irt: string; other_deductions: string; total_deductions: string;
  /** Descontos DISCRIMINADOS (podem faltar em folhas antigas → tratar como 0). */
  self_consumption?: string; advance_deduction?: string; absence_deduction?: string;
  net_salary: string; employer_cost: string;
}
export interface PayrollRunDetail { run: PayrollRun; items: PayrollItem[] }
/** Consumo próprio de um funcionário (descontado no salário). */
export interface EmployeeConsumption {
  id: string; staff_name: string; product_code: string; description: string;
  quantity: string; unit_price: string; total: string; reason: string;
  status: string; created_at: string;
}

// ── Assistente OpenManus (lado da empresa) ──────────────────
export type AssistantRole = 'user' | 'assistant' | 'system';
export interface AssistantMessage { role: AssistantRole; content: string }
export interface AssistantGreeting { greeting: string; displayName: string }
export interface AssistantChartSpec {
  type: string; title?: string; labels?: (string | number)[];
  series?: { name: string; data: number[] }[];
}
export interface AssistantChatReply {
  reply: string; charts: AssistantChartSpec[]; imagePrompts: string[];
  provider: string; model: string | null;
}
export interface AssistantTts { audioBase64: string; mimeType: string }
export interface AssistantVoiceTurn { userText: string; reply: string; audioBase64: string; mimeType: string }
export interface AssistantCallSession {
  displayName: string; greeting: string;
  mode: 'realtime' | 'half-duplex' | 'unavailable';
  capabilities: { realtime: boolean; tts: boolean; stt: boolean };
  realtimeBaseUrl: string | null;
}

// ── Conciliação bancária (gestor) ───────────────────────────
export interface BankTx {
  id: string; statement_date: string; description: string | null; amount: string;
  matched: boolean; matched_type: string | null; matched_ref: string | null;
}
export interface ReconSummary { credits: number; debits: number; matchedCount: number; unmatchedCount: number }
export interface ImportStatementRow { date: string; description?: string; amount: number }

// ── Fluxo de caixa (gestor) ─────────────────────────────────
export interface CashflowSummary {
  from: string; to: string;
  salesTotal: number; creditCreated: number; immediateSales: number;
  debtCollected: number; inflows: number; outflows: number; net: number;
}
export interface CashflowPoint { day: string; inflow: number; outflow: number; net: number }
export interface CashflowForecast {
  basisDays: number; avgDailyInflow: number; avgDailyOutflow: number;
  projectedInflow30: number; projectedOutflow30: number;
  receivablesDueSoon: number; projectedNet30: number;
}
export interface RecordPaymentInput { amount: number; method?: 'CASH' | 'TRANSFER' | 'REFERENCE' | 'CARD' | 'EXPRESS'; notes?: string }
export interface PaymentReceipt { receiptNumber: string; amount: number; paidAmount: number; outstanding: number; status: ReceivableStatus }
export interface Company {
  id: string;
  code: string;
  name: string;
  nif: string;
  iban: string | null;
  responsibleName: string;
  responsibleEmail: string;
  responsiblePhone: string | null;
  sector: string | null;
  status: CompanyStatus;
  schemaName: string;
  customDomain: string | null;
  planId: string;
  plan?: Plan;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Estado REAL do plano (derivado das subscrições; trial é dinâmico):
  planState?: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'CANCELLED';
  planExpired?: boolean;
  planExpiresAt?: string | null;
  planDaysLeft?: number | null;
}

// ── IA ───────────────────────────────────────────────────────
export const AI_ADAPTERS = ['openmanus', 'openai', 'openclaw', 'anthropic', 'elevenlabs', 'generic'] as const;
export const AI_CAPABILITIES = ['CHAT', 'TTS', 'STT', 'IMAGE', 'VOICE_CALL'] as const;

export interface AiProvider {
  id: string;
  name: string;
  adapter: string;
  capabilities: string[];
  baseUrl: string;
  model: string | null;
  voice: string | null;
  hasApiKey: boolean;
  apiKeyMask: string | null;
  isActive: boolean;
  isDefault: boolean;
  priority: number;
  createdAt: string;
}
export interface CreateProviderInput {
  name: string;
  adapter: string;
  capabilities: string[];
  baseUrl: string;
  apiKey?: string;
  model?: string;
  voice?: string;
  isActive?: boolean;
  isDefault?: boolean;
  priority?: number;
}

export interface AssistantConfig {
  displayName: string;
  persona: string;
  systemPrompt: string | null;
  greeting: string | null;
  locale: string;
  voiceEnabled: boolean;
  callEnabled: boolean;
  imageEnabled: boolean;
  chartsEnabled: boolean;
  emojiLevel: string;
}

// ── Gateways de pagamento ────────────────────────────────────
export const GATEWAY_PROVIDERS = ['EXPRESS', 'EMIS', 'PROXYPAY', 'REFERENCE', 'GENERIC'] as const;
export interface Gateway {
  id: string;
  provider: string;
  label: string;
  contractRef: string | null;
  merchantId: string | null;
  posId: string | null;
  iban: string | null;
  baseUrl: string | null;
  // Pagamento por referência (contrato EMIS):
  referenceEntity?: string | null;
  environment?: string | null;
  validityDays?: number | null;
  callbackUrl?: string | null;
  isActive: boolean;
  hasApiKey?: boolean;
  apiKeyMask?: string | null;
  createdAt: string;
}
export interface CreateGatewayInput {
  provider: string;
  label: string;
  contractRef?: string;
  merchantId?: string;
  posId?: string;
  iban?: string;
  baseUrl?: string;
  apiKey?: string;
  referenceEntity?: string;
  environment?: 'TEST' | 'PRODUCTION';
  validityDays?: number;
  callbackUrl?: string;
  isActive?: boolean;
}

// ── Fiscal AGT ───────────────────────────────────────────────
export interface AgtExtraField {
  key: string;
  label: string;
  value: string;
  showOnReceipt?: boolean;
  showOnReport?: boolean;
}
export interface AgtConfig {
  subscribed: boolean;
  subscribedAt: string | null;
  environment: string;
  softwareCertificateNumber: string;
  productId: string;
  productVersion: string;
  sourceId: string;
  taxAccountingBasis: string;
  taxEntity: string;
  saftVersion: string;
  receiptLegend: string | null;
  reportFooter: string | null;
  extraFields: AgtExtraField[];
  // Contrato de comunicação eletrónica com a AGT (DP 71/25) — só o Super Admin configura.
  communicationEnabled: boolean;
  endpointUrl: string | null;
  hasApiKey: boolean;
  apiKeyMask: string | null;
}
/** Chave de assinatura fiscal da plataforma (certificação AGT). */
export interface PlatformSigningStatus {
  hasKey: boolean;
  /** "Versão da Chave Pública" a indicar no portal da AGT (1, 2, … por rotação). */
  keyVersion: number;
  algorithm: string;
  modulusBits: number;
  createdAt: string | null;
  publicKeyFingerprint: string | null;
  previousVersions: number[];
}
export interface UpdateAgtInput {
  environment?: string;
  softwareCertificateNumber?: string;
  productId?: string;
  productVersion?: string;
  sourceId?: string;
  taxAccountingBasis?: string;
  taxEntity?: string;
  saftVersion?: string;
  receiptLegend?: string;
  reportFooter?: string;
  extraFields?: AgtExtraField[];
  communicationEnabled?: boolean;
  endpointUrl?: string;
  /** Texto simples; "" limpa a credencial; omitir mantém a actual. */
  apiKey?: string;
}

/** Estado da comunicação AGT do tenant (painel do gestor). */
export interface AgtCommStatus {
  enabled: boolean;
  configured: boolean;
  pending: number;
  communicated: number;
}
export interface AgtCommResult {
  sent: number;
  failed: number;
  errors: string[];
}

// ── Backup & Restauro ────────────────────────────────────────
export interface BackupMeta {
  id: string;
  kind: 'MANUAL' | 'AUTO';
  created_at: string;
  created_by_name: string | null;
  size_bytes: number;
  tables_meta: Record<string, number>;
}
export interface BackupSettings {
  autoEnabled: boolean;
  frequency: 'DAILY' | 'WEEKLY';
  lastAt: string | null;
}
export interface RestorePreview {
  valid: boolean;
  generatedAt?: string;
  tables: { table: string; rows: number; toInsert: number; toUpdate: number }[];
}
export interface RestoreTableResult { table: string; inserted: number; updated: number; failed: number; errors: string[] }
export interface RestoreResult { applied: boolean; tables: RestoreTableResult[] }

// ── Migração (Vendus/Primavera/Negócio/etc.) ──────────────────
export type MigrationKind = 'products' | 'customers' | 'suppliers';
export interface MigrationPreviewRow { action: 'CREATE' | 'UPDATE'; data: Record<string, unknown> }
export interface MigrationPreview {
  kind: MigrationKind;
  detectedColumns: Record<string, string>;
  unmappedColumns: string[];
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  toSkip: number;
  sample: MigrationPreviewRow[];
  skippedSamples: { row: number; reason: string }[];
}
export interface MigrationApplyResult { kind: MigrationKind; created: number; updated: number; skipped: number; errors: string[] }

// ── Suporte (chat do site) + comentários públicos ───────────
export interface SupportMsg { id: string; sender: 'VISITOR' | 'BOT' | 'ADMIN'; body: string; created_at: string }
export interface SiteFeedback { id: string; author_name: string; body: string; likes: number; dislikes: number; created_at: string }
export interface SiteFeedbackAdmin extends SiteFeedback { seen_by_admin: boolean }
export interface AdminChat {
  id: string; visitor_name: string | null; status: 'BOT' | 'HUMAN' | 'CLOSED' | string;
  unread_admin: number; last_msg_at: string; created_at: string; last_body: string | null;
}
export interface FeedbackStats {
  total: number; positive: number; negative: number; neutral: number;
  perDay: { day: string; count: number }[];
}

/** Evento em tempo real do AGENTE IA (painel de atividade estilo Claude). */
export interface AgentEvent {
  type: 'step_start' | 'step_done' | 'text' | 'attachment' | 'done' | 'error';
  tool?: string;
  args?: Record<string, unknown>;
  summary?: string;
  text?: string;
  file?: { kind: string; name: string; base64: string; mime: string };
  imageBase64?: string;
  guideUrl?: string;
  waLink?: string;
}

/** Cliente do tenant (tabela customers — partilhada com o caixa). */
export interface CustomerRow {
  id: string;
  name: string;
  tax_id?: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  province?: string | null;
  municipality?: string | null;
  is_active: boolean;
  created_at?: string;
  /** Estatísticas de compra (sincronizadas com a caixa/loja). */
  purchases?: number;
  total_spent?: number;
  last_purchase?: string | null;
}

/** Câmara de vigilância configurada. */
export interface CameraRow {
  id: string;
  name: string;
  stream_url: string | null;
  snapshot_url: string | null;
  kind: string;
  conn_type: string;
  device_sn: string | null;
  app_ios: string | null;
  app_android: string | null;
  notes: string | null;
  record: boolean;
  is_active: boolean;
  created_at: string;
}
export interface CameraInput {
  name: string;
  streamUrl?: string;
  snapshotUrl?: string;
  kind?: string;
  connType?: string;
  deviceSn?: string;
  appIos?: string;
  appAndroid?: string;
  notes?: string;
  record?: boolean;
  isActive?: boolean;
}
// Relatório de vendas do restaurante: comercial vs produção (fatia 7)
export interface RestaurantReportGroup {
  revenue: number; qty: number; lines: number; cost: number;
  margin: number; marginPct: number;
  top: { description: string; qty: number; revenue: number }[];
}
export interface RestaurantSalesReport {
  days: number;
  commercial: RestaurantReportGroup;
  production: RestaurantReportGroup;
}
// Centro de Comando dos SERVIÇOS (oficina/assistência técnica)
export interface ServicesPipelineStage { count: number; value: number }
export interface ServicesDashboard {
  pipeline: {
    open: ServicesPipelineStage; quoted: ServicesPipelineStage; approved: ServicesPipelineStage;
    inProgress: ServicesPipelineStage; ready: ServicesPipelineStage;
  };
  onlinePending: number;
  oldestInProgress: { days: number; number: string } | null;
  readyToDeliver: { id: string; number: string; customerName: string | null; equipment: string | null; total: number }[];
  equipments: number;
  sales: { total: number; online: number; counter: number; invoices: number };
  mechanic?: { scheduledToday: number; awaitingApproval: number; avgWorkMinutes: number };
}

// ── Gestão de Downloads das aplicações (Super Admin) ─────────
export type AppPlatform = 'windows' | 'android' | 'ios';
export interface AppReleaseRow {
  id: string;
  platform: AppPlatform;
  version: string;
  minSupported: string | null;
  fileUrl: string;
  downloadPageUrl: string | null;
  fileSize: number | null;
  sha256: string | null;
  notes: string[];
  fixes: string[];
  requirements: string | null;
  mandatory: boolean;
  published: boolean;
  releasedAt: string;
  createdAt: string;
  updatedAt: string;
}
export interface AppReleaseInput {
  platform: AppPlatform;
  version: string;
  minSupported?: string;
  fileUrl: string;
  downloadPageUrl?: string;
  fileSize?: number;
  sha256?: string;
  notes?: string[];
  fixes?: string[];
  requirements?: string;
  mandatory?: boolean;
  published?: boolean;
}

/** Forma pública de uma versão de app (sem o link direto do ficheiro). */
export interface PublicRelease {
  platform: AppPlatform;
  version: string;
  minSupported: string | null;
  downloadPageUrl: string | null;
  fileSize: number | null;
  sha256: string | null;
  notes: string[];
  fixes: string[];
  requirements: string | null;
  mandatory: boolean;
  releasedAt: string;
}
