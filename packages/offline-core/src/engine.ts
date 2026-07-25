/**
 * O motor de sincronização.
 *
 * Contrato com o resto da aplicação, em três frases:
 *   • `enqueue()` NUNCA falha e NUNCA bloqueia. Grava e devolve. Se houver rede,
 *     sobe já; se não houver, sobe depois. O utilizador não fica à espera nem é
 *     interrogado — não há diálogos, não há botão "sincronizar agora".
 *   • O que estiver na outbox está em disco. Sobrevive a corte de energia.
 *   • O servidor é a autoridade de identidade fiscal. O cliente é a autoridade
 *     de intenção. `opId` é a ponte entre as duas e garante exatamente-uma-vez.
 */
import { nextAttemptAt, type BackoffPolicy } from './backoff';
import { canOverwriteCache, resolveConflict } from './conflict';
import { uuid } from './crypto';
import { NetMonitor } from './net';
import type { StorageAdapter } from './storage/adapter';
import { TransportError, type SyncTransport } from './transport';
import type {
  CachedEntity, LinkState, OutboxOp, PullChange, SyncLogEntry, SyncStatus,
} from './types';

const META_CURSOR = 'sync.cursor';
const META_IDMAP = 'sync.idmap';
const LOG_KEEP = 500;

export interface SyncEngineOptions {
  storage: StorageAdapter;
  transport: SyncTransport;
  net: NetMonitor;
  /** Entidades a manter em cache local. */
  entities: string[];
  /** Operações por lote no push. */
  pushBatchSize?: number;
  /** Registos por página no pull. */
  pullPageSize?: number;
  /** Ciclo de fundo quando está tudo em dia. */
  idleIntervalMs?: number;
  backoff?: Partial<BackoffPolicy>;
  /** Chamado quando o servidor rejeita a sessão — a app renova o token. */
  onAuthExpired?: () => void;
}

export class SyncEngine {
  private status: SyncStatus = {
    link: 'ONLINE', pending: 0, blocked: 0, syncing: false,
    lastSyncAt: null, lastError: null, clockSkewMs: 0,
  };
  private listeners = new Set<(s: SyncStatus) => void>();
  private running = false;
  private cycleInFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeNet: (() => void) | null = null;
  /** localId → id do servidor, para reescrever referências de operações seguintes. */
  private idMap: Record<string, string> = {};

  private readonly pushBatch: number;
  private readonly pullPage: number;
  private readonly idleInterval: number;

  constructor(private readonly o: SyncEngineOptions) {
    this.pushBatch = o.pushBatchSize ?? 50;
    this.pullPage = o.pullPageSize ?? 500;
    this.idleInterval = o.idleIntervalMs ?? 45_000;
  }

  // ── Ciclo de vida ──────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.o.storage.open();
    this.idMap = (await this.o.storage.metaGet<Record<string, string>>(META_IDMAP)) ?? {};

    // RECUPERAÇÃO DE FALHA: qualquer operação que ficou INFLIGHT é de um arranque
    // anterior que morreu a meio do envio. Volta a PENDING — reenviá-la é seguro
    // porque o `opId` faz o servidor reconhecê-la como duplicada se já entrou.
    // É este passo que impede uma venda de ficar presa após um corte de energia.
    let recovered = 0;
    for (const op of await this.o.storage.outboxAll()) {
      if (op.status === 'INFLIGHT') {
        await this.o.storage.outboxUpdate({ ...op, status: 'PENDING', nextAttemptAt: 0 });
        recovered++;
      }
    }
    if (recovered > 0) {
      await this.log('warn', 'recuperacao-arranque', `${recovered} operação(ões) reposta(s) na fila`);
    }

    this.unsubscribeNet = this.o.net.subscribe((link) => this.onLinkChange(link));
    this.o.net.start();
    await this.refreshCounters();
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.unsubscribeNet?.();
    this.unsubscribeNet = null;
    this.o.net.stop();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  getStatus(): SyncStatus { return this.status; }

  subscribe(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => { this.listeners.delete(fn); };
  }

