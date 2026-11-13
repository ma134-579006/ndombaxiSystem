import { request } from '../api/client';
import { PUBLIC_ORIGIN } from '../config';

/** LPS Kwanza — cliente da API do marketplace central (contas globais de associado). */
export interface Listing {
  companyCode: string; companyName: string; productCode: string; name: string; description: string | null; imageUrl: string | null;
  gallery: string[]; category: string | null; grossPrice: number; listPrice: number | null; inStock: boolean; commissionPct: number;
  affiliation: 'OPEN' | 'RESTRICTED'; allowMarkup: boolean; maxMarkupPct: number | null; materials: string[]; views: number; sold: number; associates?: number;
  /** Publicação de um associado (o que o cliente normal vê): preço do associado, imagens e vídeo. */
  postId?: string; basePrice?: number; associate?: { code: string; name: string; photoUrl: string | null }; videoUrl?: string | null; caption?: string | null;
}
export interface Associate {
  id: string; name: string; phone: string; email: string | null; code: string; photoUrl: string | null; taxId: string | null;
  province: string | null; municipality: string | null; address: string | null; bio: string | null; createdAt: string;
}
export interface Affiliation {
  id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; companyCode: string; companyName: string; productCode: string; name: string; imageUrl: string | null;
  grossPrice: number; commissionPct: number; negotiated: boolean; markupPct: number | null; affiliation: string; allowMarkup: boolean; maxMarkupPct: number | null;
  published: boolean; postImages: string[]; postVideo: string | null; postCaption: string | null; price: number;
}
export interface CompanyBalance { companyId: string; companyCode: string; companyName: string; pending: number; available: number; withdrawn: number; requested: number; balance: number }
export interface KOrder {
  token: string; companyCode: string; companyName: string; orderId: string; orderNumber: string; status: string; total: number; paymentMethod: string | null; paymentClaimed: boolean;
  deliveryMethod: string | null; address: string | null; invoiced: boolean; gpsAt: string | null; date: string; updatedAt: string;
  items: { productCode: string; name: string; quantity: number; total: number; imageUrl: string | null }[];
}
export interface Social {
  rating: number; count: number; stars: Record<number, number>; likes: number; dislikes: number; mine: number;
  reviews: { id: string; name: string; rating: number; comment: string | null; reply: string | null; date: string }[];
  policy: { returnDays: number; text: string | null };
}
export interface Complaint { code: string; kind: string; body: string; status: string; reply: string | null; company: string; date: string; repliedAt: string | null }
export interface Dashboard {
  frozen?: Record<string, string>;
  code: string; pending: number; available: number; withdrawn: number; requested: number; balance: number; companies: CompanyBalance[];
  sales: { companyCode: string; companyName: string; orderNumber: string; product: string; quantity: number; amount: number; date: string; state: 'PENDING' | 'AVAILABLE' | 'CANCELLED'; orderStatus?: string; paymentClaimed?: boolean; updatedAt?: string }[];
  withdrawals: { id: string; companyCode: string; companyName: string; amount: number; method: string; details: string | null; status: string; note: string | null; proofUrl: string | null; date: string }[];
}
export interface PayoutAccount { id: string; method: string; bank: string | null; holder: string; details: string; createdAt: string }
export interface KNote { id: string; kind: string; title: string; body: string | null; link: string | null; read: boolean; createdAt: string }
export interface KChat { companyCode: string; companyName: string; last: string; at: string; unread: number }
export interface KMsg { id: string; sender: 'ASSOCIATE' | 'COMPANY'; senderName: string; body: string; createdAt: string }
type Session = { token: string; associate: Associate };

const KEY = 'ndombaxi.kwanza.session';
export const session = {
  get(): Session | null { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  set(s: Session) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* */ } window.dispatchEvent(new Event('kwanza:session')); },
  clear() { try { localStorage.removeItem(KEY); } catch { /* */ } window.dispatchEvent(new Event('kwanza:session')); },
};

