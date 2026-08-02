/**
 * Gera os ícones da app Android a partir do logótipo oficial do Ndombaxi.
 *
 * PORQUÊ um script: a pasta `android/` é um projeto Capacitor LOCAL (está no
 * `.gitignore`), regenerado por `cap add android` — que traria o ícone genérico
 * do Capacitor. Correr isto DEPOIS do `cap add` (ou a qualquer momento) repõe o
 * ícone do Ndombaxi em todas as densidades, mais o ícone redondo e o foreground
 * adaptativo. O fundo adaptativo (navy) está em
 * `android/app/src/main/res/values/ic_launcher_background.xml`.
 *
 *   node scripts/gen-android-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const shell = path.resolve(here, '..');
const repo = path.resolve(shell, '..', '..');

// Resolve o jimp-compact (redimensionador JS puro) tolerando o layout do pnpm.
function loadJimp() {
  try { return require('jimp-compact'); } catch { /* tenta a store do pnpm */ }
  const store = path.join(repo, 'node_modules', '.pnpm');
  const dir = fs.readdirSync(store).find((d) => d.startsWith('jimp-compact@'));
  if (!dir) throw new Error('jimp-compact não encontrado (instale-o ou ajuste o caminho).');
  return require(path.join(store, dir, 'node_modules', 'jimp-compact'));
}

const Jimp = loadJimp();
const LOGO = path.join(repo, 'apps', 'web', 'public', 'logo.png');
const RES = path.join(shell, 'android', 'app', 'src', 'main', 'res');

// [pasta densidade, tamanho legado px, tamanho foreground adaptativo px (108dp)]
const DENSITIES = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
];

if (!fs.existsSync(RES)) {
  process.stderr.write(`\nSem ${RES}. Corra primeiro: pnpm --filter @nexus/mobile-shell add:android\n\n`);
  process.exit(1);
}

const base = await Jimp.read(LOGO);
for (const [dir, legacy, fg] of DENSITIES) {
  const out = path.join(RES, `mipmap-${dir}`);
  fs.mkdirSync(out, { recursive: true });
  // Ícone legado (quadrado) — o logótipo já é um ícone completo.
  await base.clone().resize(legacy, legacy).writeAsync(path.join(out, 'ic_launcher.png'));
  // Ícone redondo — o mesmo, com máscara circular.
  await base.clone().resize(legacy, legacy).circle().writeAsync(path.join(out, 'ic_launcher_round.png'));
  // Foreground adaptativo — o logótipo a preencher o canvas; o navy do
  // ic_launcher_background preenche por trás e a máscara do sistema recorta.
  await base.clone().resize(fg, fg).writeAsync(path.join(out, 'ic_launcher_foreground.png'));
  process.stdout.write(`  ícones ${dir}: ${legacy}px / fg ${fg}px\n`);
}
process.stdout.write('\nÍcones do Ndombaxi gerados. Recompile a app para os ver.\n\n');
