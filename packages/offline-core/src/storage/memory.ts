/**
 * Armazenamento em memória. Serve dois propósitos:
 *   • testes determinísticos do motor, sem browser nem ficheiros;
 *   • última rede de segurança quando o IndexedDB está bloqueado (modo privado,
 *     política de empresa). Nesse caso o sistema continua a FUNCIONAR — só não
 *     sobrevive a um fecho da aplicação, e o motor avisa disso na UI.
 */
import { TABLES, entityKey, type StorageAdapter } from './adapter';
import type { CachedEntity, OutboxOp, OutboxStatus, SyncLogEntry } from '../types';

export class MemoryAdapter implements StorageAdapter {
  readonly kind = 'memory' as const;
  private meta = new Map<string, unknown>();
  private outbox = new Map<string, OutboxOp>();
  private entities = new Map<string, CachedEntity>();
  private log: SyncLogEntry[] = [];
  private seq = 0;

  async open(): Promise<void> { /* nada a abrir */ }
  async close(): Promise<void> {
    this.meta.clear(); this.outbox.clear(); this.entities.clear(); this.log = [];
  }

  async metaGet<T>(key: string): Promise<T | null> {
    return (this.meta.get(key) as T | undefined) ?? null;
  }
  async metaSet<T>(key: string, value: T): Promise<void> { this.meta.set(key, value); }
  async metaDelete(key: string): Promise<void> { this.meta.delete(key); }

  async outboxAppend(op: OutboxOp): Promise<void> {
    if (!this.outbox.has(op.opId)) this.outbox.set(op.opId, op);
  }
  async outboxNextSeq(): Promise<number> { return ++this.seq; }
  async outboxDue(now: number, limit: number): Promise<OutboxOp[]> {
    return this.sorted()
      .filter((o) => o.status === 'PENDING' && o.nextAttemptAt <= now)
      .slice(0, limit);
  }
  async outboxAll(): Promise<OutboxOp[]> { return this.sorted(); }
  async outboxGet(opId: string): Promise<OutboxOp | null> { return this.outbox.get(opId) ?? null; }
  async outboxUpdate(op: OutboxOp): Promise<void> { this.outbox.set(op.opId, op); }
  async outboxDelete(opId: string): Promise<void> { this.outbox.delete(opId); }
  async outboxCount(status?: OutboxStatus): Promise<number> {
    return status ? this.sorted().filter((o) => o.status === status).length : this.outbox.size;
  }
  private sorted(): OutboxOp[] {
    return [...this.outbox.values()].sort((a, b) => a.seq - b.seq);
  }

  async entityPut(rows: CachedEntity[]): Promise<void> {
    for (const r of rows) this.entities.set(entityKey(r.entity, r.id), r);
  }
  async entityGet<T>(entity: string, id: string): Promise<CachedEntity<T> | null> {
    return (this.entities.get(entityKey(entity, id)) as CachedEntity<T> | undefined) ?? null;
  }
  async entityList<T>(entity: string): Promise<CachedEntity<T>[]> {
    return [...this.entities.values()].filter((e) => e.entity === entity) as CachedEntity<T>[];
  }
  async entityDelete(entity: string, id: string): Promise<void> {
    this.entities.delete(entityKey(entity, id));
  }
  async entityClear(entity: string): Promise<void> {
    for (const [k, v] of this.entities) if (v.entity === entity) this.entities.delete(k);
  }

  async logAppend(entry: SyncLogEntry): Promise<void> { this.log.push(entry); }
  async logTail(limit: number): Promise<SyncLogEntry[]> {
    return this.log.slice(-limit).reverse();
  }
  async logTrim(keep: number): Promise<void> { this.log = this.log.slice(-keep); }
}

/** Nome das tabelas, reexportado para quem só importa este módulo. */
export { TABLES };
