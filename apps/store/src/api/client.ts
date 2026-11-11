import { API_URL } from '../config';
import type {
  CatalogProduct,
  CatalogResponse,
  CheckoutInput,
  CheckoutResult,
  CustomerProfile,
  CouponPreview,
  ProductReviews,
  PublicCoupon,
  CustomerSession,
  ExpressPayInput,
  MyClinical,
  MyPrescriptionDetail,
  MyOrderRow,
  OrderMessage,
  PaymentMethod,
  SiteResponse,
  StoreInvoice,
  StoreRoom,
  StoreChatMessage,
  UploadProofInput,
  WebOrder,
  RepairStatus,
} from './types';

/* Associado que trouxe o cliente (?ref=CÓDIGO): guardado 30 dias por loja; o último clique ganha. */
const REF_KEY = (code: string) => `ndombaxi.kw.ref.${code}`;
export function captureAffiliateRef(code: string): void {
  try {
    const ref = new URLSearchParams(window.location.search).get('ref') ?? new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('ref');
    if (ref && /^[A-Za-z0-9]{6}$/.test(ref)) localStorage.setItem(REF_KEY(code), JSON.stringify({ ref: ref.toUpperCase(), at: Date.now() }));
  } catch { /* armazenamento indisponível */ }
}
export function readAffiliateRef(code: string): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(REF_KEY(code)) || 'null') as { ref: string; at: number } | null;
    return v && Date.now() - v.at < 30 * 86400000 ? v.ref : null;
  } catch { return null; }
}

