/**
 * CATÁLOGO NA MEMÓRIA INTERNA — base de produtos indexada (IndexedDB).
 *
 * Catálogos de centenas de milhares a milhões de produtos não cabem num único
 * valor da cache (a lista inteira passava das centenas de MB). Aqui cada produto
 * é um registo, com índices por código, código de barras e nome, e a base
 * atualiza-se aos poucos pelas ALTERAÇÕES (`/pos/products/changes`), nunca
 * descarregando tudo de novo. Sem rede, as páginas e pesquisas de produtos são
 * respondidas daqui (`queryCatalog`), com a mesma forma que a API devolve.
 *
 * Uma base por empresa: um aparelho partilhado nunca mistura catálogos.
 */
type Row = Record<string, unknown> & { id: string; name?: string; code?: string; barcode?: string | null; is_active?: boolean; is_ingredient?: boolean };

const STORE = 'products';
const META = 'meta';

function dbName(company: string): string { return `ndombaxi.catalog.${company.toLowerCase()}`; }

function open(company: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName(company), 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const s = db.createObjectStore(STORE, { keyPath: 'id' });
      s.createIndex('code', 'code');
      s.createIndex('barcode', 'barcode');
      s.createIndex('name_l', 'name_l');
      db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
}

async function metaGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    const r = db.transaction(META).objectStore(META).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => resolve(undefined);
  });
}

let syncing = false;

/** Só os campos que as páginas usam (menos bytes por produto = memória mais rápida e leve). */
const CAMPOS = ['id', 'code', 'barcode', 'name', 'description', 'category_id', 'brand', 'iva_code', 'exemption_reason', 'exemption_code',
  'unit_price', 'cost_price', 'stock_qty', 'image_url', 'show_online', 'shared_stock', 'is_ingredient', 'is_production', 'unit',
  'is_active', 'has_recipe', 'reserved', 'portions_available', 'updated_cursor'];
function compacto(it: Row): Row {
  const o: Record<string, unknown> = {};
  for (const k of CAMPOS) if (it[k] !== undefined && it[k] !== null) o[k] = it[k];
  o.name_l = String(it.name ?? '').toLowerCase();
  return o as Row;
}

/**
 * Traz as alterações desde a última vez (1.ª vez = o catálogo inteiro, aos
 * poucos, 5000 de cada vez). `fetchPage` é a leitura à API (com autenticação).
 * Retomável: o cursor fica gravado a cada página.
 */
export async function syncCatalog(
  company: string,
  fetchPage: (since: string, after: string) => Promise<{ items: Row[]; next: { since: string; after: string } | null }>,
  onProgress?: (count: number) => void,
): Promise<number> {
  if (syncing || typeof indexedDB === 'undefined') return 0;
  syncing = true;
  let total = 0;
  try {
    const db = await open(company);
    let cur = (await metaGet<{ since: string; after: string }>(db, 'cursor')) ?? { since: '', after: '' };
    for (;;) {
      const page = await fetchPage(cur.since, cur.after);
      // `relaxed`: não força o disco a cada página (5–10× mais rápido a encher a
      // memória com milhões de produtos); a ordem e a atomicidade mantêm-se.
      const tx = db.transaction([STORE, META], 'readwrite', { durability: 'relaxed' } as IDBTransactionOptions);
      const st = tx.objectStore(STORE);
      for (const it of page.items) st.put(compacto(it));
      const last = page.items[page.items.length - 1] as (Row & { updated_cursor?: string }) | undefined;
      // Cursor seguinte: o que a API deu, ou (fim) o último registo — a próxima
      // sincronização pede só o que mudou depois dele.
      if (page.next) cur = page.next;
      else if (last?.updated_cursor) cur = { since: last.updated_cursor, after: last.id };
      tx.objectStore(META).put(cur, 'cursor');
      await done(tx);
      total += page.items.length;
      onProgress?.(total);
      if (!page.next) break;
    }
    db.close();
    return total;
  } finally { syncing = false; }
}

/** Quantos produtos estão na memória interna desta empresa. */
export async function catalogCount(company: string): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  const db = await open(company);
  const n = await new Promise<number>((resolve) => {
    const r = db.transaction(STORE).objectStore(STORE).count();
    r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(0);
  });
  db.close();
  return n;
}

/**
 * Página/pesquisa de produtos SEM REDE, com a mesma regra da API:
 * código/barras exatos primeiro, depois nomes a começar pelo termo, depois
 * nomes/marcas que o contenham. `includeInactive` = catálogo do gestor.
 */
