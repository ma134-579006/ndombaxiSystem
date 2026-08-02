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

/**
 * Barreira anti-regressão do "Sem ligação ao servidor": um build feito sem
 * VITE_API_URL fica a apontar para `http://localhost:3000` (default do frontend),
 * inalcançável na máquina do cliente. Quando a API é a de produção, o minificador
 * do Vite ELIMINA o fallback — logo a presença dessa string no `dist` prova que o
 * build está errado. Recusamos empacotá-lo em vez de enviar uma app que não liga.
 */
function assertApiBaked(dir, label) {
  if (/localhost/.test(API_URL)) return; // build local intencional — não há o que validar
  const offenders = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.js') && fs.readFileSync(p, 'utf8').includes('http://localhost:3000')) {
        offenders.push(path.relative(dir, p));
      }
    }
  };
  walk(dir);
  if (offenders.length) {
    throw new Error(
      `${label}: o build aponta para http://localhost:3000 (VITE_API_URL não foi injetado).\n`
      + `  API esperada: ${API_URL}\n`
      + `  Ficheiros:    ${offenders.slice(0, 3).join(', ')}${offenders.length > 3 ? '…' : ''}\n`
      + `  Corrija o build (não usar SKIP_FRONTEND_BUILD com um dist antigo) e repita.`,
    );
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
  assertApiBaked(dest, mod.label); // NÃO empacotar um build que aponta para localhost
  log(`${mod.label}: copiado para resources/modules/${mod.target}`);
}

// Logótipo oficial para o ecrã de arranque e para o instalador/executável.
const logo = path.join(repo, 'apps', 'web', 'public', 'logo.png');
fs.copyFileSync(logo, path.join(modulesDir, 'launcher', 'logo.png'));

const buildDir = path.join(desktop, 'build');
fs.mkdirSync(buildDir, { recursive: true });
fs.copyFileSync(logo, path.join(buildDir, 'icon.png'));

// Ícone Windows NÍTIDO (.ico 16→256px). Gerar cada tamanho à parte evita o
// monograma fusco a 16/32px que a conversão automática de um único PNG deixava
// — o electron-builder passa a usar este .ico no executável, no título e no
// instalador (uma só fonte: o logótipo oficial).
execSync('node scripts/gen-win-icon.mjs', { cwd: desktop, stdio: 'inherit' });
log('Logótipo oficial aplicado (arranque, executável, instalador e atalhos)');

process.stdout.write('\nRecursos prontos.\n\n');
