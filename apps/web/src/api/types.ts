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
export type PlanTier = 'STARTER' | 'BUSINESS' | 'ENTERPRISE' | 'WHITE_LABEL';

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
}
export interface PublicLanding { config: LandingConfig; plans: PublicPlan[] }

export interface TenantLoginInput {
  companyCode: string;
  email: string;
  password: string;
  twoFaToken?: string;
}

// ════════════════════════════════════════════════════════════
// Back-office do GESTOR da empresa (login tenant)
// ════════════════════════════════════════════════════════════

/** Código de IVA de Angola (AGT §7.1). */
export type IvaCode = 'NOR' | 'RED' | 'ISE' | 'OUT';
export const IVA_RATE: Record<IvaCode, number> = { NOR: 14, RED: 5, ISE: 0, OUT: 0 };

/** Produto tal como devolvido por GET /pos/products (NUMERIC vem como string). */
export interface ManagerProduct {
  id: string;
  code: string;
  barcode: string | null;
  name: string;
  description: string | null;
  category_id: string | null;
  iva_code: IvaCode;
  exemption_reason: string | null;
  exemption_code: string | null;
  unit_price: string;
  cost_price: string;
  stock_qty: string;
  image_url: string | null;
  gallery: unknown;
  show_online: boolean;
  is_active: boolean;
}
export interface CreateProductInput {
  code: string;
  barcode?: string;
  name: string;
  description?: string;
  ivaCode: IvaCode;
  exemptionReason?: string;
  exemptionCode?: string;
  unitPrice: number;
  costPrice?: number;
  stockQty?: number;
  storeIds?: string[];
  imageUrl?: string;
  showOnline?: boolean;
}
export interface UpdateProductInput {
  name?: string;
  description?: string;
  ivaCode?: IvaCode;
  exemptionReason?: string;
  exemptionCode?: string;
  unitPrice?: number;
  costPrice?: number;
  stockQty?: number;
  imageUrl?: string;
  showOnline?: boolean;
  isActive?: boolean;
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
  net_total: string;
  iva_total: string;
  gross_total: string;
  invoice_id: string | null;
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
  is_published: boolean;
}
export interface UpdateSiteSettingsInput {
  brandName?: string;
  tagline?: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
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
export interface ReportUserRow { name: string; sales: number; net: number; gross: number }
export interface ReportCategoryRow { name: string; qty: number; net: number; gross: number }
export interface ReportTaxRow { rate: number; net: number; iva: number; gross: number }
export interface ReportPaymentRow { method: string; count: number; total: number }

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
export interface DashSalesPoint { bucket: string; grossTotal: number; ivaTotal: number; invoiceCount: number; cancelledTotal: number }
export interface DashSalesSeries {
  range: SalesRange; granularity: 'hour' | 'day' | 'week' | 'month';
  points: DashSalesPoint[]; summary: DashSalesSummary;
}
export interface DashTopProduct { productCode: string; description: string; quantity: number; grossTotal: number }
export interface DashLowStock {
  productCode: string; productName: string; warehouseCode: string; quantity: number; minQty: number;
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
  must_reset_pw: boolean; has_pin: boolean; last_login_at: string | null;
}
export interface CreateStoreInput { code: string; name: string; address?: string; isDefault?: boolean }
export interface UpdateStoreInput { name?: string; address?: string; isActive?: boolean; isDefault?: boolean }
export interface CreateStaffInput { name: string; email: string; role: StaffRoleName; storeId?: string; password?: string; pin?: string }
export interface UpdateStaffInput { name?: string; role?: StaffRoleName; storeId?: string; isActive?: boolean }
export interface CreatedStaff { user: ManagerStaff; temporaryPassword?: string }

// ── Funcionários (RH) ───────────────────────────────────────
export interface ManagerEmployee {
  id: string; employee_number: string; full_name: string;
  tax_id: string | null; inss_number: string | null; position: string | null;
  department: string | null; base_salary: string; iban: string | null;
  photo_url: string | null; status: string;
}
export interface CreateEmployeeInput {
  employeeNumber: string; fullName: string; position?: string; department?: string;
  baseSalary: number; iban?: string; taxId?: string; inssNumber?: string; photoUrl?: string;
}
export interface UpdateEmployeeInput {
  fullName?: string; position?: string; department?: string;
  baseSalary?: number; iban?: string; photoUrl?: string;
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
  net_salary: string; employer_cost: string;
}
export interface PayrollRunDetail { run: PayrollRun; items: PayrollItem[] }

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
}

// ── IA ───────────────────────────────────────────────────────
export const AI_ADAPTERS = ['openmanus', 'openai', 'anthropic', 'elevenlabs', 'generic'] as const;
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
}
