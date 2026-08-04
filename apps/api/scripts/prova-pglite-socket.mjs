/**
 * PASSO 3: o PGlite atende como um PostgreSQL NORMAL, por socket?
 *
 * Se sim, o obstáculo do adaptador Prisma desaparece por inteiro: a API não
 * precisa de saber que por baixo está WASM — liga-se com o mesmo
 * `DATABASE_URL` de sempre, e não é preciso migrar Prisma 5 → 7.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const prisma = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prisma');
const SCHEMA = 'emp_socket';
const PORTA = 55444;

const r = [];
const check = (n, c, e) => r.push([c ? 'OK  ' : 'FALHA', n + (e ? ` — ${e}` : '')]);

const db = new PGlite();
await db.waitReady;

const server = new PGLiteSocketServer({ db, port: PORTA, host: '127.0.0.1' });
await server.start();
check('PGlite atende como servidor PostgreSQL', true);

const cliente = new pg.Client({
  host: '127.0.0.1', port: PORTA, database: 'postgres', user: 'postgres',
});
let ligou = null;
try {
  await cliente.connect();
} catch (e) {
  ligou = e.message;
}
check('um cliente PostgreSQL normal (node-postgres) LIGA-SE', ligou === null, ligou ?? undefined);

if (ligou === null) {
  const v = await cliente.query('SELECT version()');
  console.log('  motor visto pelo cliente:', v.rows[0].version.split(',')[0]);

  // O schema fiscal inteiro, pelo fio, como a API faria.
  const ler = (f) => fs.readFileSync(path.join(prisma, f), 'utf-8').replaceAll('{{SCHEMA}}', SCHEMA);
  let erro = null;
  try {
    await cliente.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    await cliente.query(ler('tenant_template.sql'));
    await cliente.query(ler('tenant_migrations.sql'));
  } catch (e) {
    erro = e.message;
  }
  check('o schema de uma empresa aplica-se PELO SOCKET', erro === null, erro ?? undefined);

  const t = await cliente.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = $1 AND table_type = 'BASE TABLE'`, [SCHEMA],
  );
  check(`tabelas criadas pelo socket (${t.rows[0].n})`, t.rows[0].n > 50);

  // Consultas PARAMETRIZADAS (é assim que o Prisma fala).
  await cliente.query(`SET search_path TO "${SCHEMA}", public`);
  const ANO = 2026;
  await cliente.query(
    `INSERT INTO fiscal_series (doc_type, series, year, last_sequence, last_hash)
     VALUES ($1,'A',$2,0,$3) ON CONFLICT (doc_type, series, year) DO NOTHING`,
    ['FT', ANO, '0'.repeat(64)],
  );
  const s = await cliente.query(
    `SELECT last_sequence FROM fiscal_series WHERE doc_type=$1 AND series='A' AND year=$2 FOR UPDATE`,
    ['FT', ANO],
  );
  check('consulta PARAMETRIZADA com FOR UPDATE pelo socket', s.rows.length === 1);

  // Transação explícita, como a emissão de uma fatura faz.
  let tx = null;
  try {
    await cliente.query('BEGIN');
    await cliente.query('UPDATE fiscal_series SET last_sequence = last_sequence + 1 WHERE doc_type=$1', ['FT']);
    await cliente.query('COMMIT');
  } catch (e) { tx = e.message; }
  check('BEGIN / UPDATE / COMMIT pelo socket', tx === null, tx ?? undefined);

  const fim = await cliente.query(`SELECT last_sequence FROM fiscal_series WHERE doc_type='FT'`);
  check('  e a alteração ficou gravada', Number(fim.rows[0].last_sequence) === 1);

  await cliente.end();
}

await server.stop();
await db.close();

for (const [e, n] of r) console.log(e, n);
const falhas = r.filter(([e]) => e !== 'OK  ').length;
console.log(`\n${r.length - falhas}/${r.length}`);
process.exit(falhas ? 1 : 0);
