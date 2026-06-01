#!/usr/bin/env node
/**
 * Ndombaxi System — ligar a base de dados na NUVEM (Aiven / Neon / Supabase).
 *
 * Objetivo: base de dados online 24/7 com o MÍNIMO de esforço humano. O único
 * passo que ninguém pode automatizar por si é criar a conta e copiar a
 * connection string (exige o seu login). Tudo o resto é automático:
 *   1) cola a connection string (postgres://...);
 *   2) este script valida-a, normaliza (?sslmode=require), escreve-a no .env,
 *      TESTA a ligação real, e corre db:push + db:seed.
 *
 * Uso:
 *   pnpm db:cloud "postgres://user:pass@host:5432/db?sslmode=require"
 *   (ou)  pnpm db:cloud   → pergunta interativamente.
 *
 * Aiven (grátis, 24/7, não adormece):
 *   https://console.aiven.io → Create service → PostgreSQL → Free plan →
 *   copie a "Service URI".
 * Neon (alternativa grátis):
 *   https://neon.tech → New Project → copie a connection string.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = join(ROOT, 'apps', 'api', '.env');
const EXAMPLE_PATH = join(ROOT, 'apps', 'api', '.env.example');

const c = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m' };
const ok = (m) => console.log(`${c.green}✓${c.reset} ${m}`);
const err = (m) => console.log(`${c.red}✗${c.reset} ${m}`);
const info = (m) => console.log(`${c.cyan}•${c.reset} ${m}`);

/** Remove aspas/espaços de fora (comum ao copiar da consola da Aiven/Neon). */
function unquote(s) {
  return s.trim().replace(/^["']|["']$/g, '').trim();
}

/** Aceita postgres:// e postgresql://, com ou sem parâmetros (já sem aspas). */
function looksLikePostgresUrl(s) {
  return /^postgres(ql)?:\/\/[^\s]+@[^\s]+\/[^\s?]+/.test(unquote(s));
}

/** Garante sslmode=require (Aiven/Neon exigem TLS) e schema=nexus_public. */
function normalizeUrl(raw) {
  const u = unquote(raw);
  // separa query
  const [base, queryRaw = ''] = u.split('?');
  const params = new URLSearchParams(queryRaw);
  if (!params.has('sslmode')) params.set('sslmode', 'require');
  if (!params.has('schema')) params.set('schema', 'nexus_public');
  return `${base}?${params.toString()}`;
}

/** Atualiza (ou cria) a linha DATABASE_URL no .env, preservando o resto. */
function writeEnv(url) {
  let txt;
  if (existsSync(ENV_PATH)) {
    txt = readFileSync(ENV_PATH, 'utf8');
  } else if (existsSync(EXAMPLE_PATH)) {
    txt = readFileSync(EXAMPLE_PATH, 'utf8');
    info('.env não existia — criado a partir de .env.example.');
  } else {
    txt = 'NODE_ENV=production\nPORT=3000\nAPI_PREFIX=\n';
  }
  // Backup defensivo antes de escrever.
  if (existsSync(ENV_PATH)) {
    try { copyFileSync(ENV_PATH, ENV_PATH + '.bak'); } catch { /* best-effort */ }
  }
  const line = `DATABASE_URL=${url}`;
  if (/^DATABASE_URL\s*=.*$/m.test(txt)) {
    txt = txt.replace(/^DATABASE_URL\s*=.*$/m, line);
  } else {
    txt += (txt.endsWith('\n') ? '' : '\n') + line + '\n';
  }
  writeFileSync(ENV_PATH, txt, 'utf8');
}

function run(args, label) {
  info(label);
  const res = spawnSync('pnpm', args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  return (res.status ?? 1) === 0;
}

async function main() {
  console.log('');
  console.log(`${c.bold}Ligar base de dados na NUVEM (24/7)${c.reset}`);
  console.log(`${c.dim}Aiven: https://console.aiven.io  ·  Neon: https://neon.tech${c.reset}`);
  console.log('');

  let url = process.argv[2];
  if (!url) {
    const rl = createInterface({ input: stdin, output: stdout });
    url = await rl.question(`Cole aqui a connection string (postgres://...):\n> `);
    rl.close();
  }

  if (!looksLikePostgresUrl(url)) {
    err('Isso não parece uma connection string PostgreSQL válida.');
    console.log(`${c.dim}Exemplo: postgres://avnadmin:senha@pg-xxx.aivencloud.com:5432/defaultdb?sslmode=require${c.reset}`);
    process.exit(1);
  }

  const normalized = normalizeUrl(url);
  writeEnv(normalized);
  ok('Connection string guardada em apps/api/.env (com sslmode=require).');

  // Testa a ligação real fazendo o push do schema (cria/atualiza tabelas).
  if (!run(['db:push'], 'A testar a ligação e a preparar o esquema…')) {
    err('Não consegui ligar/preparar a base de dados. Verifique a string e a rede.');
    console.log(`${c.dim}A string anterior foi guardada em apps/api/.env.bak${c.reset}`);
    process.exit(1);
  }
  ok('Esquema criado/atualizado na nuvem.');

  run(['db:seed'], 'A semear dados iniciais (Super Admin + planos)…');
  ok('Base de dados na nuvem pronta e 24/7.');
  console.log('');
  console.log(`Agora arranque tudo com:  ${c.cyan}pnpm start${c.reset}  (ou duplo-clique no INICIAR.bat)`);
  console.log('');
}

main().catch((e) => { err(String(e?.stack || e)); process.exit(1); });
