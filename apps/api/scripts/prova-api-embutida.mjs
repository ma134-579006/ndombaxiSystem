/**
 * PASSO 6 do Android independente: a API INTEIRA a correr sobre a base do
 * próprio aparelho.
 *
 * O passo 5 provou o Prisma a falar com o PGlite. Isso ainda é uma biblioteca a
 * falar com outra. O que o utilizador pediu é diferente: "as MESMAS
 * funcionalidades do desktop, 100% offline" — ou seja, o NestJS com os seus
 * módulos, guardas, validações e rotas a responder a pedidos HTTP REAIS sem
 * existir servidor de base de dados nenhum.
 *
 * É isso que se exerce aqui: arranca-se o `dist/main.js` COMPILADO (o mesmo
 * ficheiro que a nuvem corre), apenas com duas variáveis de ambiente
 * diferentes, e fazem-se pedidos por HTTP.
 *
 * Como correr:  pnpm --filter @nexus/api prova:api-embutida
 * (precisa de `nest build` feito antes — o script trata disso.)
 */
import { PGlite } from '@electric-sql/pglite';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.join(aqui, '..');
const PORTA = 3987;
const RAIZ = `http://127.0.0.1:${PORTA}/api/v1`;

const r = [];
const check = (n, c, e) => r.push([c ? 'OK  ' : 'FALHA', n + (e ? ` — ${e}` : '')]);
const dormir = (ms) => new Promise((res) => setTimeout(res, ms));

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-api-embutida-'));
let api = null;
const registo = [];

try {
  // ── 1. A base do aparelho, criada do zero ───────────────────────────
  const ddl = execSync(
    'npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script',
    { cwd: apiDir, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const db = await PGlite.create({ dataDir: pasta });
  await db.exec(ddl);
  await db.query(
    `INSERT INTO nexus_public.plans
       (id, tier, name, "priceKz", "maxStores", "maxUsers", "maxProducts", "maxTxPerMonth", modules, "isPublic", "updatedAt")
     VALUES (gen_random_uuid(), 'STARTER', 'Plano do Aparelho', 25000, 1, 3, 500, 5000, ARRAY['POS'], TRUE, now())`,
  );
  await db.close(); // a app fecha a base antes de a API a abrir
  check('base do aparelho criada numa PASTA (sem servidor)', fs.existsSync(path.join(pasta, 'PG_VERSION')));

  // ── 2. A MESMA API compilada, com outro motor ───────────────────────
  execSync('npx nest build', { cwd: apiDir, stdio: 'ignore' });
  api = spawn(process.execPath, ['dist/main.js'], {
    cwd: apiDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(PORTA),
      DATABASE_ENGINE: 'pglite',
      PGLITE_DATA_DIR: pasta,
      DATABASE_URL: '', // de propósito VAZIO: no telemóvel não há endereço nenhum
      JWT_ACCESS_SECRET: 'a'.repeat(48),
      JWT_REFRESH_SECRET: 'b'.repeat(48),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.on('data', (d) => registo.push(String(d)));
  api.stderr.on('data', (d) => registo.push(String(d)));

  // ── 3. Esperar que atenda ───────────────────────────────────────────
  let saude = null;
  for (let i = 0; i < 60 && !saude; i++) {
    await dormir(1000);
    if (api.exitCode !== null) break;
    saude = await fetch(`${RAIZ}/health`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  }
  check('a API ARRANCOU sem base de dados externa', !!saude, saude ? undefined : registo.join('').split('\n').filter(Boolean).pop()?.slice(0, 180));
  if (!saude) throw new Error('a API não atendeu');

  const texto = registo.join('');
  check('o registo diz que o motor é EMBUTIDO', /PGlite EM PROCESSO|Motor EMBUTIDO/.test(texto));

  // ── 4. Pedidos HTTP a sério, a ler da base do aparelho ──────────────
  const planos = await fetch(`${RAIZ}/public/plans`).then((x) => x.json());
  const lista = Array.isArray(planos) ? planos : (planos.plans ?? planos.data ?? []);
  check('GET /public/plans responde com o que está gravado NO APARELHO',
    lista.some?.((p) => p.name === 'Plano do Aparelho'), JSON.stringify(lista).slice(0, 120));

  // A landing pública faz mais do que uma consulta — exercita o caminho normal.
  const landing = await fetch(`${RAIZ}/public/landing`);
  check('GET /public/landing (a página inicial inteira) responde 200', landing.status === 200, `estado ${landing.status}`);

  // As guardas continuam a guardar: sem sessão, nada de dados de empresa.
  const protegido = await fetch(`${RAIZ}/auth/me/preferences`);
  check('rota protegida continua a recusar sem sessão (401)', protegido.status === 401, `estado ${protegido.status}`);

  // Uma ESCRITA pelo caminho normal: login errado tem de ser recusado pela
  // base do aparelho, não por falta de ligação.
  const login = await fetch(`${RAIZ}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ninguem@exemplo.ao', password: 'senha-errada-mas-comprida' }),
  });
  check('POST /auth/login consulta a base e recusa (401)', login.status === 401, `estado ${login.status}`);

  // ── 5. O que ficou gravado sobrevive à app fechar ───────────────────
  api.kill();
  await dormir(2000);
  const db2 = await PGlite.create({ dataDir: pasta });
  const n = await db2.query('SELECT count(*)::int AS n FROM nexus_public.plans');
  await db2.close();
  check('a base continua lá depois de a API fechar', Number(n.rows[0].n) === 1);
} catch (e) {
  check('erro inesperado', false, (e.message || String(e)).slice(0, 200));
} finally {
  if (api && api.exitCode === null) api.kill('SIGKILL');
  await dormir(500);
  try { fs.rmSync(pasta, { recursive: true, force: true }); } catch { /* Windows segura ficheiros */ }
}

for (const [e, n] of r) console.log(e, n);
const falhas = r.filter(([e]) => e !== 'OK  ').length;
console.log(`\n${r.length - falhas}/${r.length}`);
process.exit(falhas ? 1 : 0);
