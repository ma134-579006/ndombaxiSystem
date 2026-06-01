#!/usr/bin/env node
/**
 * Ndombaxi System — arranque INTELIGENTE e automático (zero-config).
 *
 * Deteta sozinho o melhor caminho para a base de dados, SEM perguntar nada:
 *   1) Se já houver DATABASE_URL remoto no .env (Aiven/Neon/Supabase) → usa-o
 *      (base de dados na nuvem, 24/7).
 *   2) Senão, se houver Docker → sobe o Postgres local automaticamente.
 *   3) Senão → não bloqueia: explica em uma linha o único passo que falta
 *      (instalar Docker OU ligar uma BD na nuvem com `pnpm db:cloud`).
 *
 * Em qualquer caso onde haja BD, faz install + db:push + db:seed e arranca a
 * API + as 3 apps web — tudo sozinho.
 *
 * Não tem dependências externas: só Node + ferramentas já presentes (pnpm,
 * docker se existir). Funciona em Windows, macOS e Linux.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = join(ROOT, 'apps', 'api', '.env');
const COMPOSE = join(ROOT, 'infra', 'docker', 'docker-compose.yml');

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', blue: '\x1b[34m',
};
const log = (m) => process.stdout.write(m + '\n');
const ok = (m) => log(`${c.green}✓${c.reset} ${m}`);
const info = (m) => log(`${c.cyan}•${c.reset} ${m}`);
const warn = (m) => log(`${c.yellow}!${c.reset} ${m}`);
const err = (m) => log(`${c.red}✗${c.reset} ${m}`);

function banner() {
  log('');
  log(`${c.bold}${c.blue}============================================================${c.reset}`);
  log(`${c.bold}   NDOMBAXI SYSTEM — arranque automático${c.reset}`);
  log(`${c.dim}   por Manuel Mbala Tomás Ndombaxi${c.reset}`);
  log(`${c.bold}${c.blue}============================================================${c.reset}`);
  log('');
}

/** Corre um comando e devolve {code, stdout}. Silencioso por omissão. */
function run(cmd, args, { inherit = false, env } = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: inherit ? 'inherit' : 'pipe',
    encoding: 'utf8',
    shell: process.platform === 'win32', // resolve .cmd no Windows
    env: { ...process.env, ...env },
  });
  return { code: res.status ?? 1, stdout: (res.stdout || '') + (res.stderr || '') };
}

function has(cmd) {
  const probe = process.platform === 'win32' ? ['--version'] : ['--version'];
  try {
    return run(cmd, probe).code === 0;
  } catch {
    return false;
  }
}

