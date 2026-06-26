import { API_URL } from '../config';
import type {
  CatalogProduct,
  CatalogResponse,
  CheckoutInput,
  CheckoutResult,
  CustomerProfile,
  CustomerSession,
  ExpressPayInput,
  MyOrderRow,
  OrderMessage,
  PaymentMethod,
  SiteResponse,
  StoreRoom,
  StoreChatMessage,
  UploadProofInput,
  WebOrder,
} from './types';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Sem ligação à loja. Verifique a sua internet.');
  }
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
  checkout: (code: string, input: CheckoutInput) =>
    request<CheckoutResult>('POST', `/store/${enc(code)}/checkout`, input),
  visualSearch: (code: string, imageBase64: string, mimeType?: string) =>
    request<{ available: boolean; products: CatalogProduct[]; message?: string }>(
      'POST', `/store/${enc(code)}/visual-search`, { imageBase64, mimeType }),
  track: (code: string, orderId: string) =>
    request<WebOrder>('GET', `/store/${enc(code)}/orders/${enc(orderId)}`),
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
  authEmail: (code: string, email: string, name?: string) =>
    request<CustomerSession>('POST', `/store/${enc(code)}/auth/email`, { email, name }),
  authGoogle: (code: string, idToken: string) =>
    request<CustomerSession>('POST', `/store/${enc(code)}/auth/google`, { idToken }),
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
  rooms: (code: string) =>
    request<{ businessType: string; rooms: StoreRoom[] }>('GET', `/store/${enc(code)}/rooms`),
  reservation: (code: string, input: { roomId: string; guestName?: string; guestPhone?: string; guestEmail?: string; checkIn: string; checkOut: string; guests?: number }) =>
    request<{ ok: true; id: string }>('POST', `/store/${enc(code)}/reservation`, input),
  serviceRequest: (code: string, input: { customerName?: string; customerPhone?: string; customerEmail?: string; equipmentType?: string; equipmentLabel?: string; equipmentRef?: string; problem: string }) =>
    request<{ ok: true; id: string }>('POST', `/store/${enc(code)}/service-request`, input),
};
