/**
 * Gera os ícones da app Android a partir do ÍCONE DE APLICAÇÃO do LPS Vendas.
 *
 * PORQUÊ um script: a pasta `android/` é um projeto Capacitor LOCAL (está no
 * `.gitignore`), regenerado por `cap add android` — que traria o ícone genérico
 * do Capacitor. Correr isto DEPOIS do `cap add` (ou a qualquer momento) repõe o
 * ícone do LPS Vendas em todas as densidades, mais o ícone redondo e o foreground
 * adaptativo. Fonte ÚNICA: `apps/web/public/app-icon*.png` (quadrado azul com
 * "LPS VENDAS", gerado por `apps/web/scripts/gen-app-icon.py`). O fundo
 * adaptativo (Android 8+) é o azul da marca, escrito aqui em
 * `values/ic_launcher_background.xml`.
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
// Ícone de APLICAÇÃO quadrado (apps/web/scripts/gen-app-icon.py) — o logótipo
// largo ficava um borrão no ecrã do telemóvel.
const PUB = path.join(repo, 'apps', 'web', 'public');
const ICONE = path.join(PUB, 'app-icon.png');
const FRENTE = path.join(PUB, 'app-icon-foreground.png');
// Fundo do ícone adaptativo (Android 8+): o azul do meio do gradiente do ícone.
const AZUL_FUNDO = '#1D39D4';
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

const icone = await Jimp.read(ICONE);
const frente = await Jimp.read(FRENTE);

/** O ícone recortado num círculo (ic_launcher_round). */
function redondo(size) {
  const img = icone.clone().resize(size, size, Jimp.RESIZE_BICUBIC);
  const r = size / 2;
  img.scan(0, 0, size, size, function (x, y, idx) {
    const dx = x + 0.5 - r; const dy = y + 0.5 - r;
    const dentro = Math.min(1, Math.max(0, r - Math.sqrt(dx * dx + dy * dy))); // borda suave
    this.bitmap.data[idx + 3] = Math.round(this.bitmap.data[idx + 3] * dentro);
  });
  return img;
}

for (const [dir, legacy, fg] of DENSITIES) {
  const out = path.join(RES, `mipmap-${dir}`);
  fs.mkdirSync(out, { recursive: true });
  // Ícone legado (Android 6–7): o quadrado arredondado azul com "LPS VENDAS".
  await icone.clone().resize(legacy, legacy, Jimp.RESIZE_BICUBIC).writeAsync(path.join(out, 'ic_launcher.png'));
  // Ícone redondo: o mesmo, recortado em círculo (as letras cabem no círculo).
  await redondo(legacy).writeAsync(path.join(out, 'ic_launcher_round.png'));
  // Foreground adaptativo (Android 8+): só as letras, já dentro da zona segura;
  // o fundo azul vem de ic_launcher_background (o sistema aplica a máscara).
  await frente.clone().resize(fg, fg, Jimp.RESIZE_BICUBIC).writeAsync(path.join(out, 'ic_launcher_foreground.png'));
  process.stdout.write(`  ícones ${dir}: ${legacy}px / fg ${fg}px\n`);
}
const values = path.join(RES, 'values');
fs.mkdirSync(values, { recursive: true });
fs.writeFileSync(path.join(values, 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${AZUL_FUNDO}</color>\n</resources>\n`);
process.stdout.write('\nÍcones do LPS Vendas gerados. Recompile a app para os ver.\n\n');
