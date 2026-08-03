/**
 * Prova de que a Caixa guarda as vendas na MEMÓRIA INTERNA do aparelho.
 *
 * O que está em jogo: a fila de vendas não é cache — são vendas já feitas ao
 * cliente e ainda não enviadas ao servidor. Dinheiro e obrigação fiscal. Por
 * isso tem de ir para o SQLite do aparelho (escrita confirmada em disco, lotes
 * tudo-ou-nada) e não para o IndexedDB.
 *
 * E, sobretudo: **a mudança de cave não pode deixar para trás o que já lá
 * estava**. Quem estivesse a trabalhar offline no dia da atualização veria as
 * suas vendas desaparecer da aplicação.
 */
const path = require('node:path');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');

const esbuild = require(require.resolve('esbuild', {
  paths: [path.dirname(require.resolve('vite', { paths: [path.join(__dirname, '..')] }))],
}));

const r = [];
const check = (nome, cond) => r.push([cond ? 'OK  ' : 'FALHA', nome]);

const tmp = mkdtempSync(path.join(tmpdir(), 'ndombaxi-memoria-'));
const saida = path.join(tmp, 'store.cjs');

/** SQLite de brincar, em memória, com o mesmo contrato da ponte real. */
function sqliteDeMentira() {
  const tabelas = { kv: new Map(), pending_sales: [] };
  let proximoId = 1;
  const lotes = [];
  const run = (sql, params = []) => {
    const s = sql.trim().toUpperCase();
    if (s.startsWith('CREATE TABLE')) return [];
    if (s.startsWith('INSERT OR REPLACE INTO KV')) { tabelas.kv.set(params[0], params[1]); return []; }
    if (s.startsWith('SELECT V FROM KV')) {
      const v = tabelas.kv.get(params[0]);
      return v === undefined ? [] : [{ v }];
    }
    if (s.startsWith('INSERT INTO PENDING_SALES')) {
      tabelas.pending_sales.push({ id: proximoId++, payload: params[0] });
      return [];
    }
    if (s.startsWith('SELECT MAX(ID)')) {
      return [{ id: tabelas.pending_sales.length ? tabelas.pending_sales.at(-1).id : 0 }];
    }
    if (s.startsWith('SELECT ID, PAYLOAD')) return tabelas.pending_sales.slice();
    if (s.startsWith('SELECT COUNT(*)')) return [{ n: tabelas.pending_sales.length }];
    if (s.startsWith('UPDATE PENDING_SALES')) {
      const row = tabelas.pending_sales.find((x) => x.id === params[1]);
      if (row) row.payload = params[0];
      return [];
    }
    if (s.startsWith('DELETE FROM PENDING_SALES')) {
      tabelas.pending_sales = tabelas.pending_sales.filter((x) => x.id !== params[0]);
      return [];
    }
    throw new Error('SQL não previsto na prova: ' + sql);
  };
  return {
    tabelas,
    lotes,
    ponte: {
      query: async (sql, params) => run(sql, params),
      exec: async (sql, params) => { run(sql, params); },
      batch: async (sts) => { lotes.push(sts.length); for (const s of sts) run(s.sql, s.params); },
    },
  };
}

/** IndexedDB de brincar, com as vendas de ontem lá dentro. */
function indexedDbDeMentira(vendasAntigas) {
  const stores = { kv: new Map(), pendingSales: new Map() };
  vendasAntigas.forEach((v, i) => stores.pendingSales.set(i + 1, { ...v, id: i + 1 }));
  const pedido = (valor) => {
    const req = { result: valor, onsuccess: null, onerror: null };
    setTimeout(() => req.onsuccess && req.onsuccess(), 0);
    return req;
  };
  return {
    open: () => {
      const req = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      setTimeout(() => {
        req.result = {
          objectStoreNames: { contains: () => true },
          transaction: (nome) => ({
            objectStore: () => ({
              getAll: () => pedido([...stores[nome].values()]),
              get: (k) => pedido(stores[nome].get(k)),
              put: (v, k) => { stores[nome].set(k ?? v.id, v); return pedido(undefined); },
              add: (v) => { const id = stores[nome].size + 1; stores[nome].set(id, { ...v, id }); return pedido(id); },
              delete: (k) => { stores[nome].delete(k); return pedido(undefined); },
              count: () => pedido(stores[nome].size),
            }),
          }),
        };
        req.onsuccess && req.onsuccess();
      }, 0);
      return req;
    },
    stores,
  };
}

