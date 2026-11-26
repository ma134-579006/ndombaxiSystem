/**
 * IDENTIDADE DE SINCRONIZAÇÃO da Caixa — lógica pura (sem browser), testável.
 *
 * Problema que resolve: as vendas feitas sem rede só subiam com a SESSÃO VIVA do
 * operador. Ao fechar e reabrir a app (a sessão vive em sessionStorage), a fila
 * recebia 401 em cada envio e ficava parada até alguém voltar a entrar na Caixa.
 *
 * Solução: o aparelho guarda, de forma durável, o último par de tokens REAIS
 * (emitidos pelo servidor) e renova-o em conjunto com a sessão viva — o mesmo
 * refresh token, a mesma família, sem revogações cruzadas. Só o motor da fila o
 * usa, e só quando não há sessão viva utilizável (ninguém entrou, ou entrou com
 * um token cunhado no posto). Com sessão viva, a fila usa a sessão viva.
 *
 * Nunca guarda PIN nem senha. Se o servidor recusar o refresh (401/403: sessão
 * terminada, funcionário removido, mais de 7 dias), a identidade é apagada e aí,
 * sim, é preciso entrar — é a única situação em que isso acontece.
 */

export interface TokenPairLike { accessToken: string; refreshToken: string }
export interface SyncIdentity extends TokenPairLike { companyCode: string; savedAt: string }
export type RefreshOutcome = 'ok' | 'rejected' | 'offline' | 'none';
export type LiveAuth = 'loading' | 'authed' | 'guest';

export interface SyncAuthDeps {
  load(): Promise<SyncIdentity | null>;
  save(v: SyncIdentity | null): Promise<void>;
  /** POST /auth/refresh. Erro com `status` numérico (0 = sem rede). */
  refresh(refreshToken: string, companyCode: string): Promise<TokenPairLike>;
  /** Avisado quando o motor roda os tokens (para manter o cofre offline em dia). */
  onRotated?(oldRefresh: string, pair: TokenPairLike): void;
  now?(): number;
}

/** `exp` do JWT em ms (ou null se não der para ler). */
export function jwtExpMs(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b64 + '==='.slice((b64.length + 3) % 4)));
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch { return null; }
}

function statusOf(e: unknown): number {
  const s = (e as { status?: unknown })?.status;
  return typeof s === 'number' ? s : 0;
}

export function createSyncAuth(deps: SyncAuthDeps) {
  const now = deps.now ?? (() => Date.now());
  let cur: SyncIdentity | null = null;
  let loading: Promise<void> | null = null;
  let live: LiveAuth = 'loading';
  let waiters: (() => void)[] = [];
  let inflight: Promise<RefreshOutcome> | null = null;

  const ensureLoaded = (): Promise<void> => {
    if (!loading) loading = deps.load().then((v) => { if (!cur) cur = v; }).catch(() => undefined);
    return loading;
  };

  const persist = async (v: SyncIdentity | null) => {
    cur = v;
    try { await deps.save(v); } catch { /* melhor esforço */ }
  };

  const api = {
    /** Estado da sessão viva (AuthProvider). */
    setLive(state: LiveAuth): void {
      live = state;
      if (state !== 'loading') { const w = waiters; waiters = []; w.forEach((f) => f()); }
    },
    getLive(): LiveAuth { return live; },
    /** Espera que a sessão viva decida (restauro terminado), até `timeoutMs`. */
    waitSettled(timeoutMs = 10_000): Promise<void> {
      if (live !== 'loading') return Promise.resolve();
      return new Promise((res) => {
        const t = setTimeout(res, timeoutMs);
        waiters.push(() => { clearTimeout(t); res(); });
      });
    },
    /** Tokens acabados de chegar do SERVIDOR (login, refresh, promoção). */
    async remember(companyCode: string | undefined | null, pair: TokenPairLike): Promise<void> {
      if (!companyCode || !pair.accessToken || !pair.refreshToken) return;
      await ensureLoaded();
      await persist({ companyCode, accessToken: pair.accessToken, refreshToken: pair.refreshToken, savedAt: new Date(now()).toISOString() });
    },
    async forget(): Promise<void> { await ensureLoaded(); await persist(null); },
    async current(): Promise<SyncIdentity | null> { await ensureLoaded(); return cur; },
    /**
     * Credencial para um pedido do motor da fila. Renova antes se o token de
     * acesso já expirou (ou expira em menos de 30 s). `null` = não há.
     */
    async credential(): Promise<{ accessToken: string; companyCode: string } | null> {
      await ensureLoaded();
      if (!cur) return null;
      const exp = jwtExpMs(cur.accessToken);
      if (exp !== null && exp - now() < 30_000) {
        const r = await api.renew();
        if (r !== 'ok' || !cur) return r === 'offline' && cur ? { accessToken: cur.accessToken, companyCode: cur.companyCode } : null;
      }
      return { accessToken: cur.accessToken, companyCode: cur.companyCode };
    },
    /** Renova (single-flight). `rejected` apaga a identidade. */
    renew(): Promise<RefreshOutcome> {
      if (inflight) return inflight;
      inflight = (async (): Promise<RefreshOutcome> => {
        await ensureLoaded();
        const id = cur;
        if (!id) return 'none';
        try {
          const pair = await deps.refresh(id.refreshToken, id.companyCode);
          await persist({ ...id, accessToken: pair.accessToken, refreshToken: pair.refreshToken, savedAt: new Date(now()).toISOString() });
          try { deps.onRotated?.(id.refreshToken, pair); } catch { /* */ }
          return 'ok';
        } catch (e) {
          const s = statusOf(e);
          if (s === 401 || s === 403) { await persist(null); return 'rejected'; }
          return 'offline';
        }
      })().finally(() => { inflight = null; });
      return inflight;
    },
  };
  return api;
}

export type SyncAuth = ReturnType<typeof createSyncAuth>;
