/**
 * Ícones e ecrã de arranque da app LPS Kwanza (Android).
 *
 * Fonte: apps/store-shell/kwanza/icon-1024.png (carrinho branco em fundo azul — o
 * mesmo logótipo do marketplace, ver apps/store/public/kwanza-icon.svg).
 *
 *   node scripts/gen-icons-kwanza.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const shell = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(shell, '..', '..');

function loadJimp() {
  try { return require('jimp-compact'); } catch { /* layout do pnpm */ }
  const store = path.join(repo, 'node_modules', '.pnpm');
  const dir = fs.readdirSync(store).find((d) => d.startsWith('jimp-compact@'));
  if (!dir) throw new Error('jimp-compact não encontrado.');
  return require(path.join(store, dir, 'node_modules', 'jimp-compact'));
}
const Jimp = loadJimp();
const SRC = path.join(shell, 'kwanza', 'icon-1024.png');
const RES = path.join(shell, 'android', 'app', 'src', 'main', 'res');
if (!fs.existsSync(RES)) { process.stderr.write('\nSem android/. Corra primeiro: cap add android\n\n'); process.exit(1); }

/** Recorte circular (anti-aliasing de 1,5 px). */
function circle(img) {
  const s = img.bitmap.width, r = s / 2;
  img.scan(0, 0, s, s, function (x, y, idx) {
    const d = Math.hypot(x - r + 0.5, y - r + 0.5);
    if (d > r) this.bitmap.data[idx + 3] = 0;
    else if (d > r - 1.5) this.bitmap.data[idx + 3] = Math.round(this.bitmap.data[idx + 3] * (r - d) / 1.5);
  });
  return img;
}

const icon = await Jimp.read(SRC);
const S = 1024;
// Versão sem cantos (fundo azul cheio) para o recorte redondo e o adaptativo.
const bleed = new Jimp(S, S, 0x1f29d6ff);
bleed.composite(icon.clone(), 0, 0);
const round = circle(bleed.clone());
// Foreground adaptativo: o ícone dentro da zona segura (66/108 do lado).
const fg = new Jimp(S, S, 0x00000000);
const inner = icon.clone().resize(Math.round(S * 0.7), Math.round(S * 0.7), Jimp.RESIZE_BICUBIC);
fg.composite(inner, Math.round((S - inner.bitmap.width) / 2), Math.round((S - inner.bitmap.height) / 2));

for (const [dir, legacy, fgSize] of [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]]) {
  const out = path.join(RES, `mipmap-${dir}`);
  fs.mkdirSync(out, { recursive: true });
  await icon.clone().resize(legacy, legacy, Jimp.RESIZE_BICUBIC).writeAsync(path.join(out, 'ic_launcher.png'));
  await round.clone().resize(legacy, legacy, Jimp.RESIZE_BICUBIC).writeAsync(path.join(out, 'ic_launcher_round.png'));
  await fg.clone().resize(fgSize, fgSize, Jimp.RESIZE_BICUBIC).writeAsync(path.join(out, 'ic_launcher_foreground.png'));
}
fs.mkdirSync(path.join(RES, 'values'), { recursive: true });
fs.writeFileSync(path.join(RES, 'values', 'ic_launcher_background.xml'),
  '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#1F29D6</color>\n</resources>\n');

// Splash: ícone centrado em fundo branco.
for (const d of fs.readdirSync(RES).filter((n) => n.startsWith('drawable'))) {
  const file = path.join(RES, d, 'splash.png');
  if (!fs.existsSync(file)) continue;
  const cur = await Jimp.read(file);
  const { width: w, height: h } = cur.bitmap;
  const splash = new Jimp(w, h, 0xffffffff);
  const side = Math.round(Math.min(w, h) * 0.34);
  splash.composite(icon.clone().resize(side, side, Jimp.RESIZE_BICUBIC), Math.round((w - side) / 2), Math.round((h - side) / 2));
  await splash.writeAsync(file);
}
process.stdout.write('\nÍcones e arranque da LPS Kwanza gerados.\n\n');