(async () => {
  await esbuild.build({
    entryPoints: [path.join(__dirname, '..', 'src', 'offline', 'store.ts')],
    bundle: true, format: 'cjs', platform: 'node', outfile: saida,
  });

  const carregar = () => { delete require.cache[saida]; return require(saida); };

  // ── 1. No aparelho: SQLite, e as vendas de ontem VÊM com ele ────────
  const sq = sqliteDeMentira();
  const idb = indexedDbDeMentira([
    { clientOpId: 'venda-de-ontem-1', status: 'PENDING', grossTotal: 5000 },
    { clientOpId: 'venda-de-ontem-2', status: 'PENDING', grossTotal: 1200 },
  ]);
  global.window = { Capacitor: { Plugins: { CapacitorSQLite: {
    createConnection: async () => {}, open: async () => {},
    query: async (o) => ({ values: await sq.ponte.query(o.statement, o.values) }),
    run: async (o) => { await sq.ponte.exec(o.statement, o.values); },
    executeSet: async (o) => { await sq.ponte.batch(o.set.map((s) => ({ sql: s.statement, params: s.values }))); },
  } } } };
  global.indexedDB = idb;

  let store = carregar();
  check('no aparelho usa a memória interna (SQLite)', (await store.storageKind()) === 'sqlite');
  const migradas = await store.salesList();
  check('as vendas que já estavam no IndexedDB foram trazidas', migradas.length === 2);
  check('  com o conteúdo intacto', migradas.some((v) => v.clientOpId === 'venda-de-ontem-1' && v.grossTotal === 5000));
  check('  e com id novo, atribuído pelo SQLite', migradas.every((v) => typeof v.id === 'number' && v.id > 0));
  check('  trazidas num lote só (tudo-ou-nada)', sq.lotes.length === 1 && sq.lotes[0] === 2);
  check('o IndexedDB antigo NÃO é apagado (rede de segurança)', idb.stores.pendingSales.size === 2);

  // Não repete a migração — senão duplicava as vendas a cada arranque.
  store = carregar();
  await store.salesList();
  check('a migração não se repete (não duplica vendas)', (await store.salesCount()) === 2);

  // ── 2. O ciclo de vida de uma venda na memória interna ──────────────
  const id = await store.salesAdd({ clientOpId: 'venda-nova', status: 'PENDING', grossTotal: 999 });
  check('gravar uma venda devolve o seu id', id > 0);
  check('  e ela aparece na fila', (await store.salesCount()) === 3);

  const lista = await store.salesList();
  const nova = lista.find((v) => v.clientOpId === 'venda-nova');
  await store.salesPut({ ...nova, status: 'ERROR', lastError: 'servidor recusou' });
  const depois = (await store.salesList()).find((v) => v.clientOpId === 'venda-nova');
  check('alterar a venda guarda o novo estado', depois.status === 'ERROR');
  check('  e não cria uma segunda', (await store.salesCount()) === 3);

  await store.salesDelete(nova.id);
  check('apagar tira-a da fila', (await store.salesCount()) === 2);

  await store.kvSet('catalogo', [{ nome: 'Produto' }]);
  check('a cache do catálogo também vive na memória interna',
    (await store.kvGet('catalogo'))[0].nome === 'Produto');

  // ── 3. No navegador: recuo para IndexedDB, sem partir nada ──────────
  global.window = {};
  global.indexedDB = indexedDbDeMentira([]).open ? indexedDbDeMentira([]) : undefined;
  store = carregar();
  check('no navegador recua para IndexedDB', (await store.storageKind()) === 'indexeddb');
  await store.kvSet('x', { a: 1 });
  check('  e continua a guardar', (await store.kvGet('x')).a === 1);

  // ── 4. Ponte a falhar: vende-se na mesma ────────────────────────────
  global.window = { Capacitor: { Plugins: { CapacitorSQLite: {
    createConnection: async () => { throw new Error('sem espaço no aparelho'); },
    query: async () => ({ values: [] }), run: async () => {}, executeSet: async () => {},
  } } } };
  global.indexedDB = indexedDbDeMentira([]);
  store = carregar();
  check('SQLite a falhar → recua para IndexedDB (nunca impede a venda)',
    (await store.storageKind()) === 'indexeddb');
  const idFalha = await store.salesAdd({ clientOpId: 'venda-com-sqlite-avariado' });
  check('  e a venda fica gravada à mesma', idFalha > 0);

  rmSync(tmp, { recursive: true, force: true });
  for (const [e, n] of r) console.log(e, n);
  const falhas = r.filter(([e]) => e !== 'OK  ').length;
  console.log(`\n${r.length - falhas}/${r.length}`);
  process.exit(falhas ? 1 : 0);
})();
