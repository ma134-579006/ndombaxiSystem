/**
 * Implementação do armazenamento sobre SQLite.
 *
 * O SQL vive aqui, mas a execução é delegada a uma "ponte" injetada — porque o
 * mesmo código serve dois hospedeiros muito diferentes:
 *   • Electron/Windows → better-sqlite3 no processo principal, chamado por IPC.
 *   • Capacitor        → @capacitor-community/sqlite no plugin nativo.
 * O motor não sabe (nem precisa de saber) qual dos dois está por baixo.
 *
 * Escolhemos SQLite no desktop em vez de IndexedDB porque é ele que dá as duas
 * coisas que o IndexedDB não dá: WAL com `synchronous=FULL` (a venda está no
 * disco antes de a função retornar) e um ficheiro único que se copia para backup.
 */
import { TABLES, type StorageAdapter } from './adapter';
import type { CachedEntity, OutboxOp, OutboxStatus, SyncLogEntry } from '../types';

/** Contrato mínimo que o hospedeiro tem de fornecer. */
export interface SqlBridge {
  /** SELECT — devolve as linhas. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** INSERT/UPDATE/DELETE/DDL — sem resultado. */
  exec(sql: string, params?: unknown[]): Promise<void>;
  /** Várias instruções numa ÚNICA transação. Ou entram todas, ou nenhuma. */
  batch(statements: { sql: string; params?: unknown[] }[]): Promise<void>;
}