export interface AffiliateSummary {
  code: string; pending: number; available: number; withdrawn: number; requested: number; balance: number;
  sales: { orderNumber: string; date: string; product: string; quantity: number; amount: number; state: 'PENDING' | 'AVAILABLE' | 'CANCELLED' }[];
  withdrawals: { id: string; amount: number; method: string; details: string | null; status: string; date: string; note: string | null; proofUrl: string | null }[];
}
export interface PayoutAccount { id: string; method: string; bank: string | null; holder: string; details: string; createdAt: string }

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response;
  // Timeout defensivo: evita ficar pendurado quando o servidor está a acordar.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ApiError(0, (e as Error)?.name === 'AbortError'
      ? 'A loja demorou demasiado a responder. Tente novamente.'
      : 'Sem ligação à loja. Verifique a sua internet.');
  } finally { clearTimeout(timer); }
  if (!res.ok) {
    let message = `Erro ${res.status}`;
    try {
      const j = (await res.json()) as { message?: string | string[] };
      if (Array.isArray(j.message)) message = j.message.join('; ');
      else if (j.message) message = j.message;
    } catch {
      /* sem corpo */
    }
    if (res.status === 404) message = 'Loja ou recurso não encontrado.';
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const enc = encodeURIComponent;

/** Cliente público da montra — o tenant é resolvido pelo código da loja. */
export const api = {
  site: (code: string) => request<SiteResponse>('GET', `/store/${enc(code)}/site`),
  catalog: (code: string) => request<CatalogResponse>('GET', `/store/${enc(code)}/catalog`),
  paymentMethods: (code: string) =>
    request<PaymentMethod[]>('GET', `/store/${enc(code)}/payment-methods`),
  coupons: (code: string) => request<PublicCoupon[]>('GET', `/store/${enc(code)}/coupons`),
  couponCheck: (code: string, body: { code: string; total: number }, token: string) =>
    request<CouponPreview>('POST', `/store/${enc(code)}/coupon/check`, body, token),
  productView: (code: string, productCode: string) =>
    request<{ ok: true }>('POST', `/store/${enc(code)}/products/${enc(productCode)}/view`),
  reviews: (code: string, productCode: string, token?: string) =>
    request<ProductReviews>('GET', `/store/${enc(code)}/products/${enc(productCode)}/reviews`, undefined, token),
  submitReview: (code: string, productCode: string, body: { rating: number; comment?: string }, token: string) =>
    request<{ ok: true }>('POST', `/store/${enc(code)}/products/${enc(productCode)}/reviews`, body, token),
  checkout: (code: string, input: CheckoutInput, token?: string) =>
    request<CheckoutResult>('POST', `/store/${enc(code)}/checkout`, { ...input, affiliateCode: readAffiliateRef(code) ?? undefined }, token),
  visualSearch: (code: string, imageBase64: string, mimeType?: string) =>
    request<{ available: boolean; products: CatalogProduct[]; message?: string }>(
      'POST', `/store/${enc(code)}/visual-search`, { imageBase64, mimeType }),
  track: (code: string, orderId: string) =>
    request<WebOrder>('GET', `/store/${enc(code)}/orders/${enc(orderId)}`),
  /** Portal do cliente: estado do reparo (OS) por token público. */
  repairStatus: (code: string, token: string) =>
    request<RepairStatus>('GET', `/store/${enc(code)}/service-order/${enc(token)}`),
  orderInvoice: (code: string, orderId: string) =>
    request<StoreInvoice>('GET', `/store/${enc(code)}/orders/${enc(orderId)}/invoice`),
  updateLocation: (code: string, orderId: string, token: string, body: { lat: number; lng: number; accuracy?: number }) =>
    request<{ ok: true }>('POST', `/store/${enc(code)}/orders/${enc(orderId)}/location`, body, token),
  generateReference: (code: string, orderId: string) =>
    request<{ available: boolean; entity?: string; reference?: string; amount?: number; expiresAt?: string; message?: string }>(
      'POST', `/store/${enc(code)}/orders/${enc(orderId)}/reference`,
    ),
  uploadProof: (code: string, orderId: string, input: UploadProofInput) =>
    request<unknown>('POST', `/store/${enc(code)}/orders/${enc(orderId)}/proof`, input),
  payExpress: (code: string, orderId: string, input: ExpressPayInput) =>
    request<{ status?: string; invoiceNumber?: string }>(
      'POST',
      `/store/${enc(code)}/orders/${enc(orderId)}/pay/express`,
      input,
    ),
  messages: (code: string, orderId: string) =>
    request<OrderMessage[]>('GET', `/store/${enc(code)}/orders/${enc(orderId)}/messages`),
  sendMessage: (code: string, orderId: string, messageBody: string, senderName?: string) =>
    request<{ message: OrderMessage; assistant?: OrderMessage }>(
      'POST',
      `/store/${enc(code)}/orders/${enc(orderId)}/messages`,
      { body: messageBody, senderName },
    ),
  // ── Conta do cliente ───────────────────────────────────────
  /** Formas de entrar disponíveis; sem nenhuma, compra-se como convidado. */
  authMethods: (code: string) =>
    request<{ email: boolean; google: boolean; quick?: boolean }>('GET', `/store/${enc(code)}/auth/methods`),
  /** Conta rápida: sem código; nome, telefone e email opcionais (o GPS é pedido antes). */
  authQuick: (code: string, data: { name?: string; phone?: string; email?: string }) =>
    request<CustomerSession>('POST', `/store/${enc(code)}/auth/quick`, data),
  /** Passo 1: pede o código de verificação (chega por email). */
  authEmailCode: (code: string, email: string, existing?: boolean) =>
    request<{ sent: true }>('POST', `/store/${enc(code)}/auth/email/code`, { email, existing }),
  /** Passo 2: entra com o código recebido. */
  authEmail: (code: string, email: string, name: string | undefined, existing: boolean | undefined, otp: string) =>
    request<CustomerSession>('POST', `/store/${enc(code)}/auth/email`, { email, name, existing, code: otp }),
  authGoogle: (code: string, idToken: string) =>
    request<CustomerSession>('POST', `/store/${enc(code)}/auth/google`, { idToken }),
  myMembership: (code: string, token: string) =>
    request<{ status: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' }>('GET', `/store/${enc(code)}/my/membership`, undefined, token),
  requestMembership: (code: string, token: string, note?: string) =>
    request<{ status: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' }>('POST', `/store/${enc(code)}/my/membership/request`, { note }, token),
  membersBanners: (code: string, token: string) =>
    request<Array<{ id: string; title: string; subtitle: string | null; imageUrl: string | null; linkUrl: string | null; buttonLabel: string | null }>>('GET', `/store/${enc(code)}/members/banners`, undefined, token),
  membersMarket: (code: string, token: string) =>
    request<Array<{ productCode: string; percent: number }>>('GET', `/store/${enc(code)}/members/market`, undefined, token),
  membersAffiliate: (code: string, token: string) =>
    request<AffiliateSummary>('GET', `/store/${enc(code)}/members/affiliate`, undefined, token),
  membersWithdraw: (code: string, token: string, body: { amount: number; accountId?: string; method?: string; details?: string }) =>
    request<{ ok: true }>('POST', `/store/${enc(code)}/members/withdrawals`, body, token),
  membersAccounts: (code: string, token: string) =>
    request<PayoutAccount[]>('GET', `/store/${enc(code)}/members/accounts`, undefined, token),
  membersAddAccount: (code: string, token: string, body: { method: string; bank?: string; holder: string; details: string }) =>
    request<{ ok: true }>('POST', `/store/${enc(code)}/members/accounts`, body, token),
  membersRemoveAccount: (code: string, token: string, id: string) =>
    request<{ ok: true }>('POST', `/store/${enc(code)}/members/accounts/${enc(id)}/delete`, undefined, token),
  membersCatalog: (code: string, token: string) =>
    request<CatalogResponse>('GET', `/store/${enc(code)}/members/catalog`, undefined, token),
  myOrders: (code: string, token: string) =>
    request<MyOrderRow[]>('GET', `/store/${enc(code)}/my/orders`, undefined, token),
  myProfile: (code: string, token: string) =>
    request<CustomerProfile>('GET', `/store/${enc(code)}/my/profile`, undefined, token),
  updateProfile: (code: string, token: string, profile: Partial<CustomerProfile>) =>
    request<CustomerProfile>('PUT', `/store/${enc(code)}/my/profile`, profile, token),
  // Chat livre com a loja (cliente autenticado).
  chatThread: (code: string, token: string) =>
    request<{ messages: StoreChatMessage[]; staffOnline: boolean }>('GET', `/store/${enc(code)}/chat`, undefined, token),
  chatSend: (code: string, token: string, body: string) =>
    request<StoreChatMessage>('POST', `/store/${enc(code)}/chat`, { body }, token),
  // ── Verticais: reservas (hotelaria) e pedidos de serviço ───
  rooms: (code: string, checkIn?: string, checkOut?: string) => {
    const q = checkIn && checkOut ? `?checkIn=${checkIn}&checkOut=${checkOut}` : '';
    return request<{ businessType: string; rooms: StoreRoom[] }>('GET', `/store/${enc(code)}/rooms${q}`);
  },
  reservation: (code: string, input: { roomId: string; guestName?: string; guestPhone?: string; guestEmail?: string; checkIn: string; checkOut: string; guests?: number }) =>
    request<{ ok: true; id: string }>('POST', `/store/${enc(code)}/reservation`, input),
  serviceRequest: (code: string, input: { customerName?: string; customerPhone?: string; customerEmail?: string; equipmentType?: string; equipmentLabel?: string; equipmentRef?: string; problem: string }) =>
    request<{ ok: true; id: string; number?: string; trackToken?: string | null }>('POST', `/store/${enc(code)}/service-request`, input),
  appointment: (code: string, input: { patientName: string; patientPhone?: string; patientEmail?: string; professional?: string; scheduledAt: string; reason?: string }) =>
    request<{ ok: true; id: string }>('POST', `/store/${enc(code)}/appointment`, input),
  professionals: (code: string) =>
    request<{ businessType: string; professionals: { name: string; specialty: string | null }[] }>('GET', `/store/${enc(code)}/professionals`),
  myClinical: (code: string, token: string) =>
    request<MyClinical>('GET', `/store/${enc(code)}/my/clinical`, undefined, token),
  myPrescription: (code: string, id: string, token: string) =>
    request<MyPrescriptionDetail>('GET', `/store/${enc(code)}/my/prescriptions/${enc(id)}`, undefined, token),
};