  private emit(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) fn(this.status);
  }

  private onLinkChange(link: LinkState): void {
    this.emit({ link, clockSkewMs: this.o.net.getClockSkewMs() });
    // A internet voltou: ataca já, sem esperar pelo ciclo de fundo.
    if (link === 'ONLINE' && this.running) this.schedule(0);
  }

  // ── Escrita local (o que a aplicação chama) ────────────────

  /**
   * Regista uma mutação. Devolve assim que estiver DURÁVEL em disco — não espera
   * pelo servidor. É esta a razão de o POS continuar a vender sem internet.
   *
   * @returns o `opId`, que a UI pode usar para acompanhar o estado da operação.
   */
  async enqueue(input: {
    entity: string;
    op: OutboxOp['op'];
    payload: unknown;
    /** id local; gerado se omitido. */
    localId?: string;
    /** Versão em que a edição se baseou (updates). */
    baseVersion?: number | null;
    /** Estado a mostrar já na UI (atualização otimista). */
    optimistic?: unknown;
  }): Promise<string> {
    const localId = input.localId ?? uuid();
    const op: OutboxOp = {
      opId: uuid(),
      seq: await this.o.storage.outboxNextSeq(),
      entity: input.entity,
      op: input.op,
      localId,
      payload: input.payload,
      baseVersion: input.baseVersion ?? null,
      createdAt: new Date().toISOString(),
      attempts: 0,
      nextAttemptAt: 0,
      status: 'PENDING',
    };
    await this.o.storage.outboxAppend(op); // ← ponto de durabilidade

    // Atualização otimista: o registo aparece no ecrã de imediato, marcado como
    // `dirty` para que uma descida do servidor não o apague antes de ter subido.
    if (input.optimistic !== undefined) {
      const existing = await this.o.storage.entityGet(input.entity, localId);
      await this.o.storage.entityPut([{
        entity: input.entity,
        id: localId,
        data: input.optimistic,
        version: existing?.version ?? 0,
        updatedAt: op.createdAt,
        deleted: input.op === 'delete',
        dirty: true,
      }]);
    }

    await this.refreshCounters();
    if (this.status.link === 'ONLINE') this.schedule(0);
    return op.opId;
  }

  // ── Leitura local ──────────────────────────────────────────

  list<T>(entity: string): Promise<CachedEntity<T>[]> {
    return this.o.storage.entityList<T>(entity);
  }
  get<T>(entity: string, id: string): Promise<CachedEntity<T> | null> {
    return this.o.storage.entityGet<T>(entity, id);
  }
  outbox(): Promise<OutboxOp[]> { return this.o.storage.outboxAll(); }
  logTail(limit = 100): Promise<SyncLogEntry[]> { return this.o.storage.logTail(limit); }

  /** Descarta uma operação BLOCKED depois de o gestor decidir. */
  async discard(opId: string): Promise<void> {
    const op = await this.o.storage.outboxGet(opId);
    if (!op) return;
    await this.o.storage.outboxDelete(opId);
    await this.o.storage.entityDelete(op.entity, op.localId);
    await this.log('warn', 'operacao-descartada', `${op.entity} ${op.opId}`);
    await this.refreshCounters();
  }

  /** Repõe uma operação BLOCKED na fila (o gestor corrigiu a causa). */
  async retry(opId: string): Promise<void> {
    const op = await this.o.storage.outboxGet(opId);
    if (!op) return;
    await this.o.storage.outboxUpdate({ ...op, status: 'PENDING', attempts: 0, nextAttemptAt: 0 });
    await this.refreshCounters();
    this.schedule(0);
  }

  // ── Motor ──────────────────────────────────────────────────

  private schedule(delayMs: number): void {
    if (!this.running) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.cycle(); }, delayMs);
  }

  /** Força um ciclo agora (usado no arranque e nos testes). */
  sync(): Promise<void> { return this.cycle(); }

  /** Um ciclo completo: subir primeiro, descer depois. Nunca dois em paralelo. */
  private cycle(): Promise<void> {
    if (this.cycleInFlight) return this.cycleInFlight;
    this.cycleInFlight = this.runCycle().finally(() => { this.cycleInFlight = null; });
    return this.cycleInFlight;
  }

  private async runCycle(): Promise<void> {
    if (!this.running) return;
    if (this.status.link !== 'ONLINE') { this.schedule(this.idleInterval); return; }

    this.emit({ syncing: true, lastError: null });
    try {
      // A ordem importa: subimos ANTES de descer. Se descêssemos primeiro, uma
      // venda local ainda por subir podia ser sobreposta pelo estado do servidor.
      await this.pushAll();
      await this.pullAll();
      this.emit({ lastSyncAt: new Date().toISOString() });
    } catch (e) {
      const err = e as Error;
      if (e instanceof TransportError && e.authExpired) {
        this.emit({ lastError: 'Sessão expirada — entre novamente.' });
        this.o.onAuthExpired?.();
        await this.log('error', 'sessao-expirada', err.message);
      } else {
        this.emit({ lastError: err.message });
        await this.log('error', 'ciclo-falhou', err.message);
      }
      // Uma falha de ciclo nunca perde nada: as operações continuam na outbox.
      await this.o.net.probe();
    } finally {
      await this.refreshCounters();
      this.emit({ syncing: false, clockSkewMs: this.o.net.getClockSkewMs() });
      await this.o.storage.logTrim(LOG_KEEP);
      // Se ainda há trabalho pronto a sair, volta depressa; senão, descansa.
      const due = await this.o.storage.outboxDue(Date.now(), 1);
      this.schedule(due.length > 0 ? 1_000 : this.idleInterval);
    }
  }

  /** Esvazia a outbox por lotes, respeitando a ordem de criação. */
  private async pushAll(): Promise<void> {
    for (;;) {
      if (!this.running || this.status.link !== 'ONLINE') return;
      const batch = await this.o.storage.outboxDue(Date.now(), this.pushBatch);
      if (batch.length === 0) return;

      // Marca INFLIGHT antes de sair: se a app morrer agora, o arranque seguinte
      // repõe-nas em PENDING e o `opId` evita a duplicação.
      const prepared: OutboxOp[] = [];
      for (const op of batch) {
        const rewritten = this.rewriteIds(op);
        await this.o.storage.outboxUpdate({ ...rewritten, status: 'INFLIGHT' });
        prepared.push(rewritten);
      }

      let response;
      try {
        response = await this.o.transport.push(prepared);
      } catch (e) {
        await this.failBatch(prepared, e as Error);
        // Falha de rede a meio: sai do ciclo e tenta no próximo. Nada se perde.
        return;
      }

      const byId = new Map(response.results.map((r) => [r.opId, r]));
      for (const op of prepared) {
        const result = byId.get(op.opId);
        if (!result) {
          // O servidor não se pronunciou sobre esta. Repõe em fila — reenviar é
          // inofensivo graças à idempotência.
          await this.o.storage.outboxUpdate({
            ...op, status: 'PENDING', attempts: op.attempts + 1,
            nextAttemptAt: nextAttemptAt(op.attempts + 1, Date.now(), this.o.backoff as BackoffPolicy),
          });
          continue;
        }
        await this.applyPushResult(op, result);
      }
      await this.refreshCounters();
    }
  }

  private async applyPushResult(op: OutboxOp, result: import('./types').PushResult): Promise<void> {
    switch (result.status) {
      case 'applied':
      case 'duplicate': {
        // Guarda o id real para que operações seguintes que referenciem o id
        // local passem a apontar para o registo verdadeiro.
        if (result.serverId && result.serverId !== op.localId) {
          this.idMap[op.localId] = result.serverId;
          await this.o.storage.metaSet(META_IDMAP, this.idMap);
        }
        if (result.entity) {
          await this.applyChange(result.entity, { force: true });
          // O registo local provisório dá lugar ao definitivo do servidor.
          if (result.serverId && result.serverId !== op.localId) {
            await this.o.storage.entityDelete(op.entity, op.localId);
          }
        } else {
          const cached = await this.o.storage.entityGet(op.entity, op.localId);
          if (cached) await this.o.storage.entityPut([{ ...cached, dirty: false }]);
        }
        await this.o.storage.outboxDelete(op.opId);
        if (result.status === 'duplicate') {
          await this.log('info', 'idempotencia', `${op.entity} ${op.opId} já estava aplicada`);
        }
        return;
      }

      case 'rejected': {
        await this.o.storage.outboxUpdate({
          ...op, status: 'BLOCKED',
          lastError: result.message ?? 'Recusada pelo servidor.',
          ...(result.code ? { lastErrorCode: result.code } : {}),
        });
        await this.log('error', 'operacao-recusada',
          `${op.entity} ${op.opId}: ${result.message ?? 'sem detalhe'}`);
        return;
      }

      case 'conflict': {
        if (!result.entity) {
          await this.o.storage.outboxUpdate({
            ...op, status: 'BLOCKED', lastError: 'Conflito sem estado do servidor.',
          });
          return;
        }
        const decision = resolveConflict(op, result.entity);
        if (decision.action === 'accept-server') {
          await this.applyChange(decision.entity, { force: true });
          await this.o.storage.outboxDelete(op.opId);
          await this.log('warn', 'conflito-servidor-ganhou', `${op.entity} ${op.localId}`);
        } else if (decision.action === 'retry-rebased') {
          await this.o.storage.outboxUpdate({
            ...op, status: 'PENDING', payload: decision.payload,
            baseVersion: decision.baseVersion, attempts: op.attempts + 1,
            nextAttemptAt: 0,
          });
          await this.log('warn', 'conflito-reaplicado', `${op.entity} ${op.localId}`);
        } else {
          await this.o.storage.outboxUpdate({ ...op, status: 'BLOCKED', lastError: decision.reason });
          await this.log('error', 'conflito-bloqueado', `${op.entity} ${op.localId}: ${decision.reason}`);
        }
        return;
      }
    }
  }

  private async failBatch(batch: OutboxOp[], error: Error): Promise<void> {
    const retryable = !(error instanceof TransportError) || error.retryable;
    for (const op of batch) {
      const attempts = op.attempts + 1;
      await this.o.storage.outboxUpdate({
        ...op,
        // Erro de negócio (4xx) não se repete em ciclo infinito — pára e avisa.
        status: retryable ? 'PENDING' : 'BLOCKED',
        attempts,
        nextAttemptAt: retryable
          ? nextAttemptAt(attempts, Date.now(), this.o.backoff as BackoffPolicy)
          : 0,
        lastError: error.message,
      });
    }
    await this.log(retryable ? 'warn' : 'error', 'lote-falhou',
      `${batch.length} operação(ões): ${error.message}`);
    if (error instanceof TransportError && error.authExpired) throw error;
  }

  /**
   * Substitui ids locais por ids do servidor no payload. Sem isto, uma venda
   * feita offline para um cliente também criado offline subiria a apontar para
   * um id que o servidor não conhece.
   */
  private rewriteIds(op: OutboxOp): OutboxOp {
    if (Object.keys(this.idMap).length === 0) return op;
    const swap = (v: unknown): unknown => {
      if (typeof v === 'string') return this.idMap[v] ?? v;
      if (Array.isArray(v)) return v.map(swap);
      if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = swap(val);
        return out;
      }
      return v;
    };
    return { ...op, payload: swap(op.payload) };
  }

  /** Descida incremental, página a página, até esgotar o que mudou. */
  private async pullAll(): Promise<void> {
    let cursor = await this.o.storage.metaGet<string>(META_CURSOR);
    for (let page = 0; page < 100; page++) {
      if (!this.running || this.status.link !== 'ONLINE') return;
      const res = await this.o.transport.pull({
        since: cursor,
        entities: this.o.entities,
        limit: this.pullPage,
      });
      for (const change of res.changes) await this.applyChange(change, { force: false });
      cursor = res.cursor;
      await this.o.storage.metaSet(META_CURSOR, cursor);
      if (!res.hasMore) return;
    }
    await this.log('warn', 'pull-truncado', 'limite de páginas atingido num só ciclo');
  }

  private async applyChange(change: PullChange, opts: { force: boolean }): Promise<void> {
    const cached = await this.o.storage.entityGet(change.entity, change.id);
    if (!opts.force && !canOverwriteCache(cached, change)) return;
    if (change.deleted) {
      // Apagamos localmente, mas o servidor mantém a lápide — a auditoria
      // nunca perde o rasto de nada.
      await this.o.storage.entityDelete(change.entity, change.id);
      return;
    }
    await this.o.storage.entityPut([{
      entity: change.entity,
      id: change.id,
      data: change.data,
      version: change.version,
      updatedAt: change.updatedAt,
      deleted: false,
      dirty: false,
    }]);
  }

  private async refreshCounters(): Promise<void> {
    const [pending, blocked, inflight] = await Promise.all([
      this.o.storage.outboxCount('PENDING'),
      this.o.storage.outboxCount('BLOCKED'),
      this.o.storage.outboxCount('INFLIGHT'),
    ]);
    this.emit({ pending: pending + inflight, blocked });
  }

  private async log(level: SyncLogEntry['level'], event: string, detail?: string): Promise<void> {
    try {
      await this.o.storage.logAppend({
        at: new Date().toISOString(), level, event,
        ...(detail ? { detail } : {}),
      });
    } catch { /* o diário nunca pode derrubar a sincronização */ }
  }
}
