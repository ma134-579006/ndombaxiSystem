/**
 * Prepara `www` da app LPS Loja: compila a montra (apps/store) com base RELATIVA
 * e a API de produção embutida. Recusa empacotar um build que aponte para
 * localhost (a app abriria "sem ligação ao servidor").
 *
 *   NDOMBAXI_API_URL=https://… node scripts/prepare-web.mjs
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shell = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(shell, '..', '..');
const API_URL = process.env.NDOMBAXI_API_URL || 'https://ndombaxi-api-3nmz.onrender.com';
const VERSION = JSON.parse(fs.readFileSync(path.join(repo, 'apps', 'desktop', 'package.json'), 'utf-8')).version;
const www = path.join(shell, 'www');
const log = (m) => process.stdout.write(`  ${m}\n`);

process.stdout.write('\nLPS Loja — a preparar a pasta www\n\n');
log(`API: ${API_URL} · versão ${VERSION}`);
fs.rmSync(www, { recursive: true, force: true });
execSync(`pnpm --filter @nexus/store exec vite build --base=./ --outDir "${www}" --emptyOutDir`, {
  cwd: repo,
  stdio: 'inherit',
  env: { ...process.env, VITE_API_URL: API_URL, VITE_NATIVE_APP: '1', VITE_APP_VERSION: VERSION },
});

if (!/localhost/.test(API_URL)) {
  const bad = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js') && fs.readFileSync(p, 'utf8').includes('http://localhost:3000')) bad.push(e.name);
    }
  };
  walk(www);
  if (bad.length) throw new Error(`O build aponta para http://localhost:3000 (VITE_API_URL não injetado): ${bad.join(', ')}`);
}
log('www pronta.');
