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
export interface Dashboard {
  code: string; pending: number; available: number; withdrawn: number; requested: number; balance: number; companies: CompanyBalance[];
  sales: { companyCode: string; companyName: string; orderNumber: string; product: string; quantity: number; amount: number; date: string; state: 'PENDING' | 'AVAILABLE' | 'CANCELLED' }[];
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
  withdraw: (t: string, companyCode: string, amount: number, accountId: string) => request<{ ok: true }>('POST', '/kwanza/me/withdrawals', { companyCode, amount, accountId }, t),
};

/** Ligação pública: abre o produto na loja da empresa e guarda o código do associado. */
export const shareLink = (companyCode: string, productCode: string, ref: string) =>
  `${PUBLIC_ORIGIN}/${e(companyCode)}?p=${e(productCode)}&ref=${ref}`;
