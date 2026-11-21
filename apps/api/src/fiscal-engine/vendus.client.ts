/**
 * Cliente da API Cegid Vendus (Angola) — https://www.vendus.co.ao/ws/
 *
 * Contrato confirmado na especificação OpenAPI publicada pela Cegid
 * (https://www.vendus.co.ao/ws/v1.1/api.jsonapi, consultada a 21-11-2026):
 *   • versão por omissão 1.1 (existe 1.2); a versão vai no caminho: /ws/v1.1/<recurso>/
 *   • autenticação por "Authorization: Bearer <api_key>" (também há Basic e ?api_key=,
 *     que NÃO usamos — a chave nunca vai no URL, logo nunca aparece em logs de proxies);
 *   • códigos: 401 chave inválida, 403 sem permissão, 404, 415, 422 validação, 429 limite,
 *     5xx erro interno; cabeçalhos Rate-Limit-*; paginação per_page/page (máx. 1000).
 *
 * Este ficheiro não conhece a base de dados: recebe a chave já decifrada, faz o
 * pedido com prazo e devolve um resultado CLASSIFICADO (nunca lança por HTTP).
 */

/** Classes de falha que a monitorização distingue (missão, fase 15: A–F). */
export type VendusErrorCode =
  | 'CHAVE_INVALIDA' // A — 401
  | 'SEM_PERMISSAO' // 403 (utilizador da chave sem permissão / plano)
  | 'SUBSCRICAO_INACTIVA' // B — registo/plano sem subscrição activa
  | 'VALIDACAO' // 400/422 — pedido recusado pelo Vendus (dados)
  | 'NAO_ENCONTRADO' // 404
  | 'LIMITE' // 429
  | 'INDISPONIVEL' // D — 5xx
  | 'TIMEOUT' // D — sem resposta no prazo (pode ter sido processado!)
  | 'REDE' // D — falha de ligação antes de enviar
  | 'RESPOSTA_INVALIDA'; // resposta que não é JSON / PDF

