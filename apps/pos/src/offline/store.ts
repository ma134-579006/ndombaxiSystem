/**
 * Onde a Caixa guarda o que não pode perder.
 *
 * Duas caves, um só contrato:
 *   • **SQLite do aparelho** (Android pelo Capacitor, Windows pelo Electron) —
 *     ficheiro próprio no armazenamento interno da app, com transações a sério.
 *   • **IndexedDB** — recuo, e o que se usa no navegador.
 *
 * Porque é que isto importa numa Caixa e não noutra coisa qualquer: aqui ficam
 * **vendas já feitas ao cliente e ainda não enviadas ao servidor**. Não é cache;
 * é dinheiro e obrigação fiscal. O IndexedDB vive dentro da app, mas não dá as
 * garantias de que uma venda precisa — escrita confirmada em disco antes de a
 * gravação retornar, e tudo-ou-nada num lote. Num sítio onde a energia falha a
 * meio do dia, é a diferença entre uma fila intacta e uma venda meio-gravada.
 *
 * O que NUNCA se faz aqui: bloquear o trabalho por causa do armazenamento. Se o
 * SQLite não estiver disponível, ou falhar a abrir, usa-se o IndexedDB e vende-se
 * na mesma. É melhor guardar num sítio menos robusto do que não guardar.
 */
import { deviceSqlBridge, type SqlBridge } from './sqlBridge';

const DB_NAME = 'ndombaxi-pos';
const DB_VERSION = 1;
const STORE_KV = 'kv';
const STORE_SALES = 'pendingSales';

/** Marca de que a mudança de cave já foi feita — para não repetir. */
const MARCA_MIGRACAO = '__migrado_para_sqlite__';

// ── Cave 1: IndexedDB ────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV);
      if (!db.objectStoreNames.contains(STORE_SALES)) {
        db.createObjectStore(STORE_SALES, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB indisponível'));
  });
  return dbPromise;
}

function idbTx<T>(
  store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Falha de IndexedDB'));
  }));
}

export function indexedDbSupported(): boolean {
  try { return typeof indexedDB !== 'undefined'; } catch { return false; }
}

// ── Cave 2: SQLite do aparelho ───────────────────────────────────────

/**
 * `payload` guarda o registo inteiro em JSON, e não uma coluna por campo.
 *
 * É deliberado: a forma de uma venda muda com a lei e com o produto (linhas,
 * descontos, cliente, chave de idempotência). Com colunas fixas, cada mudança
 * dessas exigia uma migração de esquema no aparelho do lojista — com vendas por
 * enviar lá dentro. Aqui a fila é uma caixa selada que só o código da Caixa
 * abre; o SQLite dá o que se veio buscar: durabilidade e transações.
 */
const ESQUEMA = [
  'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pending_sales (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)',
];

let bridgePromise: Promise<SqlBridge | null> | null = null;

async function bridge(): Promise<SqlBridge | null> {
  if (bridgePromise) return bridgePromise;
  bridgePromise = (async () => {
    const b = await deviceSqlBridge();
    if (!b) return null;
    try {
      for (const sql of ESQUEMA) await b.exec(sql);
      await migrarDoIndexedDb(b);
      return b;
    } catch {
      // Base corrompida, sem espaço, plugin a falhar: volta-se ao IndexedDB.
      return null;
    }
  })();
  return bridgePromise;
}

/**
 * Traz para o SQLite o que já estava no IndexedDB.
 *
 * Sem isto, a atualização que muda de cave deixava para trás as vendas por
 * enviar de quem estava a trabalhar offline nesse dia — desapareciam da
 * aplicação sem aviso. Corre uma só vez, e **não apaga o IndexedDB**: se algo
 * correr mal, o que lá estava continua a poder ser recuperado.
 */
async function migrarDoIndexedDb(b: SqlBridge): Promise<void> {
  const feito = await b.query<{ v: string }>('SELECT v FROM kv WHERE k = ?', [MARCA_MIGRACAO]);
  if (feito.length > 0) return;
  if (!indexedDbSupported()) {
    await b.exec('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', [MARCA_MIGRACAO, '1']);
    return;
  }
  try {
    const vendas = await idbTx<PendingSaleRow[]>(
      STORE_SALES, 'readonly', (s) => s.getAll() as IDBRequest<PendingSaleRow[]>,
    );
    const lote = (vendas ?? []).map((v) => ({
      sql: 'INSERT INTO pending_sales (payload) VALUES (?)',
      // O `id` do IndexedDB não vem: o do SQLite é atribuído aqui, e é ele que
      // passa a valer. Quem guarda referências a ids é só esta camada.
      params: [JSON.stringify({ ...v, id: undefined })],
    }));
    if (lote.length > 0) await b.batch(lote);
  } catch {
    /* sem IndexedDB legível não há nada a trazer — segue-se em frente */
  }
  await b.exec('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', [MARCA_MIGRACAO, '1']);
}

