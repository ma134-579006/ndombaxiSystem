/**
 * Prova de que o SERVIDOR LOCAL empacotado serve para alguma coisa.
 *
 * Um instalador que leva 120 MB de binários e depois não arranca na loja é pior
 * do que não os levar: o lojista descarrega, instala, e fica na mesma — sem
 * ninguém perceber porquê, porque num posto de venda não há consola.
 *
 * Verifica-se o que só se pode verificar ANTES de ir para a máquina do cliente:
 * que está lá tudo o que o supervisor vai procurar, com os nomes exatos que ele
 * procura. O arranque a sério prova-se à parte (`prova-arranque.cjs`), que
 * precisa dos binários — e agora eles existem.
 */
const path = require('node:path');
const fs = require('node:fs');

const desktop = path.join(__dirname, '..');
const resources = path.join(desktop, 'resources');

const r = [];
const check = (nome, cond) => r.push([cond ? 'OK  ' : 'FALHA', nome]);
const existe = (...p) => fs.existsSync(path.join(...p));
const mb = (dir) => {
  let t = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else t += fs.statSync(p).size;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return Math.round(t / 1024 / 1024);
};

// ── PostgreSQL ───────────────────────────────────────────────────────
const pg = path.join(resources, 'pgsql');

// Os nomes vêm de `postgres.ts` — se mudarem aqui, o posto não arranca.
for (const exe of ['initdb.exe', 'postgres.exe', 'pg_ctl.exe', 'pg_dump.exe']) {
  check(`pgsql/bin/${exe}`, existe(pg, 'bin', exe));
}
// Sem `share` não há ficheiros de arranque do cluster: o `initdb` falha.
check('pgsql/share (modelos do initdb)', existe(pg, 'share'));
check('pgsql/lib (bibliotecas do servidor)', existe(pg, 'lib'));

// O que NÃO deve ir: é a diferença entre 120 MB e 700 MB no instalador.
check('sem doc/ (peso morto num posto)', !existe(pg, 'doc'));
check('sem include/ (só serve para compilar)', !existe(pg, 'include'));
check('sem pgAdmin (interface que o lojista nunca abre)', !existe(pg, 'pgAdmin 4'));

// ── API ──────────────────────────────────────────────────────────────
const api = path.join(resources, 'api');

// É EXATAMENTE este caminho que o `spawnApi()` procura.
check('api/dist/main.js (o que o supervisor arranca)', existe(api, 'dist', 'main.js'));
check('api/prisma/schema.prisma (esquema da base)', existe(api, 'prisma', 'schema.prisma'));
check('api/prisma/tenant_template.sql (esquema das empresas)', existe(api, 'prisma', 'tenant_template.sql'));

// A CLI do Prisma, chamada pelo supervisor. Sem ela ficava dependente do `npx`
// — e na máquina de um lojista não há npm nenhum instalado.
check('api/node_modules/prisma/build/index.js (CLI, sem depender de npx)',
  existe(api, 'node_modules', 'prisma', 'build', 'index.js'));

// O cliente gerado e o motor de consulta. Sem isto a API arranca e morre no
// primeiro pedido à base de dados.
check('api/node_modules/.prisma/client (cliente gerado)',
  existe(api, 'node_modules', '.prisma', 'client', 'index.js'));
const clienteDir = path.join(api, 'node_modules', '.prisma', 'client');
check('  com o motor de consulta para Windows',
  fs.existsSync(clienteDir)
  && fs.readdirSync(clienteDir).some((f) => /query_engine-windows.*\.node$/.test(f)));

// As dependências têm de ser ficheiros a sério: os atalhos do pnpm apontam para
// pastas que não existem na máquina do lojista.
const nest = path.join(api, 'node_modules', '@nestjs', 'core');
check('dependências copiadas a sério (sem atalhos do pnpm)',
  fs.existsSync(nest) && !fs.lstatSync(path.join(api, 'node_modules', '@nestjs')).isSymbolicLink());

// Os pacotes do próprio monorepo que a API importa — o esquecimento clássico.
for (const p of ['@nexus/types', '@nexus/agt-xml', '@nexus/replication']) {
  check(`${p} incluído`, existe(api, 'node_modules', ...p.split('/'), 'package.json'));
}

for (const [e, n] of r) console.log(e, n);
const falhas = r.filter(([e]) => e !== 'OK  ').length;
console.log(`\npgsql: ${mb(pg)} MB · api: ${mb(api)} MB`);
console.log(`${r.length - falhas}/${r.length}`);
process.exit(falhas ? 1 : 0);