const e = encodeURIComponent;
export const kw = {
  market: (t?: string) => request<Listing[]>('GET', '/kwanza/market', undefined, t),
  view: (c: string, p: string) => request<{ ok: true }>('POST', `/kwanza/market/${e(c)}/${e(p)}/view`),
  register: (b: { name: string; phone: string; email?: string; password: string }) => request<Session>('POST', '/kwanza/auth/register', b),
  login: (b: { login: string; password: string }) => request<Session>('POST', '/kwanza/auth/login', b),
  recover: (login: string) => request<{ sent: true; viaEmail: boolean }>('POST', '/kwanza/auth/recover', { login }),
  recoverConfirm: (b: { login: string; code: string; password: string }) => request<{ ok: true }>('POST', '/kwanza/auth/recover/confirm', b),
  me: (t: string) => request<Associate>('GET', '/kwanza/me', undefined, t),
  saveProfile: (t: string, b: Partial<Associate>) => request<Associate>('PUT', '/kwanza/me', b, t),
  password: (t: string, current: string, next: string) => request<{ ok: true }>('POST', '/kwanza/me/password', { current, next }, t),
  dashboard: (t: string) => request<Dashboard>('GET', '/kwanza/me/dashboard', undefined, t),
  affiliations: (t: string) => request<Affiliation[]>('GET', '/kwanza/me/affiliations', undefined, t),
  affiliate: (t: string, companyCode: string, productCode: string, note?: string) => request<{ status: string }>('POST', '/kwanza/me/affiliations', { companyCode, productCode, note }, t),
  savePost: (t: string, b: { companyCode: string; productCode: string; price: number | null; images: string[]; videoUrl: string | null; caption: string | null; published: boolean }) =>
    request<{ ok: true; price: number; published: boolean }>('PUT', '/kwanza/me/posts', b, t),
  markup: (t: string, companyCode: string, productCode: string, markupPct: number | null) => request<{ markupPct: number | null }>('POST', '/kwanza/me/markup', { companyCode, productCode, markupPct }, t),
  accounts: (t: string) => request<PayoutAccount[]>('GET', '/kwanza/me/accounts', undefined, t),
  addAccount: (t: string, b: { method: string; bank?: string; holder: string; details: string }) => request<{ ok: true }>('POST', '/kwanza/me/accounts', b, t),
  removeAccount: (t: string, id: string) => request<{ ok: true }>('DELETE', `/kwanza/me/accounts/${e(id)}`, undefined, t),
  notes: (t: string) => request<{ unread: number; items: KNote[] }>('GET', '/kwanza/me/notifications', undefined, t),
  notesRead: (t: string, ids: string[], read = true) => request<{ ok: true }>('POST', `/kwanza/me/notifications/${read ? 'read' : 'unread'}`, { ids }, t),
  notesReadAll: (t: string) => request<{ ok: true }>('POST', '/kwanza/me/notifications/read-all', undefined, t),
  notesDelete: (t: string, ids: string[]) => request<{ ok: true }>('POST', '/kwanza/me/notifications/delete', { ids }, t),
  notesDeleteAll: (t: string) => request<{ ok: true }>('DELETE', '/kwanza/me/notifications', undefined, t),
  chats: (t: string) => request<KChat[]>('GET', '/kwanza/me/chats', undefined, t),
  chat: (t: string, c: string) => request<KMsg[]>('GET', `/kwanza/me/chats/${e(c)}`, undefined, t),
  send: (t: string, c: string, body: string) => request<KMsg[]>('POST', `/kwanza/me/chats/${e(c)}`, { body }, t),
  listing: (c: string, p: string, a?: string) => request<Listing>('GET', `/kwanza/listing/${e(c)}/${e(p)}${a ? `?a=${e(a)}` : ''}`),
  checkout: (b: { companyCode: string; associateCode?: string; lines: { productCode: string; quantity: number }[]; name: string; phone: string; address?: string; province?: string; municipality?: string; deliveryMethod: 'DELIVERY' | 'PICKUP'; paymentMethod?: string; notes?: string; geoLat: number; geoLng: number; geoAccuracy?: number; geoConsent: true; device?: string }) =>
    request<{ token: string; orderId: string; orderNumber: string; grossTotal: number; companyCode: string; companyName: string }>('POST', '/kwanza/checkout', b),
  orders: (tokens: string[]) => request<KOrder[]>('POST', '/kwanza/orders/list', { tokens }),
  findOrder: (phone: string, orderNumber: string) => request<KOrder>('POST', '/kwanza/orders/find', { phone, orderNumber }),
  orderLocation: (token: string, b: { lat: number; lng: number; accuracy?: number }) => request<{ ok: true }>('POST', `/kwanza/orders/${e(token)}/location`, b),
  social: (c: string, p: string, device: string) => request<Social>('GET', `/kwanza/social/${e(c)}/${e(p)}?device=${e(device)}`),
  react: (c: string, p: string, device: string, value: number) => request<Social>('POST', `/kwanza/social/${e(c)}/${e(p)}/react`, { device, value }),
  review: (c: string, p: string, b: { name: string; phone: string; rating: number; comment?: string }) => request<{ ok: true }>('POST', `/kwanza/social/${e(c)}/${e(p)}/review`, b),
  complain: (b: { companyCode: string; productCode?: string; associateCode?: string; orderNumber?: string; name: string; phone: string; kind: string; body: string }) => request<{ ok: true; code: string }>('POST', '/kwanza/complaints', b),
  complaint: (code: string) => request<Complaint>('GET', `/kwanza/complaints/${e(code.trim())}`),
  withdraw: (t: string, companyCode: string, amount: number, accountId: string) => request<{ ok: true }>('POST', '/kwanza/me/withdrawals', { companyCode, amount, accountId }, t),
};

/** Ligação do associado: abre o produto NO LPS KWANZA (a compra faz-se lá) com o código dele. */
export const shareLink = (companyCode: string, productCode: string, ref: string) =>
  `${PUBLIC_ORIGIN}/kwanza#/p/${e(companyCode)}/${e(productCode)}/${ref}`;

/** Anúncio de uma empresa no marketplace (gerido no painel da empresa). */
export interface KBanner {
  id: string; companyCode: string; companyName: string; title: string; subtitle: string | null; buttonLabel: string | null;
  link: { kind: 'product' | 'search' | 'url'; value: string } | null; image: string | null;
}
export const banners = () => request<KBanner[]>('GET', '/kwanza/banners');