interface PendingSaleRow { id?: number; [k: string]: unknown }

// ── A porta única para o resto da aplicação ──────────────────────────

/** Há onde guardar? Só é falso num ambiente sem SQLite E sem IndexedDB. */
export async function storageReady(): Promise<boolean> {
  return (await bridge()) !== null || indexedDbSupported();
}

/** Onde está a guardar, para diagnóstico (aparece no registo, não na interface). */
export async function storageKind(): Promise<'sqlite' | 'indexeddb' | 'nenhum'> {
  if (await bridge()) return 'sqlite';
  return indexedDbSupported() ? 'indexeddb' : 'nenhum';
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  const b = await bridge();
  try {
    if (b) {
      await b.exec('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', [key, JSON.stringify(value)]);
      return;
    }
    if (indexedDbSupported()) {
      await idbTx(STORE_KV, 'readwrite', (s) => s.put(value as unknown as object, key));
    }
  } catch {
    /* cache: melhor esforço, nunca estorva quem está a vender */
  }
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const b = await bridge();
  try {
    if (b) {
      const r = await b.query<{ v: string }>('SELECT v FROM kv WHERE k = ?', [key]);
      return r.length > 0 ? (JSON.parse(r[0].v) as T) : null;
    }
    if (!indexedDbSupported()) return null;
    const v = await idbTx<T>(STORE_KV, 'readonly', (s) => s.get(key) as IDBRequest<T>);
    return (v ?? null) as T | null;
  } catch {
    return null;
  }
}

export async function salesAdd(sale: Record<string, unknown>): Promise<number> {
  const b = await bridge();
  if (b) {
    await b.exec('INSERT INTO pending_sales (payload) VALUES (?)', [JSON.stringify(sale)]);
    const r = await b.query<{ id: number }>('SELECT MAX(id) AS id FROM pending_sales');
    return Number(r[0]?.id ?? 0);
  }
  const id = await idbTx<IDBValidKey>(
    STORE_SALES, 'readwrite', (s) => s.add(sale) as IDBRequest<IDBValidKey>,
  );
  return Number(id);
}

export async function salesList<T>(): Promise<T[]> {
  const b = await bridge();
  try {
    if (b) {
      const rows = await b.query<{ id: number; payload: string }>(
        'SELECT id, payload FROM pending_sales ORDER BY id',
      );
      return rows.map((r) => ({ ...(JSON.parse(r.payload) as object), id: Number(r.id) })) as T[];
    }
    if (!indexedDbSupported()) return [];
    const all = await idbTx<T[]>(STORE_SALES, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
    return all ?? [];
  } catch {
    return [];
  }
}

export async function salesPut(sale: { id?: number } & Record<string, unknown>): Promise<void> {
  const b = await bridge();
  if (b) {
    if (sale.id == null) { await salesAdd(sale); return; }
    await b.exec('UPDATE pending_sales SET payload = ? WHERE id = ?',
      [JSON.stringify({ ...sale, id: undefined }), sale.id]);
    return;
  }
  await idbTx(STORE_SALES, 'readwrite', (s) => s.put(sale));
}

export async function salesDelete(id: number): Promise<void> {
  const b = await bridge();
  if (b) {
    await b.exec('DELETE FROM pending_sales WHERE id = ?', [id]);
    return;
  }
  await idbTx(STORE_SALES, 'readwrite', (s) => s.delete(id));
}

export async function salesCount(): Promise<number> {
  const b = await bridge();
  try {
    if (b) {
      const r = await b.query<{ n: number }>('SELECT COUNT(*) AS n FROM pending_sales');
      return Number(r[0]?.n ?? 0);
    }
    if (!indexedDbSupported()) return 0;
    return await idbTx<number>(STORE_SALES, 'readonly', (s) => s.count() as IDBRequest<number>);
  } catch {
    return 0;
  }
}
