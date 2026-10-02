/**
 * Gera os ícones da app Android a partir do logótipo oficial do LPS Vendas.
 *
 * PORQUÊ um script: a pasta `android/` é um projeto Capacitor LOCAL (está no
 * `.gitignore`), regenerado por `cap add android` — que traria o ícone genérico
 * do Capacitor. Correr isto DEPOIS do `cap add` (ou a qualquer momento) repõe o
 * ícone do LPS Vendas em todas as densidades, mais o ícone redondo e o foreground
 * adaptativo. Fonte ÚNICA: `apps/web/public/logo.png` — o logótipo da landing,
 * sem fundo. O fundo adaptativo (branco, obrigatório nos ícones adaptativos do
 * Android 8+) é escrito aqui em `values/ic_launcher_background.xml`.
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

// Logótipo centrado num canvas transparente com margem (fração de cada lado).
function padded(size, margin) {
  const inner = Math.round(size * (1 - 2 * margin));
  const logo = base.clone().resize(inner, inner);
  const off = Math.round((size - inner) / 2);
  return new Jimp(size, size, 0x00000000).composite(logo, off, off);
}

for (const [dir, legacy, fg] of DENSITIES) {
  const out = path.join(RES, `mipmap-${dir}`);
  fs.mkdirSync(out, { recursive: true });
  // Ícone legado (Android 6–7) — o logótipo sem fundo, como na landing.
  await padded(legacy, 0).writeAsync(path.join(out, 'ic_launcher.png'));
  // Ícone redondo — o mesmo logótipo, sem máscara (recortar cortaria o "Vendas").
  await padded(legacy, 0.04).writeAsync(path.join(out, 'ic_launcher_round.png'));
  // Foreground adaptativo (Android 8+) — o logótipo dentro da zona segura
  // (66 de 108 dp), para a máscara do sistema não o cortar.
  await padded(fg, 0.12).writeAsync(path.join(out, 'ic_launcher_foreground.png'));
  process.stdout.write(`  ícones ${dir}: ${legacy}px / fg ${fg}px\n`);
}
const values = path.join(RES, 'values');
fs.mkdirSync(values, { recursive: true });
fs.writeFileSync(path.join(values, 'ic_launcher_background.xml'),
  '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#FFFFFF</color>\n</resources>\n');
process.stdout.write('\nÍcones do LPS Vendas gerados. Recompile a app para os ver.\n\n');
