/**
 * Ícones e ecrã de arranque da app LPS Loja.
 *
 * Identidade própria (distingue-se da app de gestão no telemóvel do cliente):
 * fundo índigo da marca (#2430E8 → #131A66) com o logótipo oficial num disco
 * branco. Fonte: apps/web/public/app-icon-foreground.png (logótipo oficial já
 * recortado). Gera ícone legado, redondo, foreground adaptativo + fundo índigo,
 * e os splash.png de todas as densidades.
 *
 *   node scripts/gen-icons.mjs
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
const LOGO = path.join(repo, 'apps', 'web', 'public', 'app-icon-foreground.png');
const RES = path.join(shell, 'android', 'app', 'src', 'main', 'res');
const OUT_PREVIEW = process.env.ICON_PREVIEW_DIR; // opcional: grava as imagens-base para ver

const TOP = [0x24, 0x30, 0xe8];
const BOTTOM = [0x13, 0x1a, 0x66];

/** Fundo índigo em degradê diagonal. */
function gradient(size) {
  const img = new Jimp(size, size, 0x00000000);
  img.scan(0, 0, size, size, function (x, y, idx) {
    const t = (x + y) / (2 * (size - 1));
    this.bitmap.data[idx] = Math.round(TOP[0] + (BOTTOM[0] - TOP[0]) * t);
    this.bitmap.data[idx + 1] = Math.round(TOP[1] + (BOTTOM[1] - TOP[1]) * t);
    this.bitmap.data[idx + 2] = Math.round(TOP[2] + (BOTTOM[2] - TOP[2]) * t);
    this.bitmap.data[idx + 3] = 255;
  });
  return img;
}

/** Máscara: quadrado de cantos arredondados (r) ou círculo (r = size/2). */
function mask(img, r) {
  const s = img.bitmap.width;
  img.scan(0, 0, s, s, function (x, y, idx) {
    const cx = Math.min(Math.max(x, r), s - 1 - r);
    const cy = Math.min(Math.max(y, r), s - 1 - r);
    const d = Math.hypot(x - cx, y - cy);
    if (d > r) this.bitmap.data[idx + 3] = 0;
    else if (d > r - 1.5) this.bitmap.data[idx + 3] = Math.round(this.bitmap.data[idx + 3] * (r - d) / 1.5);
  });
  return img;
}

/** Disco branco com sombra suave e o logótipo dentro. */
async function disc(size, logo) {
  const d = new Jimp(size, size, 0x00000000);
  const r = size / 2;
  d.scan(0, 0, size, size, function (x, y, idx) {
    const dist = Math.hypot(x - r + 0.5, y - r + 0.5);
    if (dist <= r - 1) { this.bitmap.data[idx] = 255; this.bitmap.data[idx + 1] = 255; this.bitmap.data[idx + 2] = 255; this.bitmap.data[idx + 3] = 255; }
    else if (dist <= r) { this.bitmap.data[idx] = 255; this.bitmap.data[idx + 1] = 255; this.bitmap.data[idx + 2] = 255; this.bitmap.data[idx + 3] = Math.round(255 * (r - dist)); }
  });
  // Logótipo recortado (sem margens) a ocupar ~80% da largura do disco.
  const l = logo.clone().resize(Math.round(size * 0.8), Jimp.AUTO, Jimp.RESIZE_BICUBIC);
  d.composite(l, Math.round((size - l.bitmap.width) / 2), Math.round((size - l.bitmap.height) / 2));
  return d;
}

const logo = (await Jimp.read(LOGO)).autocrop({ tolerance: 0.02, cropOnlyFrames: false });
const S = 1024;
// Ícone completo (legado/redondo): degradê + disco branco com o logótipo.
const full = gradient(S);
full.composite(await disc(Math.round(S * 0.78), logo), Math.round(S * 0.11), Math.round(S * 0.11));
const square = mask(full.clone(), Math.round(S * 0.22));
const round = mask(full.clone(), S / 2);
// Foreground adaptativo: só o disco, dentro da zona segura (66/108 do lado).
const fg = new Jimp(S, S, 0x00000000);
const fgDisc = await disc(Math.round(S * 0.6), logo);
fg.composite(fgDisc, Math.round((S - fgDisc.bitmap.width) / 2), Math.round((S - fgDisc.bitmap.height) / 2));

if (OUT_PREVIEW) {
  fs.mkdirSync(OUT_PREVIEW, { recursive: true });
  await square.writeAsync(path.join(OUT_PREVIEW, 'icon.png'));
  await round.writeAsync(path.join(OUT_PREVIEW, 'icon-round.png'));
  await fg.writeAsync(path.join(OUT_PREVIEW, 'icon-fg.png'));
}
if (!fs.existsSync(RES)) {
  if (OUT_PREVIEW) process.exit(0);
  process.stderr.write('\nSem android/. Corra primeiro: cap add android\n\n');
  process.exit(1);
}

for (const [dir, legacy, fgSize] of [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]]) {
  const out = path.join(RES, `mipmap-${dir}`);
  fs.mkdirSync(out, { recursive: true });
  await square.clone().resize(legacy, legacy, Jimp.RESIZE_BICUBIC).writeAsync(path.join(out, 'ic_launcher.png'));
  await round.clone().resize(legacy, legacy, Jimp.RESIZE_BICUBIC).writeAsync(path.join(out, 'ic_launcher_round.png'));
  await fg.clone().resize(fgSize, fgSize, Jimp.RESIZE_BICUBIC).writeAsync(path.join(out, 'ic_launcher_foreground.png'));
}
fs.writeFileSync(path.join(RES, 'values', 'ic_launcher_background.xml'),
  '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#2430E8</color>\n</resources>\n');

// Splash (Android ≤ 11 e fallback): logótipo centrado em fundo branco, nos
// tamanhos exatos que o modelo do Capacitor trouxe.
for (const d of fs.readdirSync(RES).filter((n) => n.startsWith('drawable'))) {
  const file = path.join(RES, d, 'splash.png');
  if (!fs.existsSync(file)) continue;
  const cur = await Jimp.read(file);
  const { width: w, height: h } = cur.bitmap;
  const splash = new Jimp(w, h, 0xffffffff);
  const side = Math.round(Math.min(w, h) * 0.42);
  const l = await disc(side, logo);
  splash.composite(l, Math.round((w - side) / 2), Math.round((h - side) / 2));
  await splash.writeAsync(file);
}
process.stdout.write('\nÍcones e arranque da LPS Loja gerados.\n\n');
