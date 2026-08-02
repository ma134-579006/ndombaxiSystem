/**
 * Gera um ícone Windows (.ico) NÍTIDO a partir do logótipo oficial 512px.
 *
 * PORQUÊ: o electron-builder, dado um único PNG, gera o .ico adivinhando os
 * tamanhos pequenos com um redimensionamento simples — a 16/32px o monograma
 * com gradiente fica fusco (o utilizador notou: "logo do desktop sem qualidade").
 * A app Android gera o ícone em CADA densidade e por isso fica sempre nítido.
 * Aqui fazemos o mesmo para o Windows: redimensionamos o logótipo para cada
 * tamanho canónico (com o resize de qualidade do jimp) e embrulhamo-los num
 * container .ico com CADA tamanho embutido como PNG (suportado no Windows Vista+,
 * logo em todo o Windows 10/11 que a app suporta).
 *
 *   node scripts/gen-win-icon.mjs   →  apps/desktop/build/icon.ico
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const repo = path.resolve(desktop, '..', '..');

// Resolve o jimp-compact (redimensionador JS puro) tolerando o layout do pnpm.
// NDX_PNPM_STORE permite apontar a store de outro checkout (ex.: correr a partir
// de um worktree sem node_modules próprios).
function loadJimp() {
  try { return require('jimp-compact'); } catch { /* tenta a store do pnpm */ }
  const stores = [process.env.NDX_PNPM_STORE, path.join(repo, 'node_modules', '.pnpm')].filter(Boolean);
  for (const store of stores) {
    try {
      const dir = fs.readdirSync(store).find((d) => d.startsWith('jimp-compact@'));
      if (dir) return require(path.join(store, dir, 'node_modules', 'jimp-compact'));
    } catch { /* store inexistente — tenta a próxima */ }
  }
  throw new Error('jimp-compact não encontrado (instale-o no monorepo).');
}

// Tamanhos canónicos de um .ico Windows (o shell escolhe o que precisa).
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Constrói um .ico com cada `png` (Buffer) embutido — um por tamanho. */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);            // reservado
  header.writeUInt16LE(1, 2);            // tipo 1 = ícone
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  const blobs = [];
  entries.forEach((e, i) => {
    const b = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 0);   // largura (0 = 256)
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 1);   // altura  (0 = 256)
    dir.writeUInt8(0, b + 2);            // paleta (0 = sem paleta)
    dir.writeUInt8(0, b + 3);            // reservado
    dir.writeUInt16LE(1, b + 4);         // planos de cor
    dir.writeUInt16LE(32, b + 6);        // bits por pixel
    dir.writeUInt32LE(e.png.length, b + 8);   // tamanho em bytes
    dir.writeUInt32LE(offset, b + 12);        // deslocamento
    offset += e.png.length;
    blobs.push(e.png);
  });

  return Buffer.concat([header, dir, ...blobs]);
}

async function main() {
  const Jimp = loadJimp();
  const logo = path.join(repo, 'apps', 'web', 'public', 'logo.png');
  const base = await Jimp.read(logo);

  const buildDir = path.join(desktop, 'build');
  fs.mkdirSync(buildDir, { recursive: true });

  const entries = [];
  for (const size of SIZES) {
    // jimp-compact (0.16) não expõe getBufferAsync — passamos por um PNG
    // temporário (writeAsync é estável) e lemos os bytes de volta.
    const tmp = path.join(buildDir, `._icon-${size}.png`);
    await base.clone().resize(size, size, Jimp.RESIZE_BICUBIC).writeAsync(tmp);
    const png = fs.readFileSync(tmp);
    fs.rmSync(tmp, { force: true });
    entries.push({ size, png });
  }

  const out = path.join(buildDir, 'icon.ico');
  fs.writeFileSync(out, buildIco(entries));
  process.stdout.write(`  Ícone Windows nítido gerado: ${path.relative(repo, out)} (${SIZES.join(', ')} px)\n`);
}

main().catch((e) => { process.stderr.write(`\nFalha a gerar o icon.ico: ${e.message}\n\n`); process.exit(1); });
