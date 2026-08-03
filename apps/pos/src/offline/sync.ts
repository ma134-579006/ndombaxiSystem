/**
 * Motor de sincronização da Caixa. Deteta a ligação e, quando há internet,
 * esvazia a fila de vendas offline — cada venda é emitida no servidor e recebe
 * aí o seu número fiscal real (sequência AGT sem saltos).
 */
import { api, ApiError } from '../api/client';
import { deviceKey } from './device';
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
    // OTIMISTA, e nunca `navigator.onLine`: nas apps nativas (Electron
    // `ndombaxi://` e WebView Android) ele reporta `false` mesmo com internet.
    // A ligação real é decidida pelo RESULTADO dos pedidos (ver `flush`).
    online: true,
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
    // NÃO exige `state.online`: a tentativa É a deteção. Com o antigo requisito,
    // uma app nativa cujo `navigator.onLine` mentia ficava com `online:false` e
    // NUNCA voltava a tentar — as vendas offline ficavam encalhadas para sempre.
    this.timer = window.setInterval(() => {
      if (this.state.pending > 0) void this.flush();
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
    const ok = (await this.emitOne(sale)) === 'ok'; // 'failed'/'offline' → não emitida
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
        // A ligação é decidida pelo RESULTADO de cada emissão, nunca por
        // `navigator.onLine` (mente nas apps nativas). Só uma falha de REDE
        // interrompe o ciclo — uma recusa do servidor não segura as restantes.
        const outcome = await this.emitOne(sale);
        if (outcome === 'ok') { synced++; this.emit({ online: true }); }
        else if (outcome === 'offline') { this.emit({ online: false }); break; }
        else failed++;
      }
      this.emit({ lastSyncAt: new Date().toISOString() });
    } finally {
      await this.refreshCount();
      this.emit({ syncing: false });
    }
    return { synced, failed };
  }

  /**
   * Resultado de uma emissão:
   *   • `ok`      — emitida e removida da fila;
   *   • `failed`  — o servidor recusou/erro dele; as outras vendas continuam;
   *   • `offline` — não há ligação utilizável AGORA; o ciclo pára e repete depois.
   */
  private async emitOne(sale: PendingSale): Promise<'ok' | 'failed' | 'offline'> {
    try {
      await api.emitInvoice({
        customerId: sale.customerId ?? undefined,
        // A MESMA chave em todas as tentativas: se o servidor já tiver gravado
        // esta venda (resposta perdida), devolve a fatura original em vez de
        // criar uma segunda. Vendas em fila de versões anteriores não têm chave
        // e mantêm o comportamento antigo — nada rebenta por causa disso.
        clientOpId: sale.clientOpId,
        // A série tem de ser a DESTE posto também no reenvio da fila — senão
        // uma venda feita aqui sem rede entrava na cadeia de outra caixa.
        deviceKey: await deviceKey(),
        lines: sale.lines.map((l) => ({ productCode: l.productCode, quantity: l.quantity })),
      });
      if (sale.id != null) await deleteSale(sale.id);
      return 'ok';
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
      // `status === 0` é a falha de REDE do api client (sem ligação ou timeout):
      // a venda continua PENDING e o ciclo pára até haver ligação outra vez.
      return e instanceof ApiError && e.status === 0 ? 'offline' : 'failed';
    }
  }
}

export const syncController = new SyncController();
