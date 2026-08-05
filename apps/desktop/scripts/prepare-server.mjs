/**
 * Prepara o SERVIDOR LOCAL para ir dentro do instalador Windows.
 *
 * É isto que transforma o Ndombaxi System de "aplicação que precisa da nuvem"
 * em "aplicação que trabalha na loja mesmo sem internet": o PostgreSQL portátil
 * e a API compilada passam a viajar com o instalador.
 *
 * Produz duas pastas dentro de `resources/`:
 *   • `pgsql/` — o PostgreSQL 16 para Windows, PODADO. Do zip oficial (323 MB)
 *     ficam só `bin`, `lib` e `share`; sai `doc/`, `include/`, `symbols/` e o
 *     pgAdmin, que são a maior parte do peso e não servem num posto de venda.
 *   • `api/` — a API do Ndombaxi compilada, com as suas dependências reais
 *     (sem os atalhos do pnpm, que não sobrevivem a sair do repositório).
 *
 * ⚠️ A ORDEM importa e está garantida noutro sítio: os binários só podem ir no
 * instalador porque a barreira do `readiness.ts` já está em produção. Sem ela,
 * bastava incluí-los para cada posto passar a falar com uma base VAZIA — o
 * lojista abria a app e não encontrava a empresa, nem os produtos, nem as
 * vendas. Hoje a base local só serve a aplicação depois de ligada de propósito
 * E provisionada.
 *
 * O zip do PostgreSQL não vive no repositório (é enorme e não é nosso). Passa-se
 * o caminho em `NDOMBAXI_PG_ZIP`, ou deixa-se a pasta `resources/pgsql` já
 * pronta de uma execução anterior.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const repo = path.resolve(desktop, '..', '..');
const resources = path.join(desktop, 'resources');

function log(m) { process.stdout.write(`  ${m}\n`); }
function tamanho(dir) {
  let total = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else total += fs.statSync(p).size;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return (total / 1024 / 1024).toFixed(0);
}

// ── PostgreSQL portátil ───────────────────────────────────────────────

/** O que sobrevive à poda. Tudo o resto é peso morto num posto de venda. */
const PASTAS_UTEIS = ['bin', 'lib', 'share'];

function prepararPostgres() {
  const destino = path.join(resources, 'pgsql');
  const jaPronto = fs.existsSync(path.join(destino, 'bin', 'postgres.exe'));

  const zip = process.env.NDOMBAXI_PG_ZIP;
  if (jaPronto && !zip) {
    log(`PostgreSQL já preparado (${tamanho(destino)} MB) — nada a fazer`);
    return;
  }
  if (!zip) {
    throw new Error(
      'Faltam os binários do PostgreSQL. Defina NDOMBAXI_PG_ZIP com o caminho do zip\n'
      + '  oficial (https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip)\n'
      + '  ou deixe uma pasta resources/pgsql já preparada.',
    );
  }
  if (!fs.existsSync(zip)) throw new Error(`Zip do PostgreSQL não encontrado: ${zip}`);

  const temp = path.join(desktop, '.pg-tmp');
  fs.rmSync(temp, { recursive: true, force: true });
  fs.mkdirSync(temp, { recursive: true });

  log('A extrair o PostgreSQL (só as pastas necessárias)…');
  // Extrai APENAS `bin`, `lib` e `share` — 99 MB em ~11 s.
  //
  // O caminho óbvio (`Expand-Archive` do PowerShell) não filtra: extraía os 700
  // MB completos, incluindo o pgAdmin e a documentação, e levava mais de uma
  // hora nesta máquina. O `unzip` aceita padrões e só toca no que interessa.
  //
  // `**` e não `*`: neste `unzip`, `pgsql/share/*` traz só os 14 ficheiros
  // diretos e deixa de fora as 1423 subpastas — entre elas `timezonesets`, sem
  // a qual o `initdb` recusa criar a base ("incomplete PostgreSQL
  // installation"). Foi assim que a primeira tentativa produziu um pacote de
  // aspeto correto que não arrancava.
  const padroes = PASTAS_UTEIS.map((p) => `"pgsql/${p}/**"`).join(' ');
  execSync(`unzip -q -o "${zip}" ${padroes} -d "${temp}"`, { stdio: 'inherit' });

  fs.rmSync(destino, { recursive: true, force: true });
  fs.mkdirSync(destino, { recursive: true });
  for (const p of PASTAS_UTEIS) {
    const de = path.join(temp, 'pgsql', p);
    if (!fs.existsSync(de)) throw new Error(`O zip não trouxe pgsql/${p}`);
    fs.renameSync(de, path.join(destino, p));
  }
  fs.rmSync(temp, { recursive: true, force: true });

  // Sem o `initdb` e o `postgres` não há base local nenhuma — é melhor falhar
  // aqui do que descobrir isso na loja do cliente.
  for (const exe of ['initdb.exe', 'postgres.exe', 'pg_ctl.exe', 'pg_dump.exe']) {
    if (!fs.existsSync(path.join(destino, 'bin', exe))) {
      throw new Error(`Falta ${exe} nos binários extraídos — o zip não é o esperado.`);
    }
  }
  log(`PostgreSQL pronto: resources/pgsql (${tamanho(destino)} MB)`);
}

// ── API compilada ─────────────────────────────────────────────────────

