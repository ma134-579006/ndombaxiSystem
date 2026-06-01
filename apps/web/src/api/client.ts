import { API_URL } from '../config';
import type {
  AgtConfig,
  AiProvider,
  AssistantConfig,
  Company,
  CompanyStatus,
  CreateGatewayInput,
  CreateProductInput,
  CreateProviderInput,
  Gateway,
  ManagerProduct,
  PlatformLoginInput,
  SiteSettings,
  TenantLoginInput,
  TokenPair,
  UpdateAgtInput,
  UpdateProductInput,
  UpdateSiteSettingsInput,
  WebOrder,
  WebOrderDetail,
} from './types';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface AuthHooks {
  getAccessToken(): string | null;
  /** Código da empresa (X-Tenant-Code) — só no modo gestor. */
  getCompanyCode?(): string | undefined;
  refresh(): Promise<boolean>;
  onAuthLost(): void;
}
let hooks: AuthHooks | null = null;
export function configureApi(h: AuthHooks): void {
  hooks = h;
}

async function parseError(res: Response): Promise<ApiError> {
  let message = `Erro ${res.status}`;
  try {
    const j = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(j.message)) message = j.message.join('; ');
    else if (j.message) message = j.message;
  } catch {
    /* sem corpo */
  }
  return new ApiError(res.status, message);
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { auth?: boolean; retry?: boolean } = {},
): Promise<T> {
  const { auth = true, retry = true } = opts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = hooks?.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const code = hooks?.getCompanyCode?.();
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
    throw new ApiError(0, 'Sem ligação ao servidor.');
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
  login: (input: PlatformLoginInput) =>
    request<TokenPair>('POST', '/auth/super-admin/login', input, { auth: false }),
  /** Login do gestor da empresa (tenant). */
  loginTenant: (input: TenantLoginInput) =>
    request<TokenPair>('POST', '/auth/login', input, { auth: false }),
  refresh: (refreshToken: string) =>
    request<TokenPair>('POST', '/auth/refresh', { refreshToken }, { auth: false }),
  logout: (refreshToken: string) =>
    request<void>('POST', '/auth/logout', { refreshToken }, { auth: false }),

  tenants: {
    list: (params: { status?: CompanyStatus; search?: string }) => {
      const q = new URLSearchParams();
      if (params.status) q.set('status', params.status);
      if (params.search) q.set('search', params.search);
      const qs = q.toString();
      return request<Company[]>('GET', `/super-admin/tenants${qs ? `?${qs}` : ''}`);
    },
    approve: (id: string) => request<Company>('POST', `/super-admin/tenants/${id}/approve`),
    reject: (id: string) => request<Company>('POST', `/super-admin/tenants/${id}/reject`),
    suspend: (id: string) => request<Company>('POST', `/super-admin/tenants/${id}/suspend`),
    reactivate: (id: string) => request<Company>('POST', `/super-admin/tenants/${id}/reactivate`),
  },

  ai: {
    listProviders: () => request<AiProvider[]>('GET', '/super-admin/ai/providers'),
    createProvider: (dto: CreateProviderInput) =>
      request<AiProvider>('POST', '/super-admin/ai/providers', dto),
    updateProvider: (id: string, dto: Partial<CreateProviderInput>) =>
      request<AiProvider>('PATCH', `/super-admin/ai/providers/${id}`, dto),
    deleteProvider: (id: string) =>
      request<{ id: string }>('DELETE', `/super-admin/ai/providers/${id}`),
    testProvider: (id: string) =>
      request<{ ok?: boolean; [k: string]: unknown }>('POST', `/super-admin/ai/providers/${id}/test`),
    getAssistant: () => request<AssistantConfig>('GET', '/super-admin/ai/assistant'),
    updateAssistant: (dto: Partial<AssistantConfig>) =>
      request<AssistantConfig>('PATCH', '/super-admin/ai/assistant', dto),
  },

  fiscal: {
    get: () => request<AgtConfig>('GET', '/super-admin/fiscal/agt'),
    update: (dto: UpdateAgtInput) => request<AgtConfig>('PATCH', '/super-admin/fiscal/agt', dto),
    subscribe: () => request<AgtConfig>('POST', '/super-admin/fiscal/agt/subscribe'),
  },

  gateways: {
    list: () => request<Gateway[]>('GET', '/super-admin/payment-gateways'),
    create: (dto: CreateGatewayInput) =>
      request<Gateway>('POST', '/super-admin/payment-gateways', dto),
    update: (id: string, dto: Partial<CreateGatewayInput>) =>
      request<Gateway>('PATCH', `/super-admin/payment-gateways/${id}`, dto),
    remove: (id: string) =>
      request<{ id: string }>('DELETE', `/super-admin/payment-gateways/${id}`),
  },

  // ── Back-office do GESTOR da empresa ───────────────────────
  products: {
    list: () => request<ManagerProduct[]>('GET', '/pos/products'),
    create: (dto: CreateProductInput) => request<ManagerProduct>('POST', '/pos/products', dto),
    update: (id: string, dto: UpdateProductInput) =>
      request<ManagerProduct>('PATCH', `/pos/products/${id}`, dto),
  },
  orders: {
    list: () => request<WebOrder[]>('GET', '/ecommerce/orders'),
    get: (id: string) => request<WebOrderDetail>('GET', `/ecommerce/orders/${id}`),
    pay: (id: string) =>
      request<{ orderId: string; invoiceNumber: string }>('POST', `/ecommerce/orders/${id}/pay`),
    ship: (id: string) => request<{ status: string }>('POST', `/ecommerce/orders/${id}/ship`),
    deliver: (id: string) => request<{ status: string }>('POST', `/ecommerce/orders/${id}/deliver`),
    cancel: (id: string) => request<{ status: string }>('POST', `/ecommerce/orders/${id}/cancel`),
  },
  site: {
    get: () => request<SiteSettings>('GET', '/site/settings'),
    update: (dto: UpdateSiteSettingsInput) =>
      request<SiteSettings>('PATCH', '/site/settings', dto),
  },
};
