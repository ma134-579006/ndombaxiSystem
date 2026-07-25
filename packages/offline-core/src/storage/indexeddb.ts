/**
 * Implementação do armazenamento sobre IndexedDB — usada no navegador e no
 * WebView do Capacitor (Android/iOS).
 *
 * Nota sobre transações do IndexedDB: uma transação fecha-se sozinha assim que
 * o ciclo de eventos fica sem pedidos pendentes. Por isso, tudo o que tem de ser
 * atómico é encadeado DENTRO do mesmo `transaction()`, sem `await` a meio.
 */
import {
  TABLES,
  entityKey,
  type StorageAdapter,
} from './adapter';
import type { CachedEntity, OutboxOp, OutboxStatus, SyncLogEntry } from '../types';

const DB_VERSION = 1;
const SEQ_KEY = '__outbox_seq__';

interface EntityRow extends CachedEntity {
  key: string;
}

export class IndexedDbAdapter implements StorageAdapter {
  readonly kind = 'indexeddb' as const;
  private db: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;

  constructor(private readonly dbName = 'ndombaxi-offline') {}

  /** True se o ambiente tem IndexedDB utilizável (falha em modo privado antigo). */
  static supported(): boolean {
    try {
      return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch {
      return false;
    }
  }

  open(): Promise<void> {
    return this.ensure().then(() => undefined);
  }

  private ensure(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    if (this.opening) return this.opening;
    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TABLES.meta)) db.createObjectStore(TABLES.meta);
        if (!db.objectStoreNames.contains(TABLES.outbox)) {
          const s = db.createObjectStore(TABLES.outbox, { keyPath: 'opId' });
          s.createIndex('seq', 'seq', { unique: false });
          s.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains(TABLES.entities)) {
          const s = db.createObjectStore(TABLES.entities, { keyPath: 'key' });
          s.createIndex('entity', 'entity', { unique: false });
        }
        if (!db.objectStoreNames.contains(TABLES.log)) {
          db.createObjectStore(TABLES.log, { autoIncrement: true });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Se outra aba pedir uma versão nova, largamos a ligação para não a bloquear.
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB indisponível'));
      req.onblocked = () => reject(new Error('IndexedDB bloqueado por outra aba'));
    });
    return this.opening.then((db) => {
      this.db = db;
      return db;
    });
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
    this.opening = null;
  }

  /** Corre `fn` numa transação e resolve quando a transação COMPROMETE de facto. */
  private async run<T>(
    stores: string | string[],
    mode: IDBTransactionMode,
    fn: (tx: IDBTransaction) => T | Promise<never>,
  ): Promise<T> {
    const db = await this.ensure();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let out: T;
      try {
        out = fn(tx) as T;
      } catch (e) {
        try { tx.abort(); } catch { /* já abortada */ }
        reject(e);
        return;
      }
      // Só resolvemos em `oncomplete`: em modo escrita isto é o que garante que
      // os dados chegaram ao disco antes de dizermos ao utilizador que gravámos.
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error ?? new Error('Falha de transação IndexedDB'));
      tx.onabort = () => reject(tx.error ?? new Error('Transação IndexedDB abortada'));
    });
  }

  private static wrap<T>(req: IDBRequest<T>, sink: (v: T) => void): void {
    req.onsuccess = () => sink(req.result);
  }

  // ── Metadados ──────────────────────────────────────────────
  async metaGet<T>(key: string): Promise<T | null> {
    let out: T | null = null;
    await this.run<void>(TABLES.meta, 'readonly', (tx) => {
      IndexedDbAdapter.wrap(tx.objectStore(TABLES.meta).get(key) as IDBRequest<T>, (v) => {
        out = v ?? null;
      });
    });
    return out;
  }

  async metaSet<T>(key: string, value: T): Promise<void> {
    await this.run<void>(TABLES.meta, 'readwrite', (tx) => {
      tx.objectStore(TABLES.meta).put(value as unknown as object, key);
    });
  }

  async metaDelete(key: string): Promise<void> {
    await this.run<void>(TABLES.meta, 'readwrite', (tx) => {
      tx.objectStore(TABLES.meta).delete(key);
    });
  }

  // ── Outbox ─────────────────────────────────────────────────
  async outboxAppend(op: OutboxOp): Promise<void> {
    await this.run<void>(TABLES.outbox, 'readwrite', (tx) => {
      tx.objectStore(TABLES.outbox).put(op);
    });
  }

  /**
   * Reserva o próximo número de sequência. Um corte de energia entre a reserva e
   * o `outboxAppend` deixa um buraco na numeração — é inofensivo, porque `seq`
   * serve apenas para ordenar o envio. A numeração SEM SALTOS que a AGT exige é
   * a do documento fiscal, e essa é atribuída pelo servidor, nunca aqui.
   */
  async outboxNextSeq(): Promise<number> {
    let next = 1;
    await this.run<void>(TABLES.meta, 'readwrite', (tx) => {
      const store = tx.objectStore(TABLES.meta);
      IndexedDbAdapter.wrap(store.get(SEQ_KEY) as IDBRequest<number>, (cur) => {
        next = (typeof cur === 'number' ? cur : 0) + 1;
        store.put(next, SEQ_KEY);
      });
    });
    return next;
  }

  async outboxDue(now: number, limit: number): Promise<OutboxOp[]> {
    const out: OutboxOp[] = [];
    await this.run<void>(TABLES.outbox, 'readonly', (tx) => {
      const cursorReq = tx.objectStore(TABLES.outbox).index('seq').openCursor();
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (!cur || out.length >= limit) return;
        const op = cur.value as OutboxOp;
        if (op.status === 'PENDING' && op.nextAttemptAt <= now) out.push(op);
        cur.continue();
      };
    });
    return out;
  }

  async outboxAll(): Promise<OutboxOp[]> {
    let out: OutboxOp[] = [];
    await this.run<void>(TABLES.outbox, 'readonly', (tx) => {
      IndexedDbAdapter.wrap(
        tx.objectStore(TABLES.outbox).index('seq').getAll() as IDBRequest<OutboxOp[]>,
        (v) => { out = v ?? []; },
      );
    });
    return out;
  }

  async outboxGet(opId: string): Promise<OutboxOp | null> {
    let out: OutboxOp | null = null;
    await this.run<void>(TABLES.outbox, 'readonly', (tx) => {
      IndexedDbAdapter.wrap(tx.objectStore(TABLES.outbox).get(opId) as IDBRequest<OutboxOp>, (v) => {
        out = v ?? null;
      });
    });
    return out;
  }

  async outboxUpdate(op: OutboxOp): Promise<void> {
    await this.run<void>(TABLES.outbox, 'readwrite', (tx) => {
      tx.objectStore(TABLES.outbox).put(op);
    });
  }

  async outboxDelete(opId: string): Promise<void> {
    await this.run<void>(TABLES.outbox, 'readwrite', (tx) => {
      tx.objectStore(TABLES.outbox).delete(opId);
    });
  }

  async outboxCount(status?: OutboxStatus): Promise<number> {
    let out = 0;
    await this.run<void>(TABLES.outbox, 'readonly', (tx) => {
      const store = tx.objectStore(TABLES.outbox);
      const req = status
        ? store.index('status').count(IDBKeyRange.only(status))
        : store.count();
      IndexedDbAdapter.wrap(req, (v) => { out = v ?? 0; });
    });
    return out;
  }

  // ── Cache de leitura ───────────────────────────────────────
  async entityPut(rows: CachedEntity[]): Promise<void> {
    if (rows.length === 0) return;
    await this.run<void>(TABLES.entities, 'readwrite', (tx) => {
      const store = tx.objectStore(TABLES.entities);
      for (const r of rows) {
        const row: EntityRow = { ...r, key: entityKey(r.entity, r.id) };
        store.put(row);
      }
    });
  }

  async entityGet<T>(entity: string, id: string): Promise<CachedEntity<T> | null> {
    let out: CachedEntity<T> | null = null;
    await this.run<void>(TABLES.entities, 'readonly', (tx) => {
      IndexedDbAdapter.wrap(
        tx.objectStore(TABLES.entities).get(entityKey(entity, id)) as IDBRequest<EntityRow>,
        (v) => { out = (v as CachedEntity<T> | undefined) ?? null; },
      );
    });
    return out;
  }

  async entityList<T>(entity: string): Promise<CachedEntity<T>[]> {
    let out: CachedEntity<T>[] = [];
    await this.run<void>(TABLES.entities, 'readonly', (tx) => {
      IndexedDbAdapter.wrap(
        tx.objectStore(TABLES.entities).index('entity').getAll(IDBKeyRange.only(entity)) as IDBRequest<EntityRow[]>,
        (v) => { out = (v ?? []) as CachedEntity<T>[]; },
      );
    });
    return out;
  }

  async entityDelete(entity: string, id: string): Promise<void> {
    await this.run<void>(TABLES.entities, 'readwrite', (tx) => {
      tx.objectStore(TABLES.entities).delete(entityKey(entity, id));
    });
  }

  async entityClear(entity: string): Promise<void> {
    await this.run<void>(TABLES.entities, 'readwrite', (tx) => {
      const store = tx.objectStore(TABLES.entities);
      const req = store.index('entity').openKeyCursor(IDBKeyRange.only(entity));
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        store.delete(cur.primaryKey);
        cur.continue();
      };
    });
  }

  // ── Diário ─────────────────────────────────────────────────
  async logAppend(entry: SyncLogEntry): Promise<void> {
    await this.run<void>(TABLES.log, 'readwrite', (tx) => {
      tx.objectStore(TABLES.log).add(entry);
    });
  }

  async logTail(limit: number): Promise<SyncLogEntry[]> {
    const out: SyncLogEntry[] = [];
    await this.run<void>(TABLES.log, 'readonly', (tx) => {
      const req = tx.objectStore(TABLES.log).openCursor(null, 'prev');
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur || out.length >= limit) return;
        out.push(cur.value as SyncLogEntry);
        cur.continue();
      };
    });
    return out;
  }

  async logTrim(keep: number): Promise<void> {
    await this.run<void>(TABLES.log, 'readwrite', (tx) => {
      const store = tx.objectStore(TABLES.log);
      const countReq = store.count();
      countReq.onsuccess = () => {
        const excess = countReq.result - keep;
        if (excess <= 0) return;
        let removed = 0;
        const cur = store.openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c || removed >= excess) return;
          c.delete();
          removed++;
          c.continue();
        };
      };
    });
  }
}
