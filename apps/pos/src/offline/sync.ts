/**
 * Motor de sincronização da Caixa. Deteta a ligação e, quando há internet,
 * esvazia a fila de vendas offline — cada venda é emitida no servidor e recebe
 * aí o seu número fiscal real (sequência AGT sem saltos).
 */
import { api, ApiError, confirmarRede, replayQueuedWrites } from '../api/client';
import type { PaymentType } from '../api/types';
import { outboxCount, resolveLocalId } from './outbox';
import { sharedSet } from '../sharedCache';

/**
 * MEMÓRIA PARTILHADA COM O GESTÃO: as vendas feitas sem rede que ainda não
 * subiram ficam visíveis no Gestão do mesmo aparelho (no Android os dois correm
 * na mesma origem e partilham esta memória). Sai da lista quando sobe.
 */
export const VENDAS_PENDENTES_KEY = 'partilha:caixa:vendas-pendentes';
async function publicarVendasPendentes(): Promise<void> {
  try {
    const vendas = await listPendingSales();
    await sharedSet(VENDAS_PENDENTES_KEY, vendas.map((v) => ({
      localRef: v.localRef, createdAt: v.createdAt, customerName: v.customerName, grossTotal: v.grossTotal,
      netTotal: v.netTotal, ivaTotal: v.ivaTotal, status: v.status, lastError: v.lastError ?? null,
      lines: v.lines.map((l) => ({ productCode: l.productCode, productName: l.productName, quantity: l.quantity, unitPriceGross: l.unitPriceGross })),
    })));
  } catch { /* melhor esforço */ }
}
import { API_URL, isNativeApp } from '../config';
import { deviceKey } from './device';
import {
  limparTurnoLocalSeVazio, opDeTurnoEnviada, opsDeTurnoPendentes, contarOpsDeTurno,
} from './shifts';
import {
  countPendingSales,
  deleteSale,
  listPendingSales,
  updateSale,
  type PendingSale,
} from './db';

/** De quanto em quanto tempo se verifica se a rede voltou (só com algo por subir). */
export const SYNC_PROBE_MS = 3_000;
/** Com rede estável e pendências que não sobem (recusadas), nova tentativa a cada… */
export const SYNC_RETRY_MS = 30_000;