/** Lê DATABASE_URL do .env (se existir). */
function readDatabaseUrl() {
  if (!existsSync(ENV_PATH)) return null;
  const txt = readFileSync(ENV_PATH, 'utf8');
  const m = txt.match(/^DATABASE_URL\s*=\s*(.+)$/m);
  if (!m) return null;
  return m[1].trim().replace(/^["']|["']$/g, '');
}

/** Classifica a connection string: 'cloud' | 'localdocker' | null. */
function classifyDb(url) {
  if (!url) return null;
  // localhost/127.0.0.1 → BD local (precisa de Docker a correr);
  // qualquer outro host → BD na nuvem (24/7).
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(url)) return 'localdocker';
  return 'cloud';
}

function dockerRunning() {
  if (!has('docker')) return false;
  return run('docker', ['info']).code === 0;
}

async function main() {
  banner();

  // Pré-requisito mínimo: pnpm.
  if (!has('pnpm')) {
    err('pnpm não encontrado. Instale o Node.js 20+ (https://nodejs.org) e depois: npm i -g pnpm');
    process.exit(1);
  }

  const dbUrl = readDatabaseUrl();
  const kind = classifyDb(dbUrl);
  let dbReady = false;

  if (kind === 'cloud') {
    ok('Base de dados na NUVEM detectada (24/7). A usar a ligação do .env.');
    dbReady = true;
  } else if (kind === 'localdocker') {
    info('Base de dados LOCAL configurada (.env aponta para localhost).');
    if (dockerRunning()) {
      info('A subir o Postgres local com Docker…');
      const up = run('docker', ['compose', '-f', COMPOSE, 'up', '-d', 'postgres', 'redis'], { inherit: true });
      if (up.code === 0) {
        // Espera o Postgres ficar pronto (até ~40s).
        process.stdout.write('   a aguardar a base de dados');
        for (let i = 0; i < 20; i++) {
          const ping = run('docker', ['exec', 'nexus_postgres', 'pg_isready', '-U', 'nexus', '-d', 'nexus_erp']);
          if (ping.code === 0) { dbReady = true; break; }
          process.stdout.write('.');
          await new Promise((r) => setTimeout(r, 2000));
        }
        log('');
        if (dbReady) ok('Postgres local pronto.');
      } else {
        err('Falha ao subir o Docker.');
      }
    } else {
      warn('Docker não está a correr — não consigo subir a base de dados local.');
    }
  } else {
    warn('Sem DATABASE_URL configurado.');
  }

  if (!dbReady) {
    log('');
    log(`${c.bold}Falta UM passo (só uma vez) para a base de dados:${c.reset}`);
    log('');
    log(`  ${c.bold}Opção A — Base de dados na NUVEM (recomendado, 24/7, grátis):${c.reset}`);
    log(`     ${c.cyan}pnpm db:cloud${c.reset}   ${c.dim}← cola a connection string da Aiven/Neon e o resto é automático${c.reset}`);
    log('');
    log(`  ${c.bold}Opção B — Base de dados LOCAL:${c.reset}`);
    log(`     Instale o Docker Desktop (${c.cyan}https://www.docker.com/products/docker-desktop/${c.reset}),`);
    log(`     abra-o, e corra de novo este arranque.`);
    log('');
    log(`${c.dim}As aplicações precisam de uma base de dados para funcionar. Escolha A ou B acima.${c.reset}`);
    process.exit(2);
  }

  // BD pronta → install + schema + seed (idempotentes).
  info('A instalar dependências (rápido se já instaladas)…');
  run('pnpm', ['install'], { inherit: true });

  info('A preparar o esquema da base de dados…');
  const push = run('pnpm', ['db:push'], { inherit: true });
  if (push.code !== 0) {
    err('Falha ao criar o esquema. Verifique a ligação à base de dados.');
    process.exit(1);
  }

  info('A semear dados iniciais (Super Admin + planos)…');
  run('pnpm', ['db:seed'], { inherit: true });

  // Compila a API de forma determinística (build limpo → node dist/main.js).
  // Importante: o `nest start --watch` tinha uma condição de corrida em
  // arranques frios (corria `node dist/main` antes do 1.º emit do tsc). O
  // modo produção é fiável e arranca mais depressa a servir.
  info('A compilar a API…');
  const apiBuild = run('pnpm', ['api:build'], { inherit: true });
  const mainJs = join(ROOT, 'apps', 'api', 'dist', 'main.js');
  if (apiBuild.code !== 0 || !existsSync(mainJs)) {
    err('Falha a compilar a API (dist/main.js não foi gerado).');
    process.exit(1);
  }

  ok('Tudo pronto! A iniciar a API e as aplicações…');
  log('');

  // Arranca cada serviço num processo próprio (não bloqueia).
  const spawnApp = (name, cmd, args, opts = {}) => {
    const p = spawn(cmd, args, {
      cwd: opts.cwd ?? ROOT, stdio: 'inherit', shell: process.platform === 'win32', detached: false,
    });
    p.on('error', (e) => err(`${name}: ${e.message}`));
    return p;
  };
  // API em modo produção (determinístico) a partir do dist já compilado.
  spawnApp('API', 'node', ['dist/main.js'], { cwd: join(ROOT, 'apps', 'api') });
  spawnApp('Caixa', 'pnpm', ['--filter', '@nexus/pos', 'dev']);
  spawnApp('Loja', 'pnpm', ['--filter', '@nexus/store', 'dev']);
  spawnApp('Admin', 'pnpm', ['--filter', '@nexus/web', 'dev']);

  log('');
  log(`${c.green}${c.bold}  Endereços (abrem em segundos):${c.reset}`);
  log(`    API / Servidor : ${c.cyan}http://localhost:3000${c.reset}`);
  log(`    Caixa (POS)    : ${c.cyan}http://localhost:5173${c.reset}`);
  log(`    Loja online    : ${c.cyan}http://localhost:5174${c.reset}`);
  log(`    Painel Admin   : ${c.cyan}http://localhost:5175${c.reset}`);
  log('');
  log(`  Super Admin:  ${c.bold}admin@ndombaxi.ao${c.reset}  /  ${c.bold}Ndombaxi!Admin2026${c.reset}`);
  log('');
}

main().catch((e) => { err(String(e?.stack || e)); process.exit(1); });