export async function queryCatalog(company: string, o: { q?: string; limit?: number; offset?: number; includeInactive?: boolean }): Promise<Row[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await open(company);
  const limit = Math.min(Math.max(1, o.limit ?? 200), 5000);
  const offset = Math.max(0, o.offset ?? 0);
  const q = (o.q ?? '').trim();
  const ql = q.toLowerCase();
  const ok = (r: Row) => !r.is_ingredient && (o.includeInactive || r.is_active !== false);
  // Uma transação por passo: entre passos há `await`, e uma transação parada expira.
  const st = () => db.transaction(STORE).objectStore(STORE);
  const out: Row[] = [];
  const seen = new Set<string>();
  const push = (r: Row) => { if (ok(r) && !seen.has(r.id)) { seen.add(r.id); out.push(r); } };
  const getAll = (index: string, key: IDBValidKey | IDBKeyRange, count?: number) => new Promise<Row[]>((resolve) => {
    const r = st().index(index).getAll(key, count);
    r.onsuccess = () => resolve(r.result as Row[]); r.onerror = () => resolve([]);
  });
  // Percorre o índice de nomes por ordem; `keep` decide o que entra.

  const walk = async (range: IDBKeyRange | null, keep: (r: Row) => boolean, need: number, skip: number) => {
      // Lê o índice de nomes em BLOCOS (getAll), não um registo de cada vez: cada
      // passo de um cursor custava dezenas de ms e uma pesquisa demorava segundos.
      let skipped = 0; const t0 = Date.now(); let lower: string | undefined;
      const lo0 = range ? (range.lower as string) : undefined; const hi = range ? (range.upper as string) : undefined;
      const chunk = (lo?: string): IDBKeyRange | null => {
        const l = lo ?? lo0;
        if (l === undefined && hi === undefined) return null;
        if (l === undefined) return IDBKeyRange.upperBound(hi as string);
        if (hi === undefined) return IDBKeyRange.lowerBound(l);
        return IDBKeyRange.bound(l, hi);
      };
      while (out.length < need && Date.now() - t0 < 1500) {
        const rows = await new Promise<Row[]>((resolve) => {
          const r = st().index('name_l').getAll(chunk(lower), 2000);
          r.onsuccess = () => resolve(r.result as Row[]); r.onerror = () => resolve([]);
        });
        for (const r of rows) {
          if (out.length >= need) break;
          if (ok(r) && keep(r) && !seen.has(r.id)) { if (skipped < skip) skipped++; else push(r); }
        }
        if (rows.length < 2000) break;
        const next = String(rows[rows.length - 1].name_l ?? '');
        if (next === lower) break;
        lower = next;
      }
    };

  if (!q) {
    await walk(null, () => true, limit, offset);
  } else {
    const need = offset + limit;
    for (const r of await getAll('code', q)) push(r);
    for (const r of await getAll('barcode', q)) push(r);
    // Código/barras/NIF/telefone encontrado: é uma procura por identificador — não percorrer tudo.
    const exatos = out.length > 0;
    if (out.length < need) await walk(IDBKeyRange.bound(ql, `${ql}￿`), () => true, need, 0);
    // 'Contém' só quando há poucos resultados (é a procura mais lenta: percorre a lista).
    if (!exatos && out.length < Math.min(need, 20)) await walk(null, (r) => String(r.name_l ?? '').includes(ql) || String(r.brand ?? '').toLowerCase().includes(ql), need, 0);
    out.splice(0, offset);
    out.length = Math.min(out.length, limit);
  }
  db.close();
  return out.map(({ name_l: _n, ...r }) => r as Row);
}

/**
 * Alteração feita SEM REDE a um produto (fila de escritas): aplica-a já na
 * memória, para a lista e as pesquisas mostrarem o valor novo antes de subir.
 * `fields` vem em snake_case (a forma que a API devolve).
 */
export async function applyToCatalog(
  company: string, op: 'create' | 'update' | 'delete', id: string, fields: Record<string, unknown> = {},
): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await open(company);
  const tx = db.transaction(STORE, 'readwrite');
  const st = tx.objectStore(STORE);
  if (op === 'delete') st.delete(id);
  else {
    const cur = await new Promise<Row | undefined>((resolve) => {
      const r = st.get(id); r.onsuccess = () => resolve(r.result as Row | undefined); r.onerror = () => resolve(undefined);
    });
    const novo = { ...(cur ?? { is_active: true }), ...fields, id } as Row;
    st.put({ ...novo, name_l: String(novo.name ?? '').toLowerCase() });
  }
  await done(tx);
  db.close();
}
