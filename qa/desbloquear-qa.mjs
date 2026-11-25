// QA LOCAL: desbloqueia as contas de teste depois dos ataques de força bruta do
// pentest (só corre contra a base de dados de QA em 127.0.0.1).
import { db, DB } from './lib.mjs';
if (!['127.0.0.1', 'localhost'].includes(new URL(DB).hostname)) { console.error('Só na BD local de QA.'); process.exit(1); }
const c = await db();
const { rows } = await c.query(`SELECT table_schema FROM information_schema.tables WHERE table_name='users' AND table_schema LIKE 'tenant_%'`);
let n = 0;
for (const r of rows) n += (await c.query(`UPDATE "${r.table_schema}".users SET failed_logins=0, locked_until=NULL WHERE failed_logins>0 OR locked_until IS NOT NULL`)).rowCount;
console.log(`desbloqueadas ${n} contas em ${rows.length} empresas`);
await c.end();
