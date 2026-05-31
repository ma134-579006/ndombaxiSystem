import { API_URL } from '../config';
import type {
  CreateStaffInput,
  CreateStoreInput,
  CreatedStaff,
  LowStockItem,
  OrderMessage,
  SalesRange,
  SalesSeries,
  SalesSummary,
  StaffUser,
  Store,
  TenantLoginInput,
  TokenPair,
  TopProduct,
  WebOrder,
  WebOrderDetail,
} from './types';

/** Erro de API com código HTTP e mensagem amigável (vinda do NestJS). */
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

/**
 * Ganchos fornecidos pelo AuthContext para que o cliente saiba o token actual,
 * o código da empresa, e como renovar/encerrar sessão automaticamente em 401.
 */
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
  /** Anexa o token de acesso (default: true). */
  auth?: boolean;
  /** Permite uma única tentativa de refresh em 401 (uso interno). */
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
    // resposta sem corpo JSON — mantém a mensagem genérica
  }
  if (res.status === 0) message = 'Sem ligação ao servidor.';
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

  // Sessão expirada → tenta renovar uma vez e repete o pedido original.
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

/** Fachada tipada sobre os endpoints reais do back-office. */
export const api = {
  // ── Autenticação ───────────────────────────────────────────
  login(input: TenantLoginInput): Promise<TokenPair> {
    return request<TokenPair>('POST', '/auth/login', input, { auth: false });
  },
  refresh(refreshToken: string): Promise<TokenPair> {
    return request<TokenPair>('POST', '/auth/refresh', { refreshToken }, { auth: false });
  },
  async logout(refreshToken: string): Promise<void> {
    await request<void>('POST', '/auth/logout', { refreshToken }, { auth: false });
  },

  // ── Dashboard ──────────────────────────────────────────────
  dashboard: {
    salesToday: () => request<SalesSummary>('GET', '/dashboard/sales/today'),
    salesSeries: (range: SalesRange) =>
      request<SalesSeries>('GET', `/dashboard/sales/series?range=${encodeURIComponent(range)}`),
    topProducts: (limit = 5) =>
      request<TopProduct[]>('GET', `/dashboard/top-products?limit=${limit}`),
    lowStock: () => request<LowStockItem[]>('GET', '/dashboard/low-stock'),
  },

  // ── Encomendas online ──────────────────────────────────────
  orders: {
    list: () => request<WebOrder[]>('GET', '/ecommerce/orders'),
    get: (id: string) => request<WebOrderDetail>('GET', `/ecommerce/orders/${id}`),
    pay: (id: string) =>
      request<{ orderId: string; invoiceNumber: string }>('POST', `/ecommerce/orders/${id}/pay`),
    ship: (id: string) => request<{ status: string }>('POST', `/ecommerce/orders/${id}/ship`),
    deliver: (id: string) => request<{ status: string }>('POST', `/ecommerce/orders/${id}/deliver`),
    cancel: (id: string) => request<{ status: string }>('POST', `/ecommerce/orders/${id}/cancel`),
    messages: (id: string) => request<OrderMessage[]>('GET', `/ecommerce/orders/${id}/messages`),
    sendMessage: (id: string, messageBody: string, senderName?: string) =>
      request<OrderMessage>('POST', `/ecommerce/orders/${id}/messages`, {
        body: messageBody,
        senderName,
      }),
  },

  // ── Equipa & Lojas ─────────────────────────────────────────
  staff: {
    listStores: () => request<Store[]>('GET', '/staff/stores'),
    createStore: (input: CreateStoreInput) => request<Store>('POST', '/staff/stores', input),
    listUsers: () => request<StaffUser[]>('GET', '/staff/users'),
    createUser: (input: CreateStaffInput) => request<CreatedStaff>('POST', '/staff/users', input),
    deactivateUser: (id: string) =>
      request<StaffUser>('POST', `/staff/users/${id}/deactivate`),
    resetPassword: (id: string) =>
      request<{ temporaryPassword?: string }>('POST', `/staff/users/${id}/reset-password`, {}),
  },
};
