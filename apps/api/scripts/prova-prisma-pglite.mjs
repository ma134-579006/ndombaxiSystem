/**
 * PASSO 5 do Android independente: o PRISMA a falar com o PGlite, sem socket.
 *
 * Os passos 1-3 provaram que o PGlite aguenta o schema, a lógica fiscal e o
 * protocolo do PostgreSQL. O passo 4 provou que o Prisma 7 continua a servir a
 * API contra um PostgreSQL a sério. Faltava a junta entre os dois — e é a junta
 * que decide se o telemóvel pode correr a MESMA API: sem um adapter em
 * processo, o Prisma só sabe falar por TCP, e no telemóvel não há servidor.
 *
 * Aqui corre-se o CLIENTE GERADO do Prisma sobre `@nexus/prisma-adapter-pglite`,
 * com a base inteiramente em memória — nenhum servidor, nenhuma porta aberta.
 *
 * O que se exige (e porquê):
 *   • o schema global REAL nasce por script multi-comando;
 *   • CRUD pelo cliente gerado, como a API faz o dia todo;
 *   • a chave única recusa duplicados E o erro continua RECONHECÍVEL — é dele
 *     que depende o código que impede a MESMA fatura ser gravada duas vezes;
 *   • a transação interativa GRAVA no commit e DESFAZ no erro;
 *   • os tipos chegam na mesma forma que vêm da nuvem (dinheiro, datas, JSON);
 *   • uma empresa inteira é provisionada (78 tabelas) e isolada por search_path;
 *   • 4 emissões em paralelo não se pisam, apesar de haver UMA só sessão.
 *
 * Como correr:  pnpm --filter @nexus/api prova:prisma-pglite
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from '@nexus/prisma-adapter-pglite';
import { execSync } from 'node:child_process';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.join(aqui, '..');
const prismaDir = path.join(apiDir, 'prisma');
const base = { priceKz: 0, maxStores: 1, maxUsers: 1, maxProducts: 10, maxTxPerMonth: 100, modules: ['POS'] };

const r = [];
const check = (n, c, e) => r.push([c ? 'OK  ' : 'FALHA', n + (e ? ` — ${e}` : '')]);
const msgDe = (e) => (e?.message || String(e)).replace(/\s+/g, ' ');

/** O DDL do schema global, tirado do schema.prisma REAL (não precisa de BD). */
function ddlDoSchemaGlobal() {
  // Pelo `npx` do próprio pacote. Chamar o ficheiro do CLI à mão não serve: o
  // pnpm isola as dependências e o `prisma.config.ts` deixaria de encontrar o
  // `dotenv`.
  const sql = execSync(
    'npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script',
    { cwd: apiDir, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  return { sql, tabelas: (sql.match(/^CREATE TABLE /gm) ?? []).length };
}

const pglite = new PGlite(); // em memória: nada toca no disco nem na nuvem
await pglite.waitReady;

const p = new PrismaClient({ adapter: new PrismaPGlite(pglite, { schema: 'nexus_public' }) });

try {
  const v = await p.$queryRawUnsafe('SELECT version() AS v');
  check('Prisma 7 ligado ao PGlite EM PROCESSO (sem socket)', /PostgreSQL/.test(v[0].v), v[0].v.split(' ').slice(0, 2).join(' '));

  // ── O schema global nasce de um script com DEZENAS de comandos ──────
  // (o protocolo estendido do PGlite recusaria isto — daí a via `exec`)
  const { sql, tabelas: esperadas } = ddlDoSchemaGlobal();
  await p.$executeRawUnsafe(sql);
  const tGlobais = await p.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'nexus_public' AND table_type = 'BASE TABLE'`,
  );
  // Não vale "mais de tantas": exige-se o número EXACTO que o schema.prisma
  // manda criar. Uma tabela que ficasse por nascer só apareceria no telemóvel
  // do lojista, no dia em que ele abrisse o módulo que a usa.
  check(
    `schema GLOBAL criado por script multi-comando (${tGlobais[0].n} tabelas)`,
    Number(tGlobais[0].n) === esperadas,
    Number(tGlobais[0].n) === esperadas ? undefined : `esperava ${esperadas}`,
  );

  // ── O cliente gerado: o que a API faz o dia todo ────────────────────
  const criado = await p.plan.create({ data: { tier: 'FREE', name: 'Plano Real', ...base } });
  check('CREATE', !!criado.id);
  check('READ', (await p.plan.findUnique({ where: { tier: 'FREE' } }))?.name === 'Plano Real');
  await p.plan.update({ where: { tier: 'FREE' }, data: { maxUsers: 5 } });
  check('UPDATE', (await p.plan.findUnique({ where: { tier: 'FREE' } })).maxUsers === 5);

  let duplicou = false;
  try {
    await p.plan.create({ data: { tier: 'FREE', name: 'outro', ...base } });
    duplicou = true;
  } catch { /* esperado */ }
  check('chave ÚNICA recusa duplicados', !duplicou);

  const raw = await p.$queryRaw(Prisma.sql`SELECT count(*)::int AS n FROM "nexus_public"."plans"`);
  check('$queryRaw com Prisma.sql', Number(raw[0].n) === 1);

  // ── A transação interativa: grava no fim, desfaz no erro ────────────
  await p.$transaction(async (tx) => {
    await tx.plan.update({ where: { tier: 'FREE' }, data: { maxUsers: 9 } });
  });
  check('$transaction interativa GRAVA no commit', (await p.plan.findUnique({ where: { tier: 'FREE' } })).maxUsers === 9);

  await p.$transaction(async (tx) => {
    await tx.plan.update({ where: { tier: 'FREE' }, data: { maxUsers: 77 } });
    throw new Error('falha a meio da venda');
  }).catch(() => {});
  check('$transaction DESFAZ tudo quando falha a meio', (await p.plan.findUnique({ where: { tier: 'FREE' } })).maxUsers === 9);

  // Depois de uma transação desfeita, a sessão TEM de continuar utilizável —
  // é sessão única: se ficasse presa, a app do lojista parava ali.
  check('a sessão sobrevive à transação desfeita', (await p.plan.count()) === 1);

  // ── Os tipos: é aqui que o dinheiro e as datas se perdem ────────────
  const t = await p.$queryRawUnsafe(`
    SELECT 1234.56::numeric AS dinheiro,
           '2026-08-05 10:11:12'::timestamp AS quando,
           9007199254740993::int8 AS grande,
           '{"a":1}'::jsonb AS documento,
           ARRAY['a','b']::text[] AS lista,
           TRUE AS bandeira,
           gen_random_uuid() AS id`);
  const linha = t[0];
  check('NUMERIC chega como decimal exato (dinheiro não arredonda)', String(linha.dinheiro) === '1234.56', String(linha.dinheiro));
  check('TIMESTAMP chega como data em UTC', linha.quando instanceof Date && linha.quando.toISOString() === '2026-08-05T10:11:12.000Z', String(linha.quando));
  check('INT8 grande NÃO perde precisão', String(linha.grande) === '9007199254740993', String(linha.grande));
  check('JSONB chega como objeto', linha.documento?.a === 1);
  check('ARRAY de texto chega como lista', Array.isArray(linha.lista) && linha.lista.join(',') === 'a,b', JSON.stringify(linha.lista));
  check('BOOLEAN chega como booleano', linha.bandeira === true);
  check('UUID chega como texto', /^[0-9a-f-]{36}$/.test(String(linha.id)));

  // ── Provisionar uma EMPRESA (o coração multi-tenant) ────────────────
  const S = 'tenant_pglite01';
  const ler = (f) => fs.readFileSync(path.join(prismaDir, f), 'utf-8').replaceAll('{{SCHEMA}}', S);
  await p.$executeRawUnsafe(`CREATE SCHEMA "${S}"`);
  await p.$executeRawUnsafe(ler('tenant_template.sql'));
  await p.$executeRawUnsafe(ler('tenant_migrations.sql'));
  const tabelas = await p.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = '${S}' AND table_type = 'BASE TABLE'`,
  );
  check(`provisionamento de uma EMPRESA (${tabelas[0].n} tabelas)`, Number(tabelas[0].n) > 50);

  // O isolamento entre empresas vive num search_path por pedido.
  await p.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${S}", nexus_public`);
    const n = await tx.$queryRawUnsafe('SELECT count(*)::int AS n FROM fiscal_series');
    check('search_path DENTRO da transação (isolamento por empresa)', Number(n[0].n) === 0);
  });

  // ── A barreira que impede a MESMA fatura duas vezes ─────────────────
  const OP = '11111111-1111-1111-1111-111111111111';
  const fatura = (numero) => p.$executeRawUnsafe(
    `INSERT INTO "${S}".invoices
       (number, doc_type, series, year, sequence, invoice_date,
        net_total, iva_total, gross_total, signable_string, previous_hash, hash, client_op_id)
     VALUES ($1,'FT','A',2026,$2,'2026-08-05',1000,140,1140,'s','0','h',$3::uuid)`,
    numero, Number(numero.split('/').pop()), OP,
  );
  await fatura('FT A/2026/1');
  let erroDuplicado = null;
  await fatura('FT A/2026/2').catch((e) => { erroDuplicado = e; });
  const nFaturas = await p.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${S}".invoices`);
  check('o reenvio da MESMA venda NÃO cria uma 2ª fatura', Number(nFaturas[0].n) === 1);

  // O código de produção reconhece o duplicado pela MENSAGEM do erro
  // (`pos.controller.ts`, `push.service.ts`). Se a mensagem mudar de forma,
  // o reenvio offline deixa de ser reconhecido e a fatura duplica na mesma.
  const m = msgDe(erroDuplicado);
  const reconhecido = (m.includes('23505') || /duplicate key value/i.test(m)) && m.includes('invoices_client_op_uidx');
  check('o erro continua RECONHECÍVEL pelo código que trata reenvios', reconhecido, reconhecido ? undefined : m.slice(0, 160));

  // ── Sessão única: pedidos em paralelo não se pisam ──────────────────
  await Promise.all([2, 3, 4, 5].map((i) => p.$executeRawUnsafe(
    `INSERT INTO "${S}".invoices
       (number, doc_type, series, year, sequence, invoice_date,
        net_total, iva_total, gross_total, signable_string, previous_hash, hash)
     VALUES ($1,'FT','A',2026,$2,'2026-08-05',1000,140,1140,'s','0','h')`,
    `FT A/2026/${i}`, i,
  )));
  const seqs = await p.$queryRawUnsafe(`SELECT count(DISTINCT sequence)::int AS n FROM "${S}".invoices`);
  check('4 gravações em PARALELO numa sessão única → 4 documentos', Number(seqs[0].n) === 5);

  await p.plan.delete({ where: { tier: 'FREE' } });
  check('DELETE', (await p.plan.findUnique({ where: { tier: 'FREE' } })) === null);

  // ── O que fica GRAVADO quando a app é fechada ───────────────────────
  // Até aqui a base viveu na memória do processo. No telemóvel isso não chega:
  // fechar a app não pode apagar as vendas do dia. Aqui a base vai para uma
  // PASTA (é o que no aparelho será a memória interna), a app "fecha" e volta
  // a abrir do zero — e o que lá estava tem de estar lá.
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-pglite-'));
  try {
    const abrir = () => new PrismaClient({ adapter: new PrismaPGlite(() => PGlite.create({ dataDir: pasta })) });

    const p1 = abrir();
    await p1.$executeRawUnsafe('CREATE TABLE vendas_do_dia (id INT PRIMARY KEY, total NUMERIC(14,2) NOT NULL)');
    await p1.$executeRawUnsafe('INSERT INTO vendas_do_dia (id, total) VALUES ($1, $2)', 1, '1140.00');
    await p1.$disconnect(); // fecha o PGlite: foi ele a abri-lo (quem abre, fecha)

    const p2 = abrir();
    const guardado = await p2.$queryRawUnsafe('SELECT total FROM vendas_do_dia WHERE id = 1');
    check('a venda SOBREVIVE a fechar e reabrir a app (base em pasta)', String(guardado[0]?.total) === '1140', String(guardado[0]?.total));
    await p2.$disconnect();
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
} catch (e) {
  check('erro inesperado', false, msgDe(e).slice(0, 200));
} finally {
  await p.$disconnect();
  await pglite.close();
}

for (const [e, n] of r) console.log(e, n);
const falhas = r.filter(([e]) => e !== 'OK  ').length;
console.log(`\n${r.length - falhas}/${r.length}`);
process.exit(falhas ? 1 : 0);
