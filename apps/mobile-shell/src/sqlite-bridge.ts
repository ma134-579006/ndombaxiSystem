/**
 * Ponte SQLite para Android e iOS, ligada ao motor `@nexus/offline-core`.
 *
 * O motor não sabe que está num telemóvel: pede `query`/`exec`/`batch` a esta
 * ponte, tal como no Windows pede a uma ponte sobre o better-sqlite3. Uma só
 * definição do esquema e da lógica offline serve as três plataformas.
 *
 * Escolha do plugin: `@capacitor-community/sqlite` grava num ficheiro nativo
 * (fora da WebView), com cifra ligada ao Keychain (iOS) / Keystore (Android).
 * É o equivalente móvel do WAL+DPAPI que o desktop usa.
 */
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';
import type { SqlBridge } from '@nexus/offline-core';

const DB_NAME = 'ndombaxi-local';

let sqlite: SQLiteConnection | null = null;
let db: SQLiteDBConnection | null = null;

/**
 * Abre (uma vez) a base de dados local. Idempotente: chamadas seguintes
 * devolvem a ligação já aberta.
 */
export async function openMobileDatabase(): Promise<SqlBridge> {
  if (db) return makeBridge(db);

  sqlite = new SQLiteConnection(CapacitorSQLite);

  // No arranque do Android, o plugin precisa que as ligações antigas sejam
  // reconciliadas — senão um relançamento a quente rebenta com "connection
  // already exists".
  if (Capacitor.getPlatform() === 'android') {
    try { await sqlite.checkConnectionsConsistency(); } catch { /* primeira vez */ }
  }

  const isConn = (await sqlite.isConnection(DB_NAME, false)).result ?? false;
  db = isConn
    ? await sqlite.retrieveConnection(DB_NAME, false)
    : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);

  await db.open();
  // Durabilidade: WAL + FULL, a mesma garantia do desktop — a venda está em
  // disco antes de a escrita retornar.
  await db.execute('PRAGMA journal_mode=WAL;');
  await db.execute('PRAGMA synchronous=FULL;');
  await db.execute('PRAGMA foreign_keys=ON;');

  return makeBridge(db);
}

export async function closeMobileDatabase(): Promise<void> {
  if (!db || !sqlite) return;
  try { await sqlite.closeConnection(DB_NAME, false); } catch { /* já fechada */ }
  db = null;
}

function makeBridge(conn: SQLiteDBConnection): SqlBridge {
  return {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      const res = await conn.query(sql, params as never[]);
      return (res.values ?? []) as T[];
    },

    async exec(sql: string, params: unknown[] = []): Promise<void> {
      // `run` com transação individual: cada escrita é confirmada no disco.
      await conn.run(sql, params as never[], true);
    },

    async batch(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
      if (statements.length === 0) return;
      // `executeSet` corre o lote numa ÚNICA transação nativa — uma página de
      // sincronização entra inteira ou não entra de todo.
      await conn.executeSet(
        statements.map((s) => ({ statement: s.sql, values: (s.params ?? []) as never[] })),
        true,
      );
    },
  };
}
