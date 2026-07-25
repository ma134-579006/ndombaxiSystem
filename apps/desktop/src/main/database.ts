/**
 * Base de dados local do posto (SQLite).
 *
 * Corre no processo principal, nunca no renderer — o código da interface não
 * tem, nem pode ter, acesso ao sistema de ficheiros. O renderer fala com esta
 * camada por IPC, com uma lista fechada de operações.
 *
 * Duas afinações que não são detalhe:
 *   • `journal_mode = WAL` — permite ler enquanto se escreve. Sem isto, o
 *     ecrã congelava sempre que a sincronização gravasse um lote.
 *   • `synchronous = FULL` — o `INSERT` da venda só retorna depois de o disco
 *     confirmar. É mais lento uns milissegundos e é EXATAMENTE isso que
 *     transforma "provavelmente gravou" em "gravou". Numa loja em Angola, onde
 *     a energia cai a meio de um turno, esta linha é a diferença entre perder
 *     uma venda e não perder nenhuma.
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';

let db: Database.Database | null = null;

export function dbPath(): string {
  // Em `userData`, que sobrevive a atualizações e desinstalações parciais.
  return path.join(app.getPath('userData'), 'ndombaxi-local.db');
}

export function openDatabase(): Database.Database {
  if (db) return db;
  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  // Ao reabrir, o SQLite recupera sozinho de um WAL deixado a meio por um corte
  // de energia. Não há nada a fazer aqui — é o comportamento que queremos.
  return db;
}

export function closeDatabase(): void {
  if (!db) return;
  try {
    // Funde o WAL no ficheiro principal: deixa um único ficheiro coerente,
    // pronto a ser copiado para backup.
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch { /* melhor esforço */ }
  db.close();
  db = null;
}

/** Cópia de segurança consistente, sem parar quem está a trabalhar. */
export async function backupTo(destination: string): Promise<void> {
  const handle = openDatabase();
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await handle.backup(destination);
}

// ── Operações expostas ao renderer ───────────────────────────
// Deliberadamente pequenas e genéricas: o SQL vem de `@nexus/offline-core`, que
// é código nosso e compilado. O renderer não inventa SQL — reencaminha o do
// motor. Mantém-se uma única definição do esquema para todas as plataformas.

export function query(sql: string, params: unknown[] = []): unknown[] {
  return openDatabase().prepare(sql).all(...(params as never[]));
}

export function exec(sql: string, params: unknown[] = []): void {
  openDatabase().prepare(sql).run(...(params as never[]));
}

/**
 * Várias instruções numa transação única. É isto que garante que uma página de
 * sincronização entra inteira ou não entra de todo — nunca meio aplicada.
 */
export function batch(statements: { sql: string; params?: unknown[] }[]): void {
  const handle = openDatabase();
  const run = handle.transaction((items: { sql: string; params?: unknown[] }[]) => {
    for (const s of items) handle.prepare(s.sql).run(...((s.params ?? []) as never[]));
  });
  run(statements);
}
