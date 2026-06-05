import { API_URL } from '../config';
import type { PromoRow } from '../pos/promo';
import type {
  CashSession,
  Customer,
  DocumentIdentity,
  EmitInvoiceInput,
  EmittedInvoice,
  Operator,
  Product,
  ReceiptFiscalInfo,
  ReportX,
  SaleRow,
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
  /** Lista de operadores (nome) de uma empresa, para o ecrã da caixa. */
  operators: (companyCode: string) =>
    request<Operator[]>('GET', `/auth/operators?companyCode=${encodeURIComponent(companyCode)}`, undefined, { auth: false }),
  /** Login do operador por nome (id) + PIN. */
  loginPin: (input: { companyCode: string; userId: string; pin: string }) =>
    request<TokenPair>('POST', '/auth/login/pin', input, { auth: false }),
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
};
