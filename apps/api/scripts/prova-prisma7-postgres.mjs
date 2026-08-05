/**
 * VALIDAÇÃO do Prisma 7 contra um PostgreSQL A SÉRIO.
 *
 * A suíte de testes da API (201/201) não toca numa base de dados — são todos
 * com mocks. Depois de trocar o Prisma 5 pelo 7, isso não chega: o que mudou foi
 * exatamente a camada que fala com a base (o `url` saiu do esquema e entrou um
 * *adapter*). Publicar sem exercer isto seria arriscar a faturação de todas as
 * lojas num salto de versão.
 *
 * Usa o PostgreSQL PORTÁTIL que já vai dentro do instalador Windows
 * (`apps/desktop/resources/pgsql`) — nada de tocar na base de produção.
 *
 * Como correr:
 *   1. iniciar o cluster (ver `scripts/LEIA-ME-prisma7.md`);
 *   2. `DATABASE_URL=postgresql://postgres:<senha>@127.0.0.1:<porta>/postgres \
 *       node scripts/prova-prisma7-postgres.mjs`
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const prismaDir = path.join(aqui, '..', 'prisma');
const base = { priceKz: 0, maxStores: 1, maxUsers: 1, maxProducts: 10, maxTxPerMonth: 100, modules: ['POS'] };

if (!process.env.DATABASE_URL) {
  console.error('Defina DATABASE_URL a apontar para um PostgreSQL de TESTE (nunca produção).');
  process.exit(2);
}

const r = [];
const check = (n, c, e) => r.push([c ? 'OK  ' : 'FALHA', n + (e ? ` — ${e}` : '')]);

const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

try {
  const v = await p.$queryRawUnsafe('SELECT version() AS v');
  check('Prisma 7 (adapter) ligado a um PostgreSQL real', /PostgreSQL/.test(v[0].v));

  // ── O cliente gerado: as operações que a API faz o dia todo ──────────
  await p.plan.deleteMany({ where: { tier: 'FREE' } }).catch(() => {});
  const criado = await p.plan.create({ data: { tier: 'FREE', name: 'Plano Real', ...base } });
  check('CREATE', !!criado.id);
  check('READ', (await p.plan.findUnique({ where: { tier: 'FREE' } }))?.name === 'Plano Real');
  await p.plan.update({ where: { tier: 'FREE' }, data: { maxUsers: 5 } });
  check('UPDATE', (await p.plan.findUnique({ where: { tier: 'FREE' } })).maxUsers === 5);

  // A garantia imposta pela BASE, não por código nosso.
  let duplicou = false;
  try {
    await p.plan.create({ data: { tier: 'FREE', name: 'outro', ...base } });
    duplicou = true;
  } catch { /* esperado */ }
  check('chave ÚNICA recusa duplicados', !duplicou);

  // É a transação interativa que emite uma fatura.
  await p.$transaction(async (tx) => {
    await tx.plan.update({ where: { tier: 'FREE' }, data: { maxUsers: 9 } });
  });
  check('$transaction interativa', (await p.plan.findUnique({ where: { tier: 'FREE' } })).maxUsers === 9);

  // 1138 usos de `Prisma.sql` no código da API — tem de continuar a funcionar.
  const raw = await p.$queryRaw(Prisma.sql`SELECT count(*)::int AS n FROM "nexus_public"."plans"`);
  check('$queryRaw com Prisma.sql', Number(raw[0].n) === 1);

  // ── O provisionamento de uma EMPRESA (o coração multi-tenant) ────────
  const S = 'tenant_p7teste01';
  const ler = (f) => fs.readFileSync(path.join(prismaDir, f), 'utf-8').replaceAll('{{SCHEMA}}', S);
  await p.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${S}" CASCADE`);
  await p.$executeRawUnsafe(`CREATE SCHEMA "${S}"`);
  await p.$executeRawUnsafe(ler('tenant_template.sql'));
  await p.$executeRawUnsafe(ler('tenant_migrations.sql'));
  const tabelas = await p.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = '${S}' AND table_type = 'BASE TABLE'`,
  );
  check(`provisionamento de uma EMPRESA (${tabelas[0].n} tabelas)`, Number(tabelas[0].n) > 50);

  // O isolamento multi-empresa vive num `search_path` por pedido.
  await p.$executeRawUnsafe(`SET search_path TO "${S}", public`);
  const series = await p.$queryRawUnsafe('SELECT count(*)::int AS n FROM fiscal_series');
  check('search_path (isolamento por empresa)', Number(series[0].n) === 0);

  await p.$executeRawUnsafe('SET search_path TO public');
  await p.plan.delete({ where: { tier: 'FREE' } });
  check('DELETE', (await p.plan.findUnique({ where: { tier: 'FREE' } })) === null);
  await p.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${S}" CASCADE`);
} catch (e) {
  check('erro inesperado', false, (e.message || '').split('\n').filter(Boolean).pop()?.slice(0, 150));
} finally {
  await p.$disconnect();
}

for (const [e, n] of r) console.log(e, n);
const falhas = r.filter(([e]) => e !== 'OK  ').length;
console.log(`\n${r.length - falhas}/${r.length}`);
process.exit(falhas ? 1 : 0);
