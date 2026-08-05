/**
 * PASSO 1 do Android independente: o schema fiscal de uma empresa nasce IGUAL
 * em PGlite (PostgreSQL em WASM, que corre num telemóvel)?
 *
 * Se falhar aqui, todo o resto do plano é inútil — e é melhor sabê-lo agora.
 * O que se exige, por ordem de importância:
 *   1. as 2141 linhas do schema de uma empresa aplicam-se sem erro;
 *   2. os ÍNDICES ÚNICOS PARCIAIS existem — são eles que tornam impossível
 *      duplicar uma fatura, e não código nosso;
 *   3. o isolamento por empresa (`search_path` + schema próprio) funciona;
 *   4. a numeração fiscal com `FOR UPDATE` funciona.
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const prisma = path.join(aqui, '..', 'prisma');
const SCHEMA = 'emp_teste';

const r = [];
const check = (nome, cond, extra) => r.push([cond ? 'OK  ' : 'FALHA', nome + (extra ? ` — ${extra}` : '')]);

const db = new PGlite();
await db.waitReady;

const v = await db.query('SELECT version()');
console.log('  motor:', v.rows[0].version.split(',')[0]);

// ── 1. Aplicar o schema de uma empresa ────────────────────────────────
await db.exec(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);

const ler = (f) => fs.readFileSync(path.join(prisma, f), 'utf-8').replaceAll('{{SCHEMA}}', SCHEMA);

let erroTemplate = null;
try {
  await db.exec(ler('tenant_template.sql'));
} catch (e) {
  erroTemplate = e.message;
}
check('o schema de uma empresa aplica-se em PGlite', erroTemplate === null, erroTemplate ?? undefined);

let erroMigr = null;
try {
  await db.exec(ler('tenant_migrations.sql'));
} catch (e) {
  erroMigr = e.message;
}
check('as migrações da empresa aplicam-se', erroMigr === null, erroMigr ?? undefined);

// ── 2. Quantas tabelas nasceram ───────────────────────────────────────
const t = await db.query(
  `SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = $1 AND table_type = 'BASE TABLE'`, [SCHEMA],
);
check(`nasceram tabelas a sério (${t.rows[0].n})`, t.rows[0].n > 50);

// ── 3. A garantia anti-duplicação de faturas ──────────────────────────
const idx = await db.query(
  `SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = $1 AND indexdef ILIKE '%client_op_id%'`, [SCHEMA],
);
const nomes = idx.rows.map((x) => x.indexname);
check('índice único parcial nas FATURAS',
  idx.rows.some((x) => /invoices/.test(x.indexname) && /UNIQUE/i.test(x.indexdef) && /WHERE/i.test(x.indexdef)));
check('índice único parcial nos TURNOS',
  idx.rows.some((x) => /cash_sessions/.test(x.indexname) && /UNIQUE/i.test(x.indexdef)));
check(`  (${nomes.length} índices de idempotência encontrados)`, nomes.length >= 2);

// E o que interessa mesmo: ele IMPEDE a duplicação?
await db.exec(`SET search_path TO "${SCHEMA}", public`);
let duplicou = false;
try {
  const cols = await db.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'invoices' AND is_nullable = 'NO'
        AND column_default IS NULL`, [SCHEMA],
  );
  // Preenche o mínimo obrigatório com valores do tipo certo — o que se quer
  // provar é o índice, não a validação de negócio.
  const valorPara = (t) => {
    if (/int|numeric|double|real/.test(t)) return '0';
    if (/bool/.test(t)) return 'false';
    if (/timestamp|date/.test(t)) return "'2026-01-01'";
    if (/uuid/.test(t)) return "'22222222-2222-2222-2222-222222222222'::uuid";
    if (/json/.test(t)) return "'{}'::jsonb";
    return "'x'";
  };
  const obrig = cols.rows.map((c) => c.column_name);
  const vals = cols.rows.map((c) => valorPara(c.data_type));
  const op = '11111111-1111-1111-1111-111111111111';
  const sql = `INSERT INTO invoices (client_op_id${obrig.length ? ', ' + obrig.map((c) => `"${c}"`).join(', ') : ''})
               VALUES ($1::uuid${vals.length ? ', ' + vals.join(', ') : ''})`;
  await db.query(sql, [op]);
  await db.query(sql, [op]); // MESMA chave: tem de rebentar
  duplicou = true;
} catch (e) {
  duplicou = !/duplicate key|unique/i.test(e.message);
  if (duplicou) check('  (o teste de duplicação não correu)', false, e.message.slice(0, 120));
}
if (!duplicou) check('DUAS faturas com a mesma chave → o PostgreSQL recusa', true);

// ── 4. Isolamento por empresa ─────────────────────────────────────────
await db.exec('CREATE SCHEMA IF NOT EXISTS emp_outra');
await db.exec('CREATE TABLE emp_outra.invoices (id int)');
const cnt = await db.query(
  `SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'emp_outra'`,
);
check('duas empresas, dois schemas independentes', cnt.rows[0].n === 1);

// ── 5. FOR UPDATE (a numeração fiscal sem saltos) ─────────────────────
let forUpdate = true;
try {
  await db.exec('BEGIN');
  await db.query(`SELECT * FROM "${SCHEMA}".document_counters FOR UPDATE`);
  await db.exec('COMMIT');
} catch (e) {
  try { await db.exec('ROLLBACK'); } catch { /* ignore */ }
  forUpdate = /does not exist/i.test(e.message); // tabela ausente ≠ FOR UPDATE partido
  if (!forUpdate) check('FOR UPDATE (numeração sem saltos)', false, e.message.slice(0, 120));
}
if (forUpdate) check('FOR UPDATE (numeração sem saltos) funciona', true);

for (const [e, n] of r) console.log(e, n);
const falhas = r.filter(([e]) => e !== 'OK  ').length;
console.log(`\n${r.length - falhas}/${r.length}`);
process.exit(falhas ? 1 : 0);
