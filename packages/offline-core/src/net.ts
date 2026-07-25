/**
 * Monitor de ligação.
 *
 * `navigator.onLine` não serve sozinho: ele só diz que existe uma interface de
 * rede ligada. Num hotel com portal cativo, num hotspot 3G sem saldo, ou com a
 * API a acordar no Render, o `onLine` diz `true` e a sincronização falha na
 * mesma. Por isso distinguimos três estados reais — OFFLINE, SERVER_DOWN e
 * ONLINE — e o veredicto vem sempre de uma sonda ao `/health`, nunca do browser.
 *
 * A sondagem é adaptativa para não gastar bateria nem dados: rara quando está
 * tudo bem, agressiva quando estamos à espera do regresso.
 */
import { backoffDelay, type BackoffPolicy } from './backoff';
import type { LinkState } from './types';

export interface NetMonitorOptions {
  /** URL absoluto do `/health` da API. */
  healthUrl: string;
  /** Sonda de rotina quando está ONLINE. */
  healthyIntervalMs?: number;
  /** Timeout da própria sonda. Curto de propósito: é um sinal, não um pedido. */
  probeTimeoutMs?: number;
  /** Recuo usado enquanto se espera pelo regresso do servidor. */
  backoff?: Partial<BackoffPolicy>;
  /** Injeção para testes. */
  fetchImpl?: typeof fetch;
}

const RECOVERY_BACKOFF: BackoffPolicy = {
  baseMs: 3_000,
  maxMs: 60_000, // nunca esperar mais de 1 min para reparar que a net voltou
  factor: 1.8,
  jitter: 0.4,
};

export class NetMonitor {
  private state: LinkState = 'ONLINE';
  private listeners = new Set<(s: LinkState) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private failures = 0;
  private probing = false;
  /** Deriva do relógio local face ao servidor, em ms. */
  private skewMs = 0;

  private readonly healthyInterval: number;
  private readonly probeTimeout: number;
  private readonly backoff: BackoffPolicy;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: NetMonitorOptions) {
    this.healthyInterval = opts.healthyIntervalMs ?? 60_000;
    this.probeTimeout = opts.probeTimeoutMs ?? 8_000;
    this.backoff = { ...RECOVERY_BACKOFF, ...opts.backoff };
    this.fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    if (typeof navigator !== 'undefined' && navigator.onLine === false) this.state = 'OFFLINE';
  }

  getState(): LinkState { return this.state; }
  getClockSkewMs(): number { return this.skewMs; }

  subscribe(fn: (s: LinkState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => { this.listeners.delete(fn); };
  }

  private set(next: LinkState): void {
    if (next === this.state) return;
    this.state = next;
    for (const fn of this.listeners) fn(next);
  }

  start(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    window.addEventListener('online', this.onBrowserOnline);
    window.addEventListener('offline', this.onBrowserOffline);
    // O utilizador voltar à aplicação é o melhor momento para reavaliar: muitas
    // vezes esteve com o portátil suspenso e o evento `online` perdeu-se.
    document.addEventListener('visibilitychange', this.onVisibility);
    void this.probe();
  }

  stop(): void {
    if (!this.started || typeof window === 'undefined') return;
    this.started = false;
    window.removeEventListener('online', this.onBrowserOnline);
    window.removeEventListener('offline', this.onBrowserOffline);
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private onBrowserOnline = (): void => { void this.probe(); };
  private onBrowserOffline = (): void => {
    this.failures = 0;
    this.set('OFFLINE');
    this.schedule();
  };
  private onVisibility = (): void => {
    if (document.visibilityState === 'visible' && this.state !== 'ONLINE') void this.probe();
  };

  /** Força uma sonda imediata. Devolve o estado resultante. */
  async probe(): Promise<LinkState> {
    if (this.probing) return this.state;
    this.probing = true;
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        this.set('OFFLINE');
        return this.state;
      }
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.probeTimeout);
      const sentAt = Date.now();
      try {
        const res = await this.fetchImpl(this.opts.healthUrl, {
          method: 'GET',
          // `no-store` impede que um proxy nos devolva um "estou vivo" de ontem.
          cache: 'no-store',
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`health ${res.status}`);
        this.measureSkew(res, sentAt);
        this.failures = 0;
        this.set('ONLINE');
      } finally {
        clearTimeout(t);
      }
    } catch {
      this.failures++;
      // Distinguimos "sem rede" de "servidor em baixo": só assim a UI consegue
      // dizer a verdade ao utilizador em vez de um "sem internet" genérico.
      this.set(typeof navigator !== 'undefined' && navigator.onLine === false
        ? 'OFFLINE'
        : 'SERVER_DOWN');
    } finally {
      this.probing = false;
      this.schedule();
    }
    return this.state;
  }

  /** Mede a deriva do relógio local pelo cabeçalho `Date` da resposta. */
  private measureSkew(res: Response, sentAt: number): void {
    const header = res.headers.get('date');
    if (!header) return;
    const serverMs = Date.parse(header);
    if (!Number.isFinite(serverMs)) return;
    // Compensa metade do tempo de ida-e-volta.
    const rtt = Date.now() - sentAt;
    this.skewMs = Math.round(serverMs + rtt / 2 - Date.now());
  }

  private schedule(): void {
    if (!this.started) return;
    if (this.timer !== null) clearTimeout(this.timer);
    const delay = this.state === 'ONLINE'
      ? this.healthyInterval
      : backoffDelay(Math.max(1, this.failures), this.backoff);
    this.timer = setTimeout(() => { void this.probe(); }, delay);
  }
}
