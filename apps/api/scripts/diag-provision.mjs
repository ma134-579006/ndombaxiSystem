// Diagnóstico: aplica o tenant_template.sql statement-a-statement contra a BD
// real, num schema descartável, e reporta o PRIMEIRO statement que falha.
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();
const schema = `tenant_diag${randomBytes(3).toString('hex')}`;
const template = readFileSync(new URL('../prisma/tenant_template.sql', import.meta.url), 'utf-8');
const ddl = template.replaceAll('{{SCHEMA}}', schema);
const stripped = ddl
  .split('\n')
  .map((line) => { const i = line.indexOf('--'); return i >= 0 ? line.slice(0, i) : line; })
  .join('\n');
const statements = stripped.split(';').map((s) => s.trim()).filter((s) => s.length > 0);

console.log(`Schema: ${schema} · ${statements.length} statements`);
let n = 0;
try {
  for (const stmt of statements) {
    n++;
    try {
      await prisma.$executeRawUnsafe(stmt);
    } catch (e) {
      const first = stmt.split('\n').slice(0, 6).join('\n');
      console.error(`\n###### STATEMENT #${n} FAILED ######\n${first}\n------ ERROR: ${e.message}\n`);
      throw e;
    }
  }
  console.log('OK: todos os statements do template passaram.');

  // Reproduz o passo 3 do onboarding: criar loja padrão + Company Admin.
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}".stores (code, name, is_default) VALUES ('LOJA-001','Diag Loja', true)`,
    );
    const store = await prisma.$queryRawUnsafe(`SELECT id FROM "${schema}".stores LIMIT 1`);
    const storeId = store[0].id;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}".users (email, password_hash, name, role, store_id, must_reset_pw)
       VALUES ('diag@x.ao','hash','Diag Admin','COMPANY_ADMIN','${storeId}'::uuid, true)`,
    );
    console.log('OK: loja + utilizador Company Admin criados.');
  } catch (e) {
    console.error(`\n###### STEP 3 (store/user) FAILED ######\n------ ERROR: ${e.message}\n`);
    throw e;
  }
} finally {
  try { await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } catch {}
  await prisma.$disconnect();
}
