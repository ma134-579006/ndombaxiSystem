/**
 * PASSO 2 do Android independente: a LÓGICA FISCAL corre em PGlite?
 *
 * O passo 1 provou que o schema nasce igual. Isso não chega: o que torna a
 * faturação válida perante a AGT não é o desenho das tabelas, é o SQL que
 * corre sobre elas — e a API tem 745 pontos de SQL cru de PostgreSQL.
 *
 * Aqui exercem-se as consultas REAIS, copiadas do código de produção
 * (`invoice.service.ts`, `document-counter.ts`), contra PGlite:
 *
 *   1. `fiscal_series ... FOR UPDATE` — a série que garante numeração SEM
 *      SALTOS e a cadeia de hash (exigência da AGT §7);
 *   2. `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` — a alocação atómica de
 *      números, que substituiu o frágil `COUNT(*)+1`;
 *   3. a CADEIA DE HASH: cada documento assinado sobre o anterior;
 *   4. duas emissões em paralelo não recebem o mesmo número.
 *
 * Se isto passar, o que falta para o Android independente é canalização
 * (hospedar o Node, adaptador Prisma) — não semântica de base de dados.
 */
import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const prisma = path.join(aqui, '..', 'prisma');
const SCHEMA = 'emp_fiscal';

const r = [];
const check = (nome, cond, extra) => r.push([cond ? 'OK  ' : 'FALHA', nome + (extra ? ` — ${extra}` : '')]);

const db = new PGlite();
await db.waitReady;
await db.exec(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
const ler = (f) => fs.readFileSync(path.join(prisma, f), 'utf-8').replaceAll('{{SCHEMA}}', SCHEMA);
await db.exec(ler('tenant_template.sql'));
await db.exec(ler('tenant_migrations.sql'));
await db.exec(`SET search_path TO "${SCHEMA}", public`);

// ── 1. A série fiscal com FOR UPDATE ──────────────────────────────────
const ANO = 2026;
const GENESIS = '0'.repeat(64);
await db.query(
  `INSERT INTO fiscal_series (doc_type, series, year, last_sequence, last_hash)
   VALUES ($1, 'A', $2, 0, $3) ON CONFLICT (doc_type, series, year) DO NOTHING`,
  ['FT', ANO, GENESIS],
);
const serie = await db.query(
  `SELECT last_sequence, last_hash FROM fiscal_series
    WHERE doc_type = $1 AND series = 'A' AND year = $2 FOR UPDATE`, ['FT', ANO],
);
check('a SÉRIE fiscal lê-se com FOR UPDATE', serie.rows.length === 1);
check('  começa no hash de génese', serie.rows[0].last_hash === GENESIS);

// ── 2. Emitir documentos: numeração + cadeia de hash ──────────────────
/** Assinatura encadeada, no espírito do que a AGT exige. */
function assinar(anterior, numero, total) {
  return createHash('sha256').update(`${anterior}|${numero}|${total}`).digest('hex');
}

const emitidos = [];
for (let i = 0; i < 5; i++) {
  await db.exec('BEGIN');
  const s = await db.query(
    `SELECT last_sequence, last_hash FROM fiscal_series
      WHERE doc_type = $1 AND series = 'A' AND year = $2 FOR UPDATE`, ['FT', ANO],
  );
  const seq = Number(s.rows[0].last_sequence) + 1;
  const hash = assinar(s.rows[0].last_hash, `FT A/${ANO}/${seq}`, 1000 + i);
  await db.query(
    `UPDATE fiscal_series SET last_sequence = $1, last_hash = $2
      WHERE doc_type = $3 AND series = 'A' AND year = $4`, [seq, hash, 'FT', ANO],
  );
  await db.exec('COMMIT');
  emitidos.push({ seq, hash, anterior: s.rows[0].last_hash });
}

check('5 documentos → sequência 1..5 SEM SALTOS',
  emitidos.map((e) => e.seq).join(',') === '1,2,3,4,5');
check('cada documento assina sobre o ANTERIOR',
  emitidos.every((e, i) => e.anterior === (i === 0 ? GENESIS : emitidos[i - 1].hash)));
check('  e a cadeia não repete hashes',
  new Set(emitidos.map((e) => e.hash)).size === 5);

// Adulterar um documento parte a cadeia — é para isso que ela serve.
const adulterado = assinar(emitidos[1].anterior, `FT A/${ANO}/2`, 999999);
check('alterar o total de um documento QUEBRA a cadeia', adulterado !== emitidos[1].hash);

// ── 3. Alocação atómica de números (document_counters) ────────────────
const numeros = [];
for (let i = 0; i < 3; i++) {
  const q = await db.query(
    `INSERT INTO document_counters (kind, year, last_sequence)
     VALUES ($1, $2, 1)
     ON CONFLICT (kind, year)
     DO UPDATE SET last_sequence = document_counters.last_sequence + 1
     RETURNING last_sequence`, ['PO', ANO],
  );
  numeros.push(Number(q.rows[0].last_sequence));
}
check('INSERT ... ON CONFLICT DO UPDATE RETURNING funciona', numeros.join(',') === '1,2,3');

// ── 4. Concorrência: dois pedidos ao mesmo tempo ──────────────────────
const paralelo = await Promise.all([1, 2, 3, 4].map(() => db.query(
  `INSERT INTO document_counters (kind, year, last_sequence)
   VALUES ($1, $2, 1)
   ON CONFLICT (kind, year)
   DO UPDATE SET last_sequence = document_counters.last_sequence + 1
   RETURNING last_sequence`, ['WEB', ANO],
)));
const obtidos = paralelo.map((p) => Number(p.rows[0].last_sequence));
check('4 pedidos em paralelo → 4 números DIFERENTES',
  new Set(obtidos).size === 4, obtidos.join(','));

// ── 5. O isolamento por empresa continua de pé ────────────────────────
await db.exec('CREATE SCHEMA IF NOT EXISTS emp_vizinha');
await db.exec(`CREATE TABLE emp_vizinha.fiscal_series (doc_type text, series text, year int, last_sequence int)`);
await db.query(`INSERT INTO emp_vizinha.fiscal_series VALUES ('FT','A',$1,999)`, [ANO]);
const minha = await db.query(
  `SELECT last_sequence FROM fiscal_series WHERE doc_type='FT' AND series='A' AND year=$1`, [ANO],
);
check('a série da empresa VIZINHA não contamina a nossa',
  Number(minha.rows[0].last_sequence) === 5);

for (const [e, n] of r) console.log(e, n);
const falhas = r.filter(([e]) => e !== 'OK  ').length;
console.log(`\n${r.length - falhas}/${r.length}`);
process.exit(falhas ? 1 : 0);
