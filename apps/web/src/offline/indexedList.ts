/**
 * LISTA INDEXADA NA MEMÓRIA INTERNA — genérica (clientes, e outras listas grandes).
 *
 * O mesmo princípio do catálogo de produtos (`catalog.ts`): cada registo guardado
 * à parte num IndexedDB próprio por empresa, com índices para procura exata e por
 * nome, atualizado aos poucos pelas ALTERAÇÕES da API (`.../changes`). Sem rede,
 * páginas e pesquisas respondem daqui com a mesma forma que a API devolve.
 */
type Row = Record<string, unknown> & { id: string; is_active?: boolean };
type Page = { items: Row[]; next: { since: string; after: string } | null };

export interface IndexedListSpec {
  /** Nome curto (vai no nome da base: `ndombaxi.<kind>.<empresa>`). */
  kind: string;
  /** Campos com procura EXATA (ex.: NIF, telefone). */
  exact: string[];
  /** Campos onde a pesquisa de texto procura (além do nome). */
  text: string[];
}

const STORE = 'rows';
const META = 'meta';

export function indexedList(spec: IndexedListSpec) {
  const dbName = (company: string) => `ndombaxi.${spec.kind}.${company.toLowerCase()}`;
  const open = (company: string) => new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName(company), 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: 'id' });
      s.createIndex('name_l', 'name_l');
      for (const f of spec.exact) s.createIndex(f, f);
      req.result.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
  const prep = (r: Row) => ({ ...r, name_l: String(r.name ?? '').toLowerCase() });
  let syncing = false;

  return {
    /** Traz as alterações desde a última vez (1.ª vez = tudo, aos poucos). Retomável. */
    async sync(company: string, fetchPage: (since: string, after: string) => Promise<Page>): Promise<number> {
      if (syncing || typeof indexedDB === 'undefined') return 0;
      syncing = true;
      let total = 0;
      try {
        const db = await open(company);
        let cur = await new Promise<{ since: string; after: string }>((resolve) => {
          const r = db.transaction(META).objectStore(META).get('cursor');
          r.onsuccess = () => resolve((r.result as { since: string; after: string }) ?? { since: '', after: '' });
          r.onerror = () => resolve({ since: '', after: '' });
        });
        for (;;) {
          const page = await fetchPage(cur.since, cur.after);
          const tx = db.transaction([STORE, META], 'readwrite', { durability: 'relaxed' } as IDBTransactionOptions);
          const st = tx.objectStore(STORE);
          for (const it of page.items) {
            if (it.is_active === false) st.delete(it.id); else st.put(prep(it));
          }
          const last = page.items[page.items.length - 1] as (Row & { updated_cursor?: string }) | undefined;
          if (page.next) cur = page.next;
          else if (last?.updated_cursor) cur = { since: last.updated_cursor, after: last.id };
          tx.objectStore(META).put(cur, 'cursor');
          await done(tx);
          total += page.items.length;
          if (!page.next) break;
        }
        db.close();
        return total;
      } finally { syncing = false; }
    },

    /** Página/pesquisa sem rede: exatos primeiro, depois nome a começar pelo termo, depois contém. */
    async query(company: string, o: { q?: string; limit?: number; offset?: number }): Promise<Row[]> {
      if (typeof indexedDB === 'undefined') return [];
      const db = await open(company);
      const limit = Math.min(Math.max(1, o.limit ?? 200), 5000);
      const offset = Math.max(0, o.offset ?? 0);
      const q = (o.q ?? '').trim();
      const ql = q.toLowerCase();
      const st = () => db.transaction(STORE).objectStore(STORE);
      const out: Row[] = [];
      const seen = new Set<string>();
      const push = (r: Row) => { if (!seen.has(r.id)) { seen.add(r.id); out.push(r); } };

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
              if (true && keep(r) && !seen.has(r.id)) { if (skipped < skip) skipped++; else push(r); }
            }
            if (rows.length < 2000) break;
            const next = String(rows[rows.length - 1].name_l ?? '');
            if (next === lower) break;
            lower = next;
          }
        };
      if (!q) await walk(null, () => true, limit, offset);
      else {
        const need = offset + limit;
        for (const f of spec.exact) {
          const rows = await new Promise<Row[]>((resolve) => {
            const r = st().index(f).getAll(q); r.onsuccess = () => resolve(r.result as Row[]); r.onerror = () => resolve([]);
          });
          rows.forEach(push);
        }
        // Código/barras/NIF/telefone encontrado: é uma procura por identificador — não percorrer tudo.
        const exatos = out.length > 0;
        if (out.length < need) await walk(IDBKeyRange.bound(ql, `${ql}￿`), () => true, need, 0);
        if (!exatos && out.length < Math.min(need, 20)) {
          await walk(null, (r) => String(r.name_l ?? '').includes(ql)
            || spec.text.some((f) => String(r[f] ?? '').toLowerCase().includes(ql)), need, 0);
        }
        out.splice(0, offset);
        out.length = Math.min(out.length, limit);
      }
      db.close();
      return out.map(({ name_l: _n, ...r }) => r as Row);
    },

    /** Alteração feita SEM REDE: reflete-se já na memória (snake_case, como a API). */
    async apply(company: string, op: 'create' | 'update' | 'delete', id: string, fields: Record<string, unknown> = {}): Promise<void> {
      if (typeof indexedDB === 'undefined') return;
      const db = await open(company);
      const tx = db.transaction(STORE, 'readwrite');
      const s = tx.objectStore(STORE);
      if (op === 'delete') s.delete(id);
      else {
        const cur = await new Promise<Row | undefined>((resolve) => {
          const r = s.get(id); r.onsuccess = () => resolve(r.result as Row | undefined); r.onerror = () => resolve(undefined);
        });
        s.put(prep({ ...(cur ?? { is_active: true }), ...fields, id } as Row));
      }
      await done(tx);
      db.close();
    },
  };
}

/** Clientes: NIF e telefone exatos; texto também no e-mail. */
export const customersStore = indexedList({ kind: 'customers', exact: ['tax_id', 'phone'], text: ['email', 'tax_id', 'phone'] });
