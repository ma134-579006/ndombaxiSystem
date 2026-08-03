/**
 * Prova do DIÁRIO DE ALTERAÇÕES contra PostgreSQL a SÉRIO.
 *
 * O diário é a base de toda a replicação incremental. Se falhar a apanhar uma
 * alteração, esse dado NUNCA sobe — perdido sem ninguém dar por isso, que é a
 * pior classe de avaria que este projeto pode ter. Por isso isto não se testa
 * com uma base de mentira: cria-se um cluster verdadeiro e vê-se.
 *
 * Precisa dos binários do PostgreSQL — ver LEIA-ME.md.
 *   NDOMBAXI_PG_ROOT=/pasta/que/contem/pgsql node scripts/prova-diario.cjs
 */
const path = require('node:path');
const fs = require('node:fs');

const LS = require(path.join(__dirname, '..', 'dist', 'index.js'));
const PG = require(path.join(__dirname, '..', 'dist', 'postgres.js'));
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const HERE = process.env.NDOMBAXI_PG_TEST_DIR || path.join(__dirname, '..', '.prova-diario');
const paths = LS.layout({
  userDataDir: path.join(HERE, 'localdata'),
  resourcesDir: process.env.NDOMBAXI_PG_ROOT || path.join(HERE, 'pgroot'),
});

const r = [];
const check = (nome, cond, extra = '') => {
  r.push([cond ? 'OK  ' : 'FALHA', nome + (extra ? ` — ${extra}` : '')]);
  return cond;
};

const SCHEMA = 'tenant_ab12cd34';