/**
 * Põe o Prisma em condições de funcionar FORA do repositório.
 *
 * Duas coisas que o `pnpm deploy` não resolve, e cada uma delas deixava o posto
 * do lojista sem servidor local:
 *
 * 1. **O cliente gerado** (`node_modules/.prisma/client`). O `postinstall` do
 *    `@prisma/client` tenta gerá-lo na pasta nova e falha (não há esquema nem
 *    CLI ali no momento em que corre). Sem ele, a API arranca e morre no
 *    primeiro pedido à base de dados.
 * 2. **A CLI do Prisma**, que o supervisor usa para alinhar o esquema da base
 *    local. É uma dependência de desenvolvimento, logo o `--prod` deixa-a de
 *    fora — e na máquina do lojista não há npm para a ir buscar.
 */
function prepararPrisma(destino) {
  const alvoModules = path.join(destino, 'node_modules');

  // O cliente gerado vive ao lado do `@prisma/client`, na pasta real do pnpm
  // (`.../node_modules/.prisma/client`). Chega-se lá a partir do pacote, em vez
  // de adivinhar o caminho com a versão lá dentro.
  const pacoteCliente = path.dirname(
    require.resolve('@prisma/client/package.json', {
      paths: [path.join(repo, 'apps', 'api'), repo],
    }),
  );
  const geradoEm = path.resolve(pacoteCliente, '..', '..', '.prisma', 'client');
  if (!fs.existsSync(path.join(geradoEm, 'index.js'))) {
    throw new Error(`Cliente Prisma não gerado em ${geradoEm} — corra "prisma generate" primeiro.`);
  }
  const destinoGerado = path.join(alvoModules, '.prisma', 'client');
  fs.rmSync(path.join(alvoModules, '.prisma'), { recursive: true, force: true });
  fs.mkdirSync(destinoGerado, { recursive: true });
  fs.cpSync(geradoEm, destinoGerado, { recursive: true, dereference: true });

  // Sem o motor de consulta para Windows não há base de dados nenhuma.
  const motor = fs.readdirSync(destinoGerado).find((f) => /query_engine-windows.*\.node$/.test(f));
  if (!motor) {
    throw new Error('O cliente Prisma copiado não traz o motor de consulta para Windows.');
  }

  // A CLI, para o supervisor poder alinhar o esquema sem internet.
  const cliRaiz = path.dirname(
    require.resolve('prisma/package.json', { paths: [repo, path.join(repo, 'apps', 'api')] }),
  );
  const destinoCli = path.join(alvoModules, 'prisma');
  fs.rmSync(destinoCli, { recursive: true, force: true });
  fs.cpSync(cliRaiz, destinoCli, { recursive: true, dereference: true });
  if (!fs.existsSync(path.join(destinoCli, 'build', 'index.js'))) {
    throw new Error('A CLI do Prisma copiada não tem build/index.js — o supervisor não a encontraria.');
  }
  log(`Prisma pronto (cliente gerado + CLI, motor ${motor})`);
}

function prepararApi() {
  const destino = path.join(resources, 'api');

  log('A compilar a API…');
  execSync('pnpm --filter @nexus/types build', { cwd: repo, stdio: 'inherit' });
  execSync('pnpm --filter @nexus/agt-xml build', { cwd: repo, stdio: 'inherit' });
  execSync('pnpm --filter @nexus/replication build', { cwd: repo, stdio: 'inherit' });
  execSync('pnpm --filter @nexus/api exec prisma generate', { cwd: repo, stdio: 'inherit' });
  execSync('pnpm --filter @nexus/api build', { cwd: repo, stdio: 'inherit' });

  // `pnpm deploy` copia as dependências a sério, sem os atalhos (symlinks) que o
  // pnpm usa dentro do repositório. Aqueles atalhos apontam para pastas que não
  // existem na máquina do lojista — a API arrancaria e morria no primeiro
  // `require`.
  log('A reunir as dependências da API…');
  fs.rmSync(destino, { recursive: true, force: true });
  // `--ignore-scripts`: o `postinstall` do `@prisma/client` tenta gerar o
  // cliente dentro da pasta nova e falha (ainda não há lá esquema nem CLI). O
  // cliente é copiado a seguir, já gerado, por `prepararPrisma`.
  execSync(`pnpm --filter @nexus/api deploy --prod --ignore-scripts "${destino}"`, {
    cwd: repo, stdio: 'inherit',
  });

  // O `deploy` traz as dependências, não o que foi compilado nem o esquema.
  for (const p of ['dist', 'prisma']) {
    fs.cpSync(path.join(repo, 'apps', 'api', p), path.join(destino, p), { recursive: true });
  }

  prepararPrisma(destino);

  // O `deploy` copia a pasta do pacote inteira, incluindo coisas que não têm
  // nada que fazer no computador de um lojista: o código-fonte (já compilado em
  // `dist`), a configuração de testes e de Docker, e a pasta `recordings`, que é
  // onde o gravador das câmaras escreve — no repositório tem imagens de teste.
  for (const lixo of [
    'src', 'recordings', 'scripts', 'Dockerfile', 'docker-entrypoint.sh',
    'jest.config.js', 'nest-cli.json', 'tsconfig.json', 'tsconfig.build.json',
  ]) {
    fs.rmSync(path.join(destino, lixo), { recursive: true, force: true });
  }

  if (!fs.existsSync(path.join(destino, 'dist', 'main.js'))) {
    throw new Error('A API compilada não tem dist/main.js — o supervisor não a conseguiria arrancar.');
  }
  log(`API pronta: resources/api (${tamanho(destino)} MB)`);
}

prepararPostgres();
prepararApi();
process.stdout.write('\nServidor local pronto a empacotar.\n\n');
