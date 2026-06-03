// Alinha TODOS os tenants existentes com o template atual (idempotente):
// reaplica o template (cria tabelas em falta) + migrações (colunas em falta).
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';

const prisma = new PrismaClient();
const tpl = readFileSync(new URL('../prisma/tenant_template.sql', import.meta.url), 'utf-8');
const mig = readFileSync(new URL('../prisma/tenant_migrations.sql', import.meta.url), 'utf-8');

function statements(raw, schema) {
  const sub = raw.replaceAll('{{SCHEMA}}', schema);
  const stripped = sub.split('\n').map((l) => { const i = l.indexOf('--'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
  return stripped.split(';').map((s) => s.trim()).filter(Boolean);
}

try {
  const schemas = (await prisma.$queryRawUnsafe(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%' ORDER BY schema_name`,
  )).map((r) => r.schema_name);
  console.log(`Migrar ${schemas.length} tenant(s)…`);
  for (const schema of schemas) {
    const stmts = [...statements(tpl, schema), ...statements(mig, schema)];
    let ok = 0, fail = 0;
    for (const s of stmts) {
      try { await prisma.$executeRawUnsafe(s); ok++; }
      catch { fail++; }
    }
    console.log(`  [${schema}] ${ok} aplicados, ${fail} ignorados (já existiam/ok)`);
  }
  console.log('Migração concluída.');
} finally {
  await prisma.$disconnect();
}