export interface VendusResult<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  /** Binário (PDF). */
  bytes?: Buffer;
  error?: { code: VendusErrorCode; message: string };
  rateLimit?: { remaining?: number; reset?: number };
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface VendusClientOptions {
  baseUrl: string; // ex.: https://www.vendus.co.ao/ws
  version: string; // ex.: 1.1
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

/** Versões publicadas pela Cegid (a 21-11-2026). Outras são recusadas na configuração. */
export const VENDUS_VERSIONS = ['1.0', '1.1', '1.2'] as const;
export const VENDUS_DEFAULT_VERSION = '1.1';

/** Mensagem de erro legível a partir do corpo (formato não documentado → tolerante). */
export function vendusErrorMessage(body: unknown, fallback: string): string {
  if (!body) return fallback;
  if (typeof body === 'string') return body.slice(0, 300) || fallback;
  const b = body as Record<string, any>;
  if (Array.isArray(b.errors) && b.errors.length) {
    return b.errors.map((e: any) => (typeof e === 'string' ? e : [e.code, e.message ?? e.description].filter(Boolean).join(' '))).join('; ').slice(0, 500);
  }
  if (typeof b.message === 'string') return b.message.slice(0, 300);
  if (typeof b.error === 'string') return b.error.slice(0, 300);
  return fallback;
}

export function classifyStatus(status: number, body: unknown): VendusErrorCode {
  if (status === 401) return 'CHAVE_INVALIDA';
  if (status === 403) {
    const msg = vendusErrorMessage(body, '').toLowerCase();
    // O texto do Vendus sobre plano/subscrição não está documentado: só o
    // classificamos como subscrição quando a mensagem o diz explicitamente.
    return /subscri|assinatura|plano|expir/.test(msg) ? 'SUBSCRICAO_INACTIVA' : 'SEM_PERMISSAO';
  }
  if (status === 404) return 'NAO_ENCONTRADO';
  if (status === 429) return 'LIMITE';
  if (status === 400 || status === 415 || status === 422) return 'VALIDACAO';
  if (status >= 500) return 'INDISPONIVEL';
  return 'RESPOSTA_INVALIDA';
}

export class VendusClient {
  private readonly root: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly opts: VendusClientOptions) {
    if (!(VENDUS_VERSIONS as readonly string[]).includes(opts.version)) throw new Error(`Versão da API Vendus não suportada: ${opts.version}`);
    this.root = `${opts.baseUrl.replace(/\/+$/, '')}/v${opts.version}`;
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  /** URL de um recurso (sem a chave — a chave vai SEMPRE no cabeçalho). */
  url(path: string, query?: Record<string, string | number | undefined>): string {
    const clean = path.replace(/^\/+/, '');
    const qs = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
    return `${this.root}/${clean}${qs ? `?${qs}` : ''}`;
  }

  async request<T = any>(method: 'GET' | 'POST' | 'PATCH', path: string, opts: { query?: Record<string, string | number | undefined>; body?: unknown; binary?: boolean } = {}): Promise<VendusResult<T>> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const headers: Record<string, string> = { Authorization: `Bearer ${this.opts.apiKey}`, Accept: opts.binary ? 'application/pdf' : 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await this.fetchImpl(this.url(path, opts.query), { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      const aborted = (e as Error)?.name === 'AbortError' || ctrl.signal.aborted;
      return { ok: false, status: 0, error: { code: aborted ? 'TIMEOUT' : 'REDE', message: aborted ? `Sem resposta do Vendus em ${Math.round(this.timeoutMs / 1000)} s` : 'Falha de ligação ao Vendus' } };
    }
    const rateLimit = { remaining: num(res.headers.get('Rate-Limit-Remaining')), reset: num(res.headers.get('Rate-Limit-Reset')) };
    try {
      if (opts.binary && res.status >= 200 && res.status < 300) {
        const bytes = Buffer.from(await res.arrayBuffer());
        clearTimeout(timer);
        if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return { ok: false, status: res.status, rateLimit, error: { code: 'RESPOSTA_INVALIDA', message: 'O Vendus não devolveu um PDF' } };
        return { ok: true, status: res.status, bytes, rateLimit };
      }
      const text = await res.text();
      clearTimeout(timer);
      let body: unknown = undefined;
      if (text) {
        try { body = JSON.parse(text); } catch { body = text; }
      }
      if (res.status >= 200 && res.status < 300) {
        if (text && typeof body === 'string') return { ok: false, status: res.status, rateLimit, error: { code: 'RESPOSTA_INVALIDA', message: 'Resposta do Vendus não é JSON' } };
        return { ok: true, status: res.status, data: body as T, rateLimit };
      }
      const code = classifyStatus(res.status, body);
      return { ok: false, status: res.status, rateLimit, data: body as T, error: { code, message: vendusErrorMessage(body, `HTTP ${res.status}`) } };
    } catch (e) {
      clearTimeout(timer);
      const aborted = ctrl.signal.aborted;
      return { ok: false, status: res.status, error: { code: aborted ? 'TIMEOUT' : 'RESPOSTA_INVALIDA', message: aborted ? 'Resposta do Vendus interrompida (prazo)' : 'Resposta do Vendus ilegível' } };
    }
  }

  account() { return this.request('GET', 'account/'); }
  stores() { return this.request<any[]>('GET', 'stores/', { query: { type: 'store' } }); }
  registers() { return this.request<any[]>('GET', 'registers/'); }
  register(id: string) { return this.request('GET', `registers/${encodeURIComponent(id)}/`); }
  taxes() { return this.request<any[]>('GET', 'taxes/'); }
  exemptions() { return this.request<any[]>('GET', 'taxes/exemptions/'); }
  paymentMethods() { return this.request<any[]>('GET', 'documents/paymentmethods/'); }
  clients(q: Record<string, string>) { return this.request<any[]>('GET', 'clients/', { query: q }); }
  createClient(body: unknown) { return this.request('POST', 'clients/', { body }); }
  updateClient(id: string, body: unknown) { return this.request('PATCH', `clients/${encodeURIComponent(id)}/`, { body }); }
  products(q: Record<string, string>) { return this.request<any[]>('GET', 'products/', { query: q }); }
  createProduct(body: unknown) { return this.request('POST', 'products/', { body }); }
  updateProduct(id: string, body: unknown) { return this.request('PATCH', `products/${encodeURIComponent(id)}/`, { body }); }
  units() { return this.request<any[]>('GET', 'products/units/'); }
  createDocument(body: unknown) { return this.request('POST', 'documents/', { body }); }
  documents(q: Record<string, string | number | undefined>) { return this.request<any[]>('GET', 'documents/', { query: q }); }
  document(id: string) { return this.request('GET', `documents/${encodeURIComponent(id)}/`); }
  /** "To obtain a pdf version, just add .pdf extension to the document's id." */
  documentPdf(id: string) { return this.request('GET', `documents/${encodeURIComponent(id)}.pdf`, { binary: true }); }
  saft(year: number, month: number) { return this.request<{ year: number; month: number; xml: string }>('GET', 'taxauthority/saft/', { query: { year, month } }); }
}

function num(v: string | null): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
