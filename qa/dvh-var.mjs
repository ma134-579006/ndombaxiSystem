/**
 * QA — QA-023 (fase 6): nos CSS de produção, nenhuma declaração com dvh/svh/lvh E var()
 * pode ficar fora de `@supports (height: 1dvh)`. Fora dele, um motor sem dvh aceita-a ao ler
 * e anula-a ao calcular (fica `unset`), apagando o fallback em vh.
 * Uso: node qa/dvh-var.mjs <pasta-dist> [<pasta-dist> …]
 */
import fs from 'node:fs';
import path from 'node:path';

const DIN = /\d(?:dvh|svh|lvh|dvw|svw|lvw|dvi|dvb|dvmin|dvmax)\b/i;
let falhas = 0; let protegidas = 0;
for (const dir of process.argv.slice(2)) {
  const assets = path.join(dir, 'assets');
  for (const f of fs.readdirSync(assets).filter((n) => n.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(assets, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const pilha = []; let buf = '';
    for (const ch of css) {
      if (ch === '{') { pilha.push(buf.trim()); buf = ''; continue; }
      if (ch === '}' || ch === ';') {
        const decl = buf.trim(); buf = '';
        if (decl.includes(':') && decl.includes('var(') && DIN.test(decl)) {
          if (pilha.some((p) => /^@supports\s*\(\s*height\s*:\s*1dvh\s*\)/i.test(p))) protegidas++;
          else { falhas++; console.log(`FAIL  ${path.basename(dir)}/${f}  ${pilha.at(-1)} { ${decl.slice(0, 90)} }`); }
        }
        if (ch === '}') pilha.pop();
        continue;
      }
      buf += ch;
    }
  }
}
console.log(`\n${protegidas} protegidas, ${falhas} desprotegidas`);
process.exit(falhas ? 1 : 0);
