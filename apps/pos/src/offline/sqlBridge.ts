/**
 * Ponte para o SQLite do APARELHO — o armazenamento interno de verdade.
 *
 * Porque isto importa: sem ponte, o motor offline cai no IndexedDB. O IndexedDB
 * até vive dentro do sandbox da app, mas não dá as duas garantias que uma venda
 * exige — WAL com escrita confirmada em disco antes de a função retornar, e um
 * ficheiro único que se copia para backup. Um corte de energia a meio de uma
 * gravação é coisa de todos os dias numa loja em Angola.
 *
 * Duas implementações, um só contrato (`SqlBridge`):
 *   • Electron  → `window.ndombaxi.db`, já exposto pelo preload (better-sqlite3
 *                 no processo principal, com WAL).
 *   • Capacitor → plugin `CapacitorSQLite`, base no armazenamento interno da app.
 *
 * Se nada disto existir — ou se falhar — devolvemos `undefined` e o
 * `pickStorage()` segue para o IndexedDB. NUNCA se bloqueia o trabalho por causa
 * do armazenamento: é melhor guardar num sítio menos robusto do que não guardar.
 */
/**
 * O contrato, escrito aqui em vez de importado do `@nexus/offline-core`: a
 * Caixa não usa esse motor (tem a sua própria fila de vendas, com regras
 * fiscais próprias) e não vale a pena trazer um pacote inteiro por três
 * assinaturas de função.
 */
export interface SqlBridge {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string, params?: unknown[]): Promise<void>;
  batch(statements: { sql: string; params?: unknown[] }[]): Promise<void>;
}

/** Base própria da Caixa — separada da do Gestor, mesmo no mesmo aparelho. */
const DB_NAME = 'ndombaxi-caixa';

interface ElectronDb {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string, params?: unknown[]): Promise<void>;
  batch(statements: { sql: string; params?: unknown[] }[]): Promise<void>;
}

/** O preload do Electron expõe exatamente a forma de que precisamos. */
function electronBridge(): SqlBridge | undefined {
  const w = window as unknown as { ndombaxi?: { db?: ElectronDb } };
  const db = w.ndombaxi?.db;
  if (!db || typeof db.query !== 'function') return undefined;
  return {
    query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
      db.query<T>(sql, params ?? []),
    exec: (sql: string, params?: unknown[]) => db.exec(sql, params ?? []),
    batch: (statements) => db.batch(statements),
  };
}

interface CapSqlitePlugin {
  createConnection(o: Record<string, unknown>): Promise<unknown>;
  open(o: { database: string }): Promise<unknown>;
  query(o: { database: string; statement: string; values?: unknown[] }):
    Promise<{ values?: unknown[] }>;
  run(o: { database: string; statement: string; values?: unknown[]; transaction?: boolean }):
    Promise<unknown>;
  executeSet(o: {
    database: string;
    set: { statement: string; values?: unknown[] }[];
    transaction?: boolean;
  }): Promise<unknown>;
}

/**
 * Android/iOS. A ligação é criada uma vez e reutilizada — abrir a base a cada
 * consulta seria lento e, pior, deixaria o WAL a ser reaberto sem necessidade.
 */
async function capacitorBridge(): Promise<SqlBridge | undefined> {
  const w = window as unknown as { Capacitor?: { Plugins?: { CapacitorSQLite?: CapSqlitePlugin } } };
  const p = w.Capacitor?.Plugins?.CapacitorSQLite;
  if (!p || typeof p.query !== 'function') return undefined;

  await p.createConnection({
    database: DB_NAME, encrypted: false, mode: 'no-encryption', version: 1, readonly: false,
  });
  await p.open({ database: DB_NAME });

  return {
    query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const r = await p.query({ database: DB_NAME, statement: sql, values: params ?? [] });
      return (r.values ?? []) as T[];
    },
    exec: async (sql: string, params?: unknown[]) => {
      await p.run({ database: DB_NAME, statement: sql, values: params ?? [], transaction: false });
    },
    // `transaction: true`: ou entram todas as instruções, ou nenhuma. É o que
    // impede uma venda meio-gravada quando a app é morta a meio da escrita.
    batch: async (statements) => {
      await p.executeSet({
        database: DB_NAME,
        set: statements.map((s) => ({ statement: s.sql, values: s.params ?? [] })),
        transaction: true,
      });
    },
  };
}

/**
 * Melhor ponte disponível neste aparelho, ou `undefined` no navegador.
 * Nunca lança: uma falha aqui degrada para IndexedDB, não parte a aplicação.
 */
export async function deviceSqlBridge(): Promise<SqlBridge | undefined> {
  if (typeof window === 'undefined') return undefined;
  try {
    const el = electronBridge();
    if (el) return el;
    return await capacitorBridge();
  } catch {
    return undefined;
  }
}
