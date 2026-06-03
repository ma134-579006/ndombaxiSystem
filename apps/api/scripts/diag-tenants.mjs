// Verifica a "deriva de schema": que colunas/tabelas faltam nos tenants existentes
// face ao template atual. Mostra o que a venda/funcionalidades precisam.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const NEEDED_COLS = {
  products: ['cost_price'],
  invoices: ['signature', 'signature_key_version', 'signable_string'],
  invoice_items: ['unit_cost', 'exemption_reason', 'exemption_code'],
  users: ['commission_rate', 'pin_hash'],
  employees: ['photo_url', 'taxable_allowances', 'exempt_allowances'],
};
const NEEDED_TABLES = [
  'expenses', 'receivables', 'payables', 'bank_transactions', 'leave_requests',
  'payroll_runs', 'payroll_items', 'suppliers', 'warehouses', 'stock_items',
  'stock_movements', 'purchase_orders', 'product_batches', 'stock_counts',
  'fiscal_series', 'fiscal_signing_keys', 'order_messages',
];

try {
  const schemas = await prisma.$queryRawUnsafe(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%' ORDER BY schema_name`,
  );
  console.log(`Tenants: ${schemas.length}`);
  for (const s of schemas) {
    const schema = s.schema_name;
    const problems = [];
    // Tabelas em falta
    const tbls = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}'`,
    );
    const have = new Set(tbls.map((t) => t.table_name));
    for (const t of NEEDED_TABLES) if (!have.has(t)) problems.push(`tabela:${t}`);
    // Colunas em falta
    for (const [tbl, cols] of Object.entries(NEEDED_COLS)) {
      if (!have.has(tbl)) continue;
      const colRows = await prisma.$queryRawUnsafe(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tbl}'`,
      );
      const hc = new Set(colRows.map((c) => c.column_name));
      for (const c of cols) if (!hc.has(c)) problems.push(`${tbl}.${c}`);
    }
    console.log(`\n[${schema}] ${problems.length === 0 ? 'OK (atualizado)' : problems.length + ' em falta:'}`);
    if (problems.length) console.log('  - ' + problems.join('\n  - '));
  }
} finally {
  await prisma.$disconnect();
}