const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS ${TABLES.meta} (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS ${TABLES.outbox} (
     opId TEXT PRIMARY KEY,
     seq INTEGER NOT NULL,
     entity TEXT NOT NULL,
     op TEXT NOT NULL,
     localId TEXT NOT NULL,
     payload TEXT NOT NULL,
     baseVersion INTEGER,
     createdAt TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     nextAttemptAt INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL,
     lastError TEXT,
     lastErrorCode TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_outbox_due ON ${TABLES.outbox} (status, nextAttemptAt, seq)`,
  `CREATE TABLE IF NOT EXISTS ${TABLES.entities} (
     entity TEXT NOT NULL,
     id TEXT NOT NULL,
     data TEXT NOT NULL,
     version INTEGER NOT NULL DEFAULT 0,
     updatedAt TEXT NOT NULL,
     deleted INTEGER NOT NULL DEFAULT 0,
     dirty INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (entity, id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_entities_entity ON ${TABLES.entities} (entity)`,
  `CREATE TABLE IF NOT EXISTS ${TABLES.log} (
     rowid_ INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL,
     level TEXT NOT NULL,
     event TEXT NOT NULL,
     detail TEXT
   )`,
];

const SEQ_KEY = '__outbox_seq__';

interface OutboxRow {
  opId: string; seq: number; entity: string; op: string; localId: string;
  payload: string; baseVersion: number | null; createdAt: string;
  attempts: number; nextAttemptAt: number; status: string;
  lastError: string | null; lastErrorCode: string | null;
}

interface EntityRowSql {
  entity: string; id: string; data: string; version: number;
  updatedAt: string; deleted: number; dirty: number;
}

function toOp(r: OutboxRow): OutboxOp {
  return {
    opId: r.opId,
    seq: r.seq,
    entity: r.entity,
    op: r.op as OutboxOp['op'],
    localId: r.localId,
    payload: JSON.parse(r.payload) as unknown,
    baseVersion: r.baseVersion,
    createdAt: r.createdAt,
    attempts: r.attempts,
    nextAttemptAt: r.nextAttemptAt,
    status: r.status as OutboxStatus,
    ...(r.lastError ? { lastError: r.lastError } : {}),
    ...(r.lastErrorCode ? { lastErrorCode: r.lastErrorCode } : {}),
  };
}

function toEntity<T>(r: EntityRowSql): CachedEntity<T> {
  return {
    entity: r.entity,
    id: r.id,
    data: JSON.parse(r.data) as T,
    version: r.version,
    updatedAt: r.updatedAt,
    deleted: r.deleted === 1,
    dirty: r.dirty === 1,
  };
}

export class SqliteAdapter implements StorageAdapter {
  readonly kind = 'sqlite' as const;
  private ready = false;

  constructor(private readonly sql: SqlBridge) {}

  async open(): Promise<void> {
    if (this.ready) return;
    for (const stmt of SCHEMA) await this.sql.exec(stmt);
    this.ready = true;
  }

  async close(): Promise<void> {
    this.ready = false;
  }

  // ── Metadados ──────────────────────────────────────────────
  async metaGet<T>(key: string): Promise<T | null> {
    const rows = await this.sql.query<{ value: string }>(
      `SELECT value FROM ${TABLES.meta} WHERE key = ?`, [key]);
    if (rows.length === 0) return null;
    try { return JSON.parse(rows[0].value) as T; } catch { return null; }
  }

  async metaSet<T>(key: string, value: T): Promise<void> {
    await this.sql.exec(
      `INSERT INTO ${TABLES.meta} (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, JSON.stringify(value)],
    );
  }

  async metaDelete(key: string): Promise<void> {
    await this.sql.exec(`DELETE FROM ${TABLES.meta} WHERE key = ?`, [key]);
  }

  // ── Outbox ─────────────────────────────────────────────────
  async outboxAppend(op: OutboxOp): Promise<void> {
    await this.sql.exec(
      `INSERT INTO ${TABLES.outbox}
         (opId, seq, entity, op, localId, payload, baseVersion, createdAt,
          attempts, nextAttemptAt, status, lastError, lastErrorCode)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(opId) DO NOTHING`,
      [op.opId, op.seq, op.entity, op.op, op.localId, JSON.stringify(op.payload),
       op.baseVersion, op.createdAt, op.attempts, op.nextAttemptAt, op.status,
       op.lastError ?? null, op.lastErrorCode ?? null],
    );
  }

  /** Ver a nota de tolerância a saltos em `IndexedDbAdapter.outboxNextSeq`. */
  async outboxNextSeq(): Promise<number> {
    const rows = await this.sql.query<{ value: string }>(
      `SELECT value FROM ${TABLES.meta} WHERE key = ?`, [SEQ_KEY]);
    const cur = rows.length ? Number(JSON.parse(rows[0].value)) : 0;
    const next = (Number.isFinite(cur) ? cur : 0) + 1;
    await this.metaSet(SEQ_KEY, next);
    return next;
  }

  async outboxDue(now: number, limit: number): Promise<OutboxOp[]> {
    const rows = await this.sql.query<OutboxRow>(
      `SELECT * FROM ${TABLES.outbox}
        WHERE status = 'PENDING' AND nextAttemptAt <= ?
        ORDER BY seq ASC LIMIT ?`,
      [now, limit],
    );
    return rows.map(toOp);
  }

  async outboxAll(): Promise<OutboxOp[]> {
    const rows = await this.sql.query<OutboxRow>(
      `SELECT * FROM ${TABLES.outbox} ORDER BY seq ASC`);
    return rows.map(toOp);
  }

  async outboxGet(opId: string): Promise<OutboxOp | null> {
    const rows = await this.sql.query<OutboxRow>(
      `SELECT * FROM ${TABLES.outbox} WHERE opId = ?`, [opId]);
    return rows.length ? toOp(rows[0]) : null;
  }

  async outboxUpdate(op: OutboxOp): Promise<void> {
    await this.sql.exec(
      `UPDATE ${TABLES.outbox}
          SET payload = ?, attempts = ?, nextAttemptAt = ?, status = ?,
              lastError = ?, lastErrorCode = ?, baseVersion = ?
        WHERE opId = ?`,
      [JSON.stringify(op.payload), op.attempts, op.nextAttemptAt, op.status,
       op.lastError ?? null, op.lastErrorCode ?? null, op.baseVersion, op.opId],
    );
  }

  async outboxDelete(opId: string): Promise<void> {
    await this.sql.exec(`DELETE FROM ${TABLES.outbox} WHERE opId = ?`, [opId]);
  }

  async outboxCount(status?: OutboxStatus): Promise<number> {
    const rows = status
      ? await this.sql.query<{ n: number }>(
          `SELECT COUNT(*) AS n FROM ${TABLES.outbox} WHERE status = ?`, [status])
      : await this.sql.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${TABLES.outbox}`);
    return Number(rows[0]?.n ?? 0);
  }

  // ── Cache de leitura ───────────────────────────────────────
  async entityPut(rows: CachedEntity[]): Promise<void> {
    if (rows.length === 0) return;
    // Lote numa só transação: uma página de descida aplica-se inteira ou nada.
    await this.sql.batch(rows.map((r) => ({
      sql: `INSERT INTO ${TABLES.entities}
              (entity, id, data, version, updatedAt, deleted, dirty)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(entity, id) DO UPDATE SET
              data = excluded.data, version = excluded.version,
              updatedAt = excluded.updatedAt, deleted = excluded.deleted,
              dirty = excluded.dirty`,
      params: [r.entity, r.id, JSON.stringify(r.data), r.version, r.updatedAt,
               r.deleted ? 1 : 0, r.dirty ? 1 : 0],
    })));
  }

  async entityGet<T>(entity: string, id: string): Promise<CachedEntity<T> | null> {
    const rows = await this.sql.query<EntityRowSql>(
      `SELECT * FROM ${TABLES.entities} WHERE entity = ? AND id = ?`, [entity, id]);
    return rows.length ? toEntity<T>(rows[0]) : null;
  }

  async entityList<T>(entity: string): Promise<CachedEntity<T>[]> {
    const rows = await this.sql.query<EntityRowSql>(
      `SELECT * FROM ${TABLES.entities} WHERE entity = ?`, [entity]);
    return rows.map((r) => toEntity<T>(r));
  }

  async entityDelete(entity: string, id: string): Promise<void> {
    await this.sql.exec(
      `DELETE FROM ${TABLES.entities} WHERE entity = ? AND id = ?`, [entity, id]);
  }

  async entityClear(entity: string): Promise<void> {
    await this.sql.exec(`DELETE FROM ${TABLES.entities} WHERE entity = ?`, [entity]);
  }

  // ── Diário ─────────────────────────────────────────────────
  async logAppend(entry: SyncLogEntry): Promise<void> {
    await this.sql.exec(
      `INSERT INTO ${TABLES.log} (at, level, event, detail) VALUES (?,?,?,?)`,
      [entry.at, entry.level, entry.event, entry.detail ?? null],
    );
  }

  async logTail(limit: number): Promise<SyncLogEntry[]> {
    const rows = await this.sql.query<{ at: string; level: string; event: string; detail: string | null }>(
      `SELECT at, level, event, detail FROM ${TABLES.log} ORDER BY rowid_ DESC LIMIT ?`, [limit]);
    return rows.map((r) => ({
      at: r.at,
      level: r.level as SyncLogEntry['level'],
      event: r.event,
      ...(r.detail ? { detail: r.detail } : {}),
    }));
  }

  async logTrim(keep: number): Promise<void> {
    await this.sql.exec(
      `DELETE FROM ${TABLES.log} WHERE rowid_ NOT IN (
         SELECT rowid_ FROM ${TABLES.log} ORDER BY rowid_ DESC LIMIT ?)`, [keep]);
  }
}