(async () => {
  if (!LS.binariesPresent(paths)) {
    console.log('Binários do PostgreSQL não encontrados — ver scripts/LEIA-ME.md');
    process.exit(2);
  }
  try {
    if (LS.readConfig(paths)) PG.stop(paths);
  } catch { /* nada a encerrar */ }
  fs.rmSync(path.join(HERE, 'localdata'), { recursive: true, force: true });

  const url = await LS.ensureLocalDatabase(paths);
  const c = new Client({ connectionString: url });
  await c.connect();

  try {
    await c.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    // Duas tabelas de cada classe que interessa.
    await c.query(`CREATE TABLE "${SCHEMA}".products (id uuid PRIMARY KEY, name text, price numeric)`);
    await c.query(`CREATE TABLE "${SCHEMA}".invoices (id uuid PRIMARY KEY, number text)`);
    await c.query(`CREATE TABLE "${SCHEMA}".stock_items (id uuid PRIMARY KEY, qty int)`); // derivada
    await c.query(`CREATE TABLE "${SCHEMA}".fiscal_series (id uuid PRIMARY KEY, series text)`); // do posto

    for (const sql of LS.journalDdl(SCHEMA)) await c.query(sql);
    check('diário criado', true);

    const tabelas = ['products', 'invoices', 'stock_items', 'fiscal_series'];
    for (const sql of LS.attachTriggersSql(SCHEMA, tabelas)) await c.query(sql);

    const trg = await c.query(
      `SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND NOT t.tgisinternal ORDER BY 1`, [SCHEMA]);
    const comGatilho = trg.rows.map((x) => x.relname);
    check('gatilho nas tabelas que se replicam',
      comGatilho.includes('products') && comGatilho.includes('invoices'), comGatilho.join(', '));
    check('  e NÃO nas derivadas nem nas do posto',
      !comGatilho.includes('stock_items') && !comGatilho.includes('fiscal_series'));
    check('  tabelas deixadas de fora são listadas',
      LS.skippedTables(tabelas).sort().join() === 'fiscal_series,stock_items');

    // Identidade do posto na ligação.
    await c.query(`SET nexus.device_id = 'posto-caixa-1'`);

    const P1 = '11111111-1111-4111-8111-111111111111';
    await c.query(`INSERT INTO "${SCHEMA}".products VALUES ($1,'Pão',100)`, [P1]);
    let j = await c.query(`SELECT * FROM "${SCHEMA}".sync_journal ORDER BY seq`);
    check('apanha o INSERT', j.rows.length === 1 && j.rows[0].op === 'I');
    check('  com o id da linha', j.rows[0].row_id === P1);
    check('  e com o posto de origem', j.rows[0].device_id === 'posto-caixa-1');

    await c.query(`UPDATE "${SCHEMA}".products SET price = 120 WHERE id = $1`, [P1]);
    await c.query(`DELETE FROM "${SCHEMA}".products WHERE id = $1`, [P1]);
    j = await c.query(`SELECT op FROM "${SCHEMA}".sync_journal ORDER BY seq`);
    check('apanha UPDATE e DELETE', j.rows.map((x) => x.op).join('') === 'IUD');

    // Alteração DENTRO de uma transação desfeita não pode ficar registada.
    await c.query('BEGIN');
    await c.query(`INSERT INTO "${SCHEMA}".products VALUES ($1,'Fantasma',1)`,
      ['22222222-2222-4222-8222-222222222222']);
    await c.query('ROLLBACK');
    const fantasma = await c.query(
      `SELECT count(*)::int n FROM "${SCHEMA}".sync_journal WHERE row_id = $1`,
      ['22222222-2222-4222-8222-222222222222']);
    check('uma transação DESFEITA não deixa rasto no diário', fantasma.rows[0].n === 0);

    // Uma ligação que se esqueça do device_id não pode fazer falhar uma venda.
    const c2 = new Client({ connectionString: url });
    await c2.connect();
    const P2 = '33333333-3333-4333-8333-333333333333';
    let semDevice = true;
    try {
      await c2.query(`INSERT INTO "${SCHEMA}".products VALUES ($1,'Sem posto',5)`, [P2]);
    } catch { semDevice = false; }
    await c2.end();
    check('sem identidade de posto a VENDA passa à mesma', semDevice);

    // Dez edições da mesma linha sobem UMA vez.
    const P3 = '44444444-4444-4444-8444-444444444444';
    await c.query(`INSERT INTO "${SCHEMA}".products VALUES ($1,'Muito editado',1)`, [P3]);
    for (let i = 0; i < 10; i++) {
      await c.query(`UPDATE "${SCHEMA}".products SET price = $2 WHERE id = $1`, [P3, i]);
    }
    const pend = await c.query(LS.pendingSql(SCHEMA, 100));
    const doP3 = pend.rows.filter((x) => x.row_id === P3);
    check('dez edições da mesma linha → UMA entrada por subir', doP3.length === 1,
      `${doP3.length} entrada(s)`);
    check('  e é a MAIS RECENTE', doP3[0].op === 'U');

    // Faturas: cada uma é um facto próprio, não se agrupam.
    await c.query(`INSERT INTO "${SCHEMA}".invoices VALUES (gen_random_uuid(),'FT A1/1')`);
    await c.query(`INSERT INTO "${SCHEMA}".invoices VALUES (gen_random_uuid(),'FT A1/2')`);
    const pend2 = await c.query(LS.pendingSql(SCHEMA, 100));
    check('duas faturas → duas entradas (não se agrupam)',
      pend2.rows.filter((x) => x.table_name === 'invoices').length === 2);

    // A entrada escolhida tem de ser MESMO a última — em NÚMERO, não em texto.
    // Com mais de 9 alterações na mesma linha, uma ordenação por texto escolhe
    // a '9' em vez da '16' ('9' > '16' alfabeticamente). Era uma avaria real:
    // o motor subiria o estado ANTIGO da linha e, se ela tivesse sido apagada
    // entretanto, ressuscitava-a.
    const alvo = pend2.rows.find((x) => x.row_id === P3);
    const maxP3 = await c.query(
      `SELECT max(seq)::text AS m FROM "${SCHEMA}".sync_journal WHERE row_id = $1`, [P3]);
    check('escolhe a alteração MAIS RECENTE por número, não por texto',
      alvo.seq === maxP3.rows[0].m, `escolheu ${alvo.seq}, a última é ${maxP3.rows[0].m}`);

    const upd = await c.query(LS.markSyncedSql(SCHEMA), ['products', P3, alvo.seq]);
    check('  e marcar cobre TODAS as alterações dessa linha', upd.rowCount === 11,
      `${upd.rowCount} marcadas`);
    const pend3 = await c.query(LS.pendingSql(SCHEMA, 100));
    check('marcar como sincronizado tira da lista',
      !pend3.rows.some((x) => x.row_id === P3));

    // Uma alteração DEPOIS da marcação volta a ficar pendente.
    await c.query(`UPDATE "${SCHEMA}".products SET price = 999 WHERE id = $1`, [P3]);
    const pend4 = await c.query(LS.pendingSql(SCHEMA, 100));
    check('  mas uma alteração POSTERIOR volta a ficar pendente',
      pend4.rows.some((x) => x.row_id === P3));

    // Limpeza não apaga o que ainda não subiu.
    const antes = await c.query(`SELECT count(*)::int n FROM "${SCHEMA}".sync_journal WHERE synced_at IS NULL`);
    await c.query(LS.pruneSql(SCHEMA, 30));
    const depois = await c.query(`SELECT count(*)::int n FROM "${SCHEMA}".sync_journal WHERE synced_at IS NULL`);
    check('a limpeza NUNCA apaga o que falta subir', antes.rows[0].n === depois.rows[0].n);

    // Correr o DDL outra vez não parte nada (corre a cada arranque).
    for (const sql of LS.journalDdl(SCHEMA)) await c.query(sql);
    for (const sql of LS.attachTriggersSql(SCHEMA, tabelas)) await c.query(sql);
    const aindaLa = await c.query(`SELECT count(*)::int n FROM "${SCHEMA}".sync_journal`);
    check('repetir o arranque não duplica gatilhos nem perde o diário',
      aindaLa.rows[0].n > 0);
    await c.query(`INSERT INTO "${SCHEMA}".products VALUES (gen_random_uuid(),'Depois',1)`);
    const umaSo = await c.query(
      `SELECT count(*)::int n FROM "${SCHEMA}".sync_journal WHERE table_name='products' AND op='I'`);
    check('  e cada INSERT continua a dar UMA entrada só',
      umaSo.rows[0].n === 4, `${umaSo.rows[0].n} inserções registadas`);
  } finally {
    await c.end();
    try { PG.stop(paths); } catch { /* nada */ }
  }

  console.log();
  for (const [st, nome] of r) console.log(st, nome);
  const falhas = r.filter(([s]) => s !== 'OK  ').length;
  console.log(`\n${r.length - falhas}/${r.length} passaram`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('rebentou:', e.message); process.exit(1); });
