/**
 * QA — Cenário I (segurança fiscal na BASE DE DADOS): tenta, diretamente em
 * SQL numa empresa de QA, adulterar documentos fiscais e o trilho de auditoria.
 * Tudo dentro de transacções com ROLLBACK (não deixa rasto). Só localhost.
 *
 * Uso: node qa/fiscal-imutabilidade.mjs
 */
import fs from 'node:fs';
import { db, Report } from './lib.mjs';

const R = new Report('fiscal-imutabilidade');
const pub = await db('nexus_public');
const tenants = (await pub.query(`SELECT "schemaName" AS s FROM nexus_public.companies WHERE "schemaName" IS NOT NULL ORDER BY "createdAt" DESC`)).rows.map((r) => r.s);
let schema = null, inv = null;
for (const t of tenants) {
  const r = await pub.query(`SELECT id, number, status, gross_total FROM "${t}".invoices WHERE status = 'N' ORDER BY created_at DESC LIMIT 1`).catch(() => ({ rows: [] }));
  if (r.rows[0]) { schema = t; inv = r.rows[0]; break; }
}
if (!schema) { console.log('Sem faturas em nenhuma empresa de QA — emita uma venda primeiro.'); process.exit(1); }
console.log(`Empresa ${schema}, fatura ${inv.number}`);

/** Corre `sql` numa transacção e faz sempre ROLLBACK. Devolve { error, rowCount }. */
async function attempt(sql, params = []) {
  const c = await db('nexus_public');
  try {
    await c.query('BEGIN');
    const r = await c.query(sql, params);
    return { error: null, rowCount: r.rowCount };
  } catch (e) { return { error: e.message }; }
  finally { await c.query('ROLLBACK').catch(() => {}); await c.end(); }
}
const after = async (sql, params) => (await pub.query(sql, params)).rows[0];

let r = await attempt(`UPDATE "${schema}".invoices SET gross_total = 1 WHERE id = $1`, [inv.id]);
R.check('FI-1', 'alterar o total de uma fatura emitida não tem efeito', r.error === null && r.rowCount === 0, JSON.stringify(r));
r = await attempt(`DELETE FROM "${schema}".invoices WHERE id = $1`, [inv.id]);
R.check('FI-2', 'apagar uma fatura emitida não tem efeito', r.error === null && r.rowCount === 0, JSON.stringify(r));
r = await attempt(`UPDATE "${schema}".invoices SET status = 'X' WHERE id = $1`, [inv.id]);
R.check('FI-3', 'estado inventado → erro', /FISCAL: estado/.test(r.error ?? ''), r.error ?? 'sem erro');
r = await attempt(`UPDATE "${schema}".invoices SET status = 'A' WHERE id = $1`, [inv.id]);
R.check('FI-4', 'anular sem ciclo ANNULLED → erro', /ciclo ANNULLED/.test(r.error ?? ''), r.error ?? 'sem erro');
r = await attempt(`UPDATE "${schema}".invoices SET status = 'A', doc_state = 'ANNULLED' WHERE id = $1; UPDATE "${schema}".invoices SET status = 'N', doc_state = 'ISSUED' WHERE id = $1`.split(';')[0], [inv.id]);
R.check('FI-5', 'anulação legítima (N→A + ANNULLED) é aceite', r.error === null && r.rowCount === 1, JSON.stringify(r));
{
  const c = await db('nexus_public');
  let err = null;
  try {
    await c.query('BEGIN');
    await c.query(`UPDATE "${schema}".invoices SET status = 'A', doc_state = 'ANNULLED' WHERE id = $1`, [inv.id]);
    await c.query(`UPDATE "${schema}".invoices SET status = 'N', doc_state = 'ISSUED' WHERE id = $1`, [inv.id]);
  } catch (e) { err = e.message; } finally { await c.query('ROLLBACK').catch(() => {}); await c.end(); }
  R.check('FI-6', 'repor uma fatura anulada (A→N) → erro', /não pode voltar a normal|anulado/.test(err ?? ''), err ?? 'sem erro');
}
r = await attempt(`TRUNCATE "${schema}".invoices CASCADE`);
R.check('FI-7', 'TRUNCATE das faturas → erro', /não pode ser esvaziada/.test(r.error ?? ''), r.error ?? 'sem erro');
r = await attempt(`TRUNCATE "${schema}".invoice_items`);
R.check('FI-8', 'TRUNCATE das linhas → erro', /não pode ser esvaziada/.test(r.error ?? ''), r.error ?? 'sem erro');
r = await attempt(`UPDATE "${schema}".invoice_items SET net_amount = 0 WHERE invoice_id = $1`, [inv.id]);
R.check('FI-9', 'alterar linhas de uma fatura não tem efeito', r.error === null && r.rowCount === 0, JSON.stringify(r));
const audit = await after(`SELECT seq FROM "${schema}".tenant_audit_log ORDER BY seq DESC LIMIT 1`);
if (audit) {
  r = await attempt(`DELETE FROM "${schema}".tenant_audit_log WHERE seq = $1`, [audit.seq]);
  R.check('FI-10', 'apagar registo de auditoria → erro', /não se apagam/.test(r.error ?? ''), r.error ?? 'sem erro');
  r = await attempt(`UPDATE "${schema}".tenant_audit_log SET action = 'NADA' WHERE seq = $1`, [audit.seq]);
  R.check('FI-11', 'alterar registo de auditoria → erro', /não se altera/.test(r.error ?? ''), r.error ?? 'sem erro');
  r = await attempt(`TRUNCATE "${schema}".tenant_audit_log`);
  R.check('FI-12', 'TRUNCATE da auditoria → erro', /não pode ser esvaziada/.test(r.error ?? ''), r.error ?? 'sem erro');
}
const dup = await after(`SELECT doc_type, series, year, sequence FROM "${schema}".invoices WHERE id = $1`, [inv.id]);
r = await attempt(
  `INSERT INTO "${schema}".invoices (number, doc_type, series, year, sequence, invoice_date, net_total, iva_total, gross_total, signable_string, previous_hash, hash)
   VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 1, 0, 1, 's', '', 'h')`,
  [`${inv.number}-DUP`, dup.doc_type, dup.series, dup.year, dup.sequence],
);
R.check('FI-13', 'reutilizar (tipo, série, ano, sequência) → erro de unicidade', /invoices_series_seq_unique|duplicate key/.test(r.error ?? ''), r.error ?? 'sem erro');
const still = await after(`SELECT status, gross_total FROM "${schema}".invoices WHERE id = $1`, [inv.id]);
R.check('FI-14', 'a fatura ficou intacta no fim', still.status === inv.status && String(still.gross_total) === String(inv.gross_total), JSON.stringify(still));
await pub.end();

fs.mkdirSync('qa/out', { recursive: true });
const sum = R.summary();
fs.writeFileSync('qa/out/fiscal-imutabilidade.json', JSON.stringify(sum, null, 1));
console.log(`\n${sum.passed}/${sum.total} passaram; ${sum.failed} falharam`);