/** Há ligação REAL ao servidor? GET /health curto — nunca `navigator.onLine`. */
async function probeServer(): Promise<boolean> {
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), 4_000);
  try {
    const r = await fetch(`${API_URL.replace(/\/$/, '')}/health`, { signal: ctl.signal, cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(t);
  }
}

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
    // Navegador: 100% online — sem fila nem sincronização de vendas.
    if (!isNativeApp()) return;
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    window.addEventListener('ndombaxi:outbox-changed', this.handleQueued);
    window.addEventListener('ndombaxi:session-renewed', this.handleOnline);
    window.addEventListener('focus', this.handleWake);
    document.addEventListener('visibilitychange', this.handleWake);
    // Arranque: o que ficou por subir de uma sessão anterior sobe logo.
    void this.refreshCount().then(() => { if (this.state.pending > 0) void this.flush(); });
    // SINCRONIZAÇÃO INSTANTÂNEA: com trabalho por subir, sonda a ligação a cada
    // poucos segundos (um GET /health, leve) e sobe tudo NO MOMENTO em que a rede
    // volta — sem botão e sem ter de abrir a caixa. Não usa `navigator.onLine`
    // (mente nas apps nativas): a sonda É a deteção.
    this.timer = window.setInterval(() => { void this.tick(); }, SYNC_PROBE_MS);
  }

  /** Volta do relógio: só trabalha quando há algo por subir. */
  private async tick(): Promise<void> {
    if (this.state.pending <= 0 || this.state.syncing) return;
    const ok = await probeServer();
    if (!ok) { if (this.state.online) this.emit({ online: false }); return; }
    confirmarRede(); // o cliente HTTP deixa de responder "sem rede" da memória
    const voltou = !this.state.online;
    if (voltou) this.emit({ online: true });
    // Rede de volta → sobe já. Com rede estável, repete a cada RETRY_MS: o que
    // fica é o que o servidor recusou (ERRO) e não vale a pena martelar.
    if (voltou || Date.now() - this.lastFlushAt >= SYNC_RETRY_MS) void this.flush();
  }

  stop(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    window.removeEventListener('ndombaxi:outbox-changed', this.handleQueued);
    window.removeEventListener('ndombaxi:session-renewed', this.handleOnline);
    window.removeEventListener('focus', this.handleWake);
    document.removeEventListener('visibilitychange', this.handleWake);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.started = false;
  }

  private handleOnline = () => {
    this.emit({ online: true });
    void this.flush();
  };
  private handleOffline = () => this.emit({ online: false });
  /** Algo entrou na fila: conta e, com rede, sobe logo (não espera pelo relógio). */
  private handleQueued = () => {
    void this.refreshCount().then(() => { if (this.state.pending > 0 && this.state.online) void this.flush(); });
  };
  /** A app voltou ao primeiro plano (telemóvel acordou, janela focada): tenta já. */
  private handleWake = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (this.state.pending > 0) void this.flush();
  };
  private lastFlushAt = 0;

  /**
   * O que falta enviar = vendas + operações de turno.
   *
   * O turno entra na conta de propósito: é este número que a atualização
   * obrigatória usa para decidir se já pode trancar a aplicação. Um fecho de
   * turno por subir é trabalho por salvar tanto como uma venda.
   */
  async refreshCount(): Promise<void> {
    void publicarVendasPendentes();
    // + as outras alterações feitas sem rede (fila de escritas): também é trabalho por salvar.
    this.emit({ pending: (await countPendingSales()) + (await contarOpsDeTurno()) + (await outboxCount().catch(() => 0)) });
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

  /**
   * Sobe as operações de TURNO feitas sem rede.
   *
   * `abertura` decide qual metade se envia, e a razão é de dinheiro: a ABERTURA
   * tem de chegar ao servidor ANTES das vendas do turno, e o FECHO só DEPOIS.
   * O servidor emite a fatura mesmo sem turno aberto (o movimento de caixa é
   * best-effort), por isso vendas que subissem antes da abertura entravam sem
   * cair na gaveta — e o fecho nunca batia certo.
   */
  private async pushTurnos(abertura: boolean): Promise<'ok' | 'offline'> {
    const todas = await opsDeTurnoPendentes();
    const lote = todas.filter((o) => (abertura ? o.op === 'create' : o.op === 'update'));
    if (lote.length === 0) return 'ok';
    try {
      // `createdAt` é obrigatório no servidor: sem ele o lote inteiro era recusado
      // (400) e o turno aberto offline nunca subia ("A enviar 1" para sempre).
      // Operações antigas guardadas sem o campo levam a hora atual.
      const r = await api.syncPush(lote.map((o) => ({ ...o, createdAt: o.createdAt ?? new Date().toISOString() })));
      for (const res of r.results ?? []) {
        // `duplicate` é a idempotência a funcionar: o servidor já tinha esta
        // operação. Sai da fila tal como uma aplicada — insistir criaria ciclo.
        if (res.status === 'applied' || res.status === 'duplicate') {
          await opDeTurnoEnviada(res.opId);
        } else if (res.status === 'rejected') {
          // Recusa de negócio (ex.: já havia turno aberto no servidor). Fica
          // registada e sai da fila: repetir daria o mesmo resultado para sempre.
          await opDeTurnoEnviada(res.opId);
          this.emit({ lastError: res.message ?? 'O servidor recusou uma operação de turno.' });
        }
      }
      await limparTurnoLocalSeVazio();
      return 'ok';
    } catch (e) {
      // Sem ligação: fica tudo na fila, exatamente como estava.
      if (e instanceof ApiError && e.status === 0) return 'offline';
      // Recusa do servidor ao LOTE (ex.: validação): não esconder — fica visível.
      this.emit({ lastError: e instanceof ApiError ? e.message : 'Falha ao enviar o turno.' });
      return 'ok';
    }
  }

  /** Esvazia a fila: emite cada venda pendente no servidor, por ordem. */
  async flush(): Promise<{ synced: number; failed: number }> {
    if (this.state.syncing) return { synced: 0, failed: 0 };
    this.lastFlushAt = Date.now();
    this.emit({ syncing: true, lastError: null });
    let synced = 0;
    let failed = 0;
    try {
      // 1º a ABERTURA do turno — antes de qualquer venda.
      if (await this.pushTurnos(true) === 'offline') {
        this.emit({ online: false });
        return { synced: 0, failed: 0 };
      }
      // Depois as outras alterações feitas sem rede (cliente novo, tema, pedidos…):
      // um cliente criado offline tem de existir na nuvem antes da venda que o usa.
      try { await replayQueuedWrites(); } catch { /* fica para a próxima volta */ }
      const sales = (await listPendingSales()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const sale of sales) {
        // A ligação é decidida pelo RESULTADO de cada emissão, nunca por
        // `navigator.onLine` (mente nas apps nativas). Só uma falha de REDE
        // interrompe o ciclo — uma recusa do servidor não segura as restantes.
        // Venda já RECUSADA antes (ERROR): volta a tentar-se de vez em quando (a
        // causa pode ter sido corrigida no servidor), mas nunca segura o resto.
        const eraErro = sale.status === 'ERROR';
        const outcome = await this.emitOne(sale);
        if (outcome === 'ok') { synced++; this.emit({ online: true }); }
        else if (outcome === 'offline') { this.emit({ online: false }); break; }
        // Sem credencial válida no aparelho (nunca houve login com rede, ou o
        // servidor terminou a sessão): há rede, mas nada sobe até alguém entrar.
        // Não marca "sem rede" — senão o relógio repetia a cada 3 s.
        else if (outcome === 'auth') break;
        else if (outcome === 'skip') continue; // à espera de um cliente criado offline
        else if (!eraErro) failed++;
      }
      // Por fim o FECHO do turno — só depois de as vendas dele terem subido,
      // senão o servidor fechava a caixa sem o dinheiro que ainda vinha a
      // caminho e o resumo saía errado. Uma venda em ERRO (para revisão manual)
      // já não impede o fecho de subir para sempre.
      const porSubir = (await listPendingSales()).filter((v) => v.status !== 'ERROR').length;
      if (failed === 0 && porSubir === 0 && this.state.online) await this.pushTurnos(false);
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
  private async emitOne(sale: PendingSale): Promise<'ok' | 'failed' | 'offline' | 'skip' | 'auth'> {
    // Cliente criado SEM REDE: a venda leva o id definitivo (o provisório não
    // existe na nuvem). Ainda por subir → espera pela próxima volta.
    let customerId = sale.customerId ?? undefined;
    if (customerId?.startsWith('local-')) {
      const real = await resolveLocalId(customerId);
      // Cliente ainda por subir: salta só ESTA venda (não pára as outras).
      if (real === undefined) return 'skip';
      customerId = real ?? undefined;
    }
    try {
      await api.emitInvoice({
        customerId,
        // A MESMA chave em todas as tentativas: se o servidor já tiver gravado
        // esta venda (resposta perdida), devolve a fatura original em vez de
        // criar uma segunda. Vendas em fila de versões anteriores não têm chave
        // e mantêm o comportamento antigo — nada rebenta por causa disso.
        clientOpId: sale.clientOpId,
        // Venda feita SEM REDE: já aconteceu — a nuvem regista-a mesmo que o stock
        // dela esteja desatualizado, em vez de a recusar e a deixar presa aqui.
        offline: true,
        // A série tem de ser a DESTE posto também no reenvio da fila — senão
        // uma venda feita aqui sem rede entrava na cadeia de outra caixa.
        deviceKey: await deviceKey(),
        // O que o cliente pagou e o desconto que lhe foi feito NO MOMENTO da venda.
        ...(sale.paymentType ? { paymentType: sale.paymentType as PaymentType } : {}),
        ...(sale.tendered != null ? { tendered: sale.tendered } : {}),
        ...(sale.changeGiven != null ? { changeGiven: sale.changeGiven } : {}),
        ...(sale.payments?.length ? { payments: sale.payments as never } : {}),
        lines: sale.lines.map((l) => ({
          productCode: l.productCode, quantity: l.quantity,
          ...(l.discountRate && l.discountRate > 0 ? { discountRate: l.discountRate } : {}),
        })),
      }, { background: true });
      if (sale.id != null) await deleteSale(sale.id);
      return 'ok';
    } catch (e) {
      // Erro de validação do servidor (4xx) → não vale a pena repetir em loop;
      // marca ERROR para revisão manual. Erro de rede → fica PENDING e tenta depois.
      // 401 NÃO é erro da venda: é a sessão (ex.: Caixa aberto sem rede, ainda com a
      // sessão provisória). Fica PENDENTE e sobe assim que a sessão for renovada.
      const sessao = e instanceof ApiError && e.status === 401;
      const isClient = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 0 && !sessao;
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
      if (sessao) return 'auth';
      return e instanceof ApiError && e.status === 0 ? 'offline' : 'failed';
    }
  }
}

export const syncController = new SyncController();
