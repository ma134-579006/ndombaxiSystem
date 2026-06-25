import { API_URL } from '../config';
import type { PromoRow } from '../pos/promo';
import type {
  CashSession,
  ChatContact,
  ChatMessage,
  Customer,
  CustomerChatMessage,
  CustomerContact,
  DocumentIdentity,
  EmitInvoiceInput,
  EmittedInvoice,
  Operator,
  OperatorsResponse,
  Product,
  ReceiptFiscalInfo,
  ReportX,
  SaleRow,
  SaleDetail,
  SalaryAdvance,
  AdvanceLimit,
  ConsumptionLimit,
  SelfConsumption,
  ShiftClose,
  TenantLoginInput,
  TokenPair,
} from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface AuthHooks {
  getAccessToken(): string | null;
  getCompanyCode(): string | undefined;
  refresh(): Promise<boolean>;
  onAuthLost(): void;
}

let hooks: AuthHooks | null = null;
export function configureApi(h: AuthHooks): void {
  hooks = h;
}

interface RequestOptions {
  auth?: boolean;
  retry?: boolean;
}

async function parseError(res: Response): Promise<ApiError> {
  let message = `Erro ${res.status}`;
  let body: unknown;
  try {
    body = await res.json();
    const m = (body as { message?: string | string[] })?.message;
    if (Array.isArray(m)) message = m.join('; ');
    else if (typeof m === 'string') message = m;
  } catch {
    /* sem corpo JSON */
  }
  return new ApiError(res.status, message, body);
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const { auth = true, retry = true } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = hooks?.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const code = hooks?.getCompanyCode();
    if (code) headers['X-Tenant-Code'] = code;
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Sem ligação ao servidor. Verifique a rede e o endereço da API.');
  }

  if (res.status === 401 && auth && retry && hooks) {
    const ok = await hooks.refresh();
    if (ok) return request<T>(method, path, body, { auth, retry: false });
    hooks.onAuthLost();
    throw await parseError(res);
  }

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  login: (input: TenantLoginInput) =>
    request<TokenPair>('POST', '/auth/login', input, { auth: false }),
  /** Operadores da empresa — aceita o E-MAIL registado ou o código. */
  operators: (identifier: string) =>
    request<OperatorsResponse>('GET', `/auth/operators?company=${encodeURIComponent(identifier)}`, undefined, { auth: false }),
  /** Login com Google (a empresa é encontrada pelo e-mail da conta). */
  loginGoogle: (idToken: string, companyCode?: string) =>
    request<TokenPair & { companyCode: string; companyName: string }>('POST', '/auth/login/google', { idToken, companyCode }, { auth: false }),
  /** Login do operador por nome (id) + PIN. */
  loginPin: (input: { companyCode: string; userId: string; pin: string }) =>
    request<TokenPair>('POST', '/auth/login/pin', input, { auth: false }),
  /** Login da caixa por E-MAIL do funcionário + PIN (descobre empresa+loja). */
  staffLogin: (email: string, pin: string) =>
    request<TokenPair & { companyCode: string }>('POST', '/auth/login/staff', { email, pin }, { auth: false }),
  /** Esqueci o PIN — envia link de recuperação por e-mail. */
  forgotPin: (email: string, companyCode?: string) =>
    request<{ ok: boolean; emailConfigured: boolean }>('POST', '/auth/forgot-password', { email, kind: 'PIN', companyCode }, { auth: false }),
  /** Define o novo PIN a partir do token recebido por e-mail. */
  resetPin: (token: string, secret: string) =>
    request<{ ok: boolean; kind: string }>('POST', '/auth/reset-password', { token, secret }, { auth: false }),
  refresh: (refreshToken: string) =>
    request<TokenPair>('POST', '/auth/refresh', { refreshToken }, { auth: false }),
  logout: (refreshToken: string) =>
    request<void>('POST', '/auth/logout', { refreshToken }, { auth: false }),
  preferences: {
    get: () => request<{ theme: string }>('GET', '/auth/me/preferences'),
    setTheme: (theme: string) =>
      request<{ theme: string }>('PATCH', '/auth/me/preferences', { theme }),
  },

  listProducts: () => request<Product[]>('GET', '/pos/products'),
  listPromotions: () => request<PromoRow[]>('GET', '/promotions'),
  listCustomers: () => request<Customer[]>('GET', '/pos/customers'),
  createCustomer: (input: { taxId?: string; name: string; phone?: string }) =>
    request<Customer>('POST', '/pos/customers', input),
  emitInvoice: (input: EmitInvoiceInput) =>
    request<EmittedInvoice>('POST', '/pos/invoices', input),
  cancelInvoice: (id: string, reason: string) =>
    request<{ creditNoteNumber: string; grossTotal: number }>('POST', `/pos/invoices/${id}/cancel`, { reason }),
  listSales: (from?: string, to?: string) => {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    const qs = p.toString();
    return request<SaleRow[]>('GET', `/pos/invoices${qs ? '?' + qs : ''}`);
  },
  getSale: (id: string) => request<SaleDetail>('GET', `/pos/invoices/${id}`),
  // Rascunho do carrinho por operador (guardado no servidor → cross-device).
  getCartDraft: () =>
    request<{ lines: { productId: string; quantity: number }[]; customerId?: string | null } | null>('GET', '/pos/cart-draft'),
  saveCartDraft: (lines: { productId: string; quantity: number }[], customerId?: string | null) =>
    request<void>('POST', '/pos/cart-draft', { lines, customerId: customerId ?? null }),
  clearCartDraft: () => request<void>('DELETE', '/pos/cart-draft'),
  receiptInfo: () => request<ReceiptFiscalInfo>('GET', '/fiscal/receipt-info'),
  documentIdentity: () => request<DocumentIdentity>('GET', '/fiscal/document-identity'),

  // ── Turno de caixa ─────────────────────────────────────────
  currentSession: () => request<CashSession | null>('GET', '/cashbox/session/current'),
  openSession: (openingFloat: number, registerCode?: string) =>
    request<{ id: string }>('POST', '/cashbox/session/open', { openingFloat, registerCode }),
  cashMovement: (type: 'CASH_IN' | 'CASH_OUT', amount: number, reference?: string) =>
    request<{ id: string }>('POST', '/cashbox/session/movement', { type, amount, reference }),
  closeSession: (countedCash: number, notes?: string) =>
    request<ShiftClose>('POST', '/cashbox/session/close', { countedCash, notes }),
  reportX: () => request<ReportX>('GET', '/cashbox/report/x'),

  // ── Chat de equipa 1:1 (caixa ↔ gerente) ───────────────────
  chatContacts: () => request<ChatContact[]>('GET', '/chat/contacts'),
  chatMessages: (peer: string) => request<ChatMessage[]>('GET', `/chat/messages?peer=${encodeURIComponent(peer)}`),
  chatSend: (recipientId: string, body: string) => request<ChatMessage>('POST', '/chat/messages', { recipientId, body }),
  chatMarkRead: (peerId: string) => request<{ ok: boolean }>('POST', '/chat/read', { peerId }),
  chatDelete: (ids: string[]) => request<{ deleted: number }>('POST', '/chat/delete', { ids }),
  chatUnread: () => request<{ count: number }>('GET', '/chat/unread'),

  // ── Chat com clientes da loja (caixa) ──────────────────────
  custChatContacts: () => request<CustomerContact[]>('GET', '/ecommerce/customer-chat/contacts'),
  custChatMessages: (customer: string) => request<CustomerChatMessage[]>('GET', `/ecommerce/customer-chat/messages?customer=${encodeURIComponent(customer)}`),
  custChatSend: (customerId: string, body: string) => request<CustomerChatMessage>('POST', '/ecommerce/customer-chat/messages', { customerId, body }),
  custChatMarkRead: (customerId: string) => request<{ ok: boolean }>('POST', '/ecommerce/customer-chat/read', { customerId }),
  custChatDelete: (ids: string[]) => request<{ deleted: number }>('POST', '/ecommerce/customer-chat/delete', { ids }),
  custChatUnread: () => request<{ count: number }>('GET', '/ecommerce/customer-chat/unread'),

  // ── Desbloqueio do ecrã de bloqueio (re-verifica o PIN do próprio caixa) ──
  verifyPin: (pin: string) => request<{ ok: boolean }>('POST', '/auth/verify-pin', { pin }),

  // ── Consumo próprio (desconta no salário) ──────────────────
  registerConsumption: (productId: string, quantity: number) =>
    request<SelfConsumption & { employeeLinked: boolean }>('POST', '/hr/self-consumption', { productId, quantity }),
  registerConsumptions: (items: { productId: string; quantity: number }[]) =>
    request<{ registered: number; total: number; employeeLinked: boolean }>('POST', '/hr/self-consumption/bulk', { items }),
  myConsumptions: () => request<SelfConsumption[]>('GET', '/hr/self-consumption/mine'),
  consumptionLimit: () => request<ConsumptionLimit>('GET', '/hr/self-consumption/limit'),

  // ── Adiantamento salarial (pede → gestor aprova → desconta na folha) ──
  advanceLimit: () => request<AdvanceLimit>('GET', '/hr/salary-advance/limit'),
  requestAdvance: (amount: number, reason?: string) =>
    request<SalaryAdvance>('POST', '/hr/salary-advance', { amount, reason }),
  myAdvances: () => request<SalaryAdvance[]>('GET', '/hr/salary-advance/mine'),
};
