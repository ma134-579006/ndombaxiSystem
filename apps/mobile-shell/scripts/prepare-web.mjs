/**
 * Prepara a pasta `www` das apps móveis.
 *
 * Compila os MESMOS frontends do site (Gestão e Caixa) com base RELATIVA e
 * junta-os sob `www/gestao` e `www/caixa`, com um pequeno lançador em
 * `www/index.html`. É a razão de a app móvel ser idêntica ao site — é a mesma
 * interface embrulhada, não uma recriação.
 *
 * Porquê base relativa (`--base=./`): os frontends são compilados com caminhos
 * ABSOLUTOS por omissão (`/assets/…`). Servidos pela WebView do Capacitor a
 * partir de subpastas, esses caminhos apontariam para a raiz e nada carregava.
 * Com base relativa, cada módulo carrega os seus próprios assets.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shell = path.resolve(here, '..');
const repo = path.resolve(shell, '..', '..');

const API_URL = process.env.NDOMBAXI_API_URL || 'https://ndombaxi-api-img.onrender.com';

const MODULES = [
  { app: 'web', target: 'gestao', label: 'Painel de Gestão' },
  { app: 'pos', target: 'caixa', label: 'Caixa (POS)' },
];

const www = path.join(shell, 'www');

function log(m) { process.stdout.write(`  ${m}\n`); }
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name);
    const d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

process.stdout.write('\nNdombaxi System — a preparar a pasta www das apps móveis\n\n');
log(`API: ${API_URL}`);

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });

for (const mod of MODULES) {
  const appDir = path.join(repo, 'apps', mod.app);
  log(`${mod.label}: a compilar (base relativa)…`);
  execSync('pnpm exec vite build --base=./', {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, VITE_API_URL: API_URL },
  });
  const dist = path.join(appDir, 'dist');
  if (!fs.existsSync(dist)) throw new Error(`O build de ${mod.app} não produziu dist/.`);
  copyDir(dist, path.join(www, mod.target));

  // Seta de VOLTAR ao lançador (só nas apps): copia o script para dentro do
  // módulo e injeta-o no index.html. Vive no shell, não nos frontends — por isso
  // é aqui, no empacotamento móvel, e não no build do site. O botão esconde-se
  // sozinho quando há sessão (ver back-launcher.js).
  const backSrc = path.join(shell, 'launcher', 'back-launcher.js');
  if (fs.existsSync(backSrc)) {
    fs.copyFileSync(backSrc, path.join(www, mod.target, 'back-launcher.js'));
    const idxPath = path.join(www, mod.target, 'index.html');
    let html = fs.readFileSync(idxPath, 'utf8');
    if (!html.includes('back-launcher.js')) {
      html = html.replace('</body>', '  <script src="./back-launcher.js"></script>\n</body>');
      fs.writeFileSync(idxPath, html);
    }
  }
  log(`${mod.label}: copiado para www/${mod.target}`);
}

// Lançador + logótipo oficial.
copyDir(path.join(shell, 'launcher'), www);
fs.copyFileSync(
  path.join(repo, 'apps', 'web', 'public', 'logo.png'),
  path.join(www, 'logo.png'),
);
log('Lançador e logótipo copiados para www/');

process.stdout.write('\nwww pronto. Agora: pnpm --filter @nexus/mobile-shell sync\n\n');
