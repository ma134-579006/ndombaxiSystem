/**
 * Motor de sincronização da Caixa. Deteta a ligação e, quando há internet,
 * esvazia a fila de vendas offline — cada venda é emitida no servidor e recebe
 * aí o seu número fiscal real (sequência AGT sem saltos).
 */
import { api, ApiError } from '../api/client';
import {
  countPendingSales,
  deleteSale,
  listPendingSales,
  updateSale,
  type PendingSale,
} from './db';

export interface SyncState {
  online: boolean;
  pending: number;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
}

type Listener = (state: SyncState) => void;

class SyncController {
  private state: SyncState = {
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pending: 0,
    syncing: false,
    lastSyncAt: null,
    lastError: null,
  };
  private listeners = new Set<Listener>();
  private started = false;
  private timer: number | null = null;

  getState(): SyncState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  /** Inicia a deteção de rede + verificação periódica (uma só vez). */
  start(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    void this.refreshCount();
    // Rede de segurança: tenta sincronizar a cada 30s se houver pendências.
    this.timer = window.setInterval(() => {
      if (this.state.online && this.state.pending > 0) void this.flush();
    }, 30_000);
  }

  stop(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.started = false;
  }

  private handleOnline = () => {
    this.emit({ online: true });
    void this.flush();
  };
  private handleOffline = () => this.emit({ online: false });

  async refreshCount(): Promise<void> {
    this.emit({ pending: await countPendingSales() });
  }

  /** Reemite uma venda específica da fila (revisão manual, ex.: corrigir um ERRO). */
  async retryOne(id: number): Promise<boolean> {
    const sale = (await listPendingSales()).find((s) => s.id === id);
    if (!sale) return false;
    this.emit({ lastError: null });
    const ok = await this.emitOne(sale);
    await this.refreshCount();
    if (ok) this.emit({ lastSyncAt: new Date().toISOString() });
    return ok;
  }

  /** Remove uma venda da fila sem a emitir (descartar definitivamente). */
  async discard(id: number): Promise<void> {
    await deleteSale(id);
    await this.refreshCount();
  }

  /** Esvazia a fila: emite cada venda pendente no servidor, por ordem. */
  async flush(): Promise<{ synced: number; failed: number }> {
    if (this.state.syncing) return { synced: 0, failed: 0 };
    this.emit({ syncing: true, lastError: null });
    let synced = 0;
    let failed = 0;
    try {
      const sales = (await listPendingSales()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const sale of sales) {
        if (!navigator.onLine) break;
        const ok = await this.emitOne(sale);
        if (ok) synced++;
        else failed++;
      }
      this.emit({ lastSyncAt: new Date().toISOString() });
    } finally {
      await this.refreshCount();
      this.emit({ syncing: false });
    }
    return { synced, failed };
  }

  private async emitOne(sale: PendingSale): Promise<boolean> {
    try {
      await api.emitInvoice({
        customerId: sale.customerId ?? undefined,
        lines: sale.lines.map((l) => ({ productCode: l.productCode, quantity: l.quantity })),
      });
      if (sale.id != null) await deleteSale(sale.id);
      return true;
    } catch (e) {
      // Erro de validação do servidor (4xx) → não vale a pena repetir em loop;
      // marca ERROR para revisão manual. Erro de rede → fica PENDING e tenta depois.
      const isClient = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 0;
      const updated: PendingSale = {
        ...sale,
        status: isClient ? 'ERROR' : 'PENDING',
        attempts: sale.attempts + 1,
        lastError: e instanceof Error ? e.message : 'Falha desconhecida',
      };
      try {
        await updateSale(updated);
      } catch {
        /* ignore */
      }
      if (e instanceof ApiError && e.status === 401) this.emit({ lastError: 'Sessão expirada — entre novamente.' });
      else this.emit({ lastError: updated.lastError ?? null });
      return false;
    }
  }
}

export const syncController = new SyncController();
