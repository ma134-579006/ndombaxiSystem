/**
 * Versão ÚNICA e crescente para cada build publicada pelo CI.
 *
 * REGRA PERMANENTE: cada app publicada bloqueia as versões anteriores. Para
 * isso, cada build tem de ter uma versão MAIOR do que a anterior — mesmo sem
 * ninguém mexer no package.json. A versão passa a ser:
 *
 *     <maior>.<menor>.<nº de commits em main>     ex.: 1.5.612
 *
 * `maior.menor` vêm de apps/desktop/package.json (decisão humana); o terceiro
 * número cresce sozinho a cada commit e é igual nas três apps para o mesmo
 * commit. Escreve-a nos package.json (desktop e loja) e em $GITHUB_ENV
 * (APP_VERSION), para as notas da release ("Versão: X") que o servidor lê.
 *
 *   node scripts/ci-version.mjs        (precisa de clone completo: fetch-depth 0)
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sh = (c) => execSync(c, { cwd: repo, encoding: 'utf-8' }).trim();

if (sh('git rev-parse --is-shallow-repository') === 'true') {
  console.error('ci-version: clone raso — use actions/checkout com fetch-depth: 0.');
  process.exit(1);
}
const count = Number(sh('git rev-list --count HEAD'));
const files = ['apps/desktop/package.json', 'apps/store-shell/package.json'];
const base = JSON.parse(fs.readFileSync(path.join(repo, files[0]), 'utf-8')).version;
const m = /^(\d+)\.(\d+)\./.exec(base);
if (!m || !Number.isFinite(count) || count < 1) { console.error(`ci-version: versão base inválida (${base}) ou contagem (${count}).`); process.exit(1); }
const version = `${m[1]}.${m[2]}.${count}`;
for (const f of files) {
  const p = path.join(repo, f);
  const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
  j.version = version;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
}
if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, `APP_VERSION=${version}\n`);
console.log(`Versão desta build: ${version} (base ${base}, ${count} commits)`);
