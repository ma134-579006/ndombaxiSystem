/**
 * Transporte do protocolo de sincronização.
 *
 * O motor não conhece `fetch`, cabeçalhos nem autenticação — recebe isto de
 * fora. Assim o mesmo motor serve o POS, o painel de gestão e a loja, cada um
 * com a sua forma de obter o token, e os testes não precisam de rede.
 */
import type { PullRequest, PullResponse, PushResponse, OutboxOp } from './types';

/** Erro de transporte com semântica suficiente para o motor decidir. */
export class TransportError extends Error {
  constructor(
    /** 0 = não houve resposta (rede/timeout). */
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'TransportError';
  }

  /** Vale a pena repetir? Rede e 5xx sim; 4xx de negócio não. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }

  /** A sessão caducou — o motor pára e deixa a app tratar da renovação. */
  get authExpired(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export interface SyncTransport {
  pull(req: PullRequest): Promise<PullResponse>;
  push(ops: OutboxOp[]): Promise<PushResponse>;
}

/** Cria um transporte HTTP sobre a API NEXUS. */
export function httpTransport(opts: {
  /** Base da API, sem barra final (ex.: https://api.exemplo.ao). */
  baseUrl: string;
  /** Devolve o cabeçalho Authorization, ou null se não houver sessão. */
  getAuthHeader(): string | null;
  /** Código do tenant para o cabeçalho X-Tenant-Code. */
  getTenantCode(): string | null;
  /** Timeout por pedido. Generoso: um lote pode trazer muito. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): SyncTransport {
  const timeout = opts.timeoutMs ?? 60_000;
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function call<T>(path: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const auth = opts.getAuthHeader();
    if (auth) headers.Authorization = auth;
    const tenant = opts.getTenantCode();
    if (tenant) headers['X-Tenant-Code'] = tenant;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      const aborted = (e as Error)?.name === 'AbortError';
      throw new TransportError(0, aborted
        ? 'O servidor demorou demasiado a responder.'
        : 'Sem ligação ao servidor.');
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      let msg = `Erro ${res.status}`;
      let code: string | undefined;
      let parsed: unknown;
      try {
        parsed = await res.json();
        const m = (parsed as { message?: string | string[]; code?: string });
        if (Array.isArray(m.message)) msg = m.message.join('; ');
        else if (typeof m.message === 'string') msg = m.message;
        code = m.code;
      } catch { /* resposta sem corpo JSON */ }
      throw new TransportError(res.status, msg, code, parsed);
    }
    return (await res.json()) as T;
  }

  return {
    pull: (req) => call<PullResponse>('/sync/pull', req),
    push: (ops) => call<PushResponse>('/sync/push', { ops }),
  };
}
