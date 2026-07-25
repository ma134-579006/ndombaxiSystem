/**
 * Prepara os recursos da aplicação Windows.
 *
 * Compila os TRÊS frontends existentes e copia-os para dentro da app. É esta a
 * razão pela qual o requisito "nada diferente do website" se cumpre sozinho:
 * não recriámos a interface, empacotámos a mesma. Uma alteração ao site chega
 * à aplicação na compilação seguinte, sem ninguém ter de a replicar à mão —
 * e sem o risco de as duas divergirem com o tempo.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const repo = path.resolve(desktop, '..', '..');

/** API de produção. Fica gravada no bundle dos frontends. */
const API_URL = process.env.NDOMBAXI_API_URL || 'https://ndombaxi-api-img.onrender.com';

/**
 * Apenas Gestão e Caixa. A Loja Online é uma montra para o CLIENTE FINAL, que
 * lhe chega pelo navegador — não faz sentido pedir ao lojista que instale um
 * programa para ver a sua própria montra. As apps instaláveis são ferramentas
 * de trabalho: gerir e vender.
 */
const MODULES = [
  { app: 'web', target: 'gestao', label: 'Painel de Gestão' },
  { app: 'pos', target: 'caixa',  label: 'Caixa (POS)' },
];

const modulesDir = path.join(desktop, 'resources', 'modules');

function log(msg) { process.stdout.write(`  ${msg}\n`); }

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

process.stdout.write('\nNdombaxi System — a preparar os recursos da aplicação Windows\n\n');
log(`API: ${API_URL}`);

for (const mod of MODULES) {
  const appDir = path.join(repo, 'apps', mod.app);
  const dist = path.join(appDir, 'dist');
  const dest = path.join(modulesDir, mod.target);

  const skipBuild = process.env.SKIP_FRONTEND_BUILD === '1' && fs.existsSync(dist);
  if (skipBuild) {
    log(`${mod.label}: a reutilizar o build existente`);
  } else {
    log(`${mod.label}: a compilar…`);
    execSync('pnpm build', {
      cwd: appDir,
      stdio: 'inherit',
      env: { ...process.env, VITE_API_URL: API_URL },
    });
  }

  if (!fs.existsSync(dist)) {
    throw new Error(`O build de ${mod.app} não produziu dist/ — não é possível empacotar.`);
  }

  fs.rmSync(dest, { recursive: true, force: true });
  copyDir(dist, dest);
  log(`${mod.label}: copiado para resources/modules/${mod.target}`);
}

// Logótipo oficial para o ecrã de arranque e para o instalador/executável.
const logo = path.join(repo, 'apps', 'web', 'public', 'logo.png');
fs.copyFileSync(logo, path.join(modulesDir, 'launcher', 'logo.png'));

const buildDir = path.join(desktop, 'build');
fs.mkdirSync(buildDir, { recursive: true });
fs.copyFileSync(logo, path.join(buildDir, 'icon.png'));
log('Logótipo oficial aplicado (arranque, executável, instalador e atalhos)');

process.stdout.write('\nRecursos prontos.\n\n');
