/**
 * QA — lista declarações CSS com funcionalidades modernas (color-mix, dvh/svh,
 * unidades cq*) SEM reserva na mesma regra (missão QA, fase 4).
 * Uso: node qa/css-legacy.mjs apps/pos/src/vpos.css apps/pos/src/theme.css
 * Nota: reservas noutras regras (ex.: blocos @supports not) não são detetadas.
 */
import fs from 'node:fs';
const MOD = [
  ['color-mix', /color-mix\(/, 'Safari 16.2 / Chrome 111'],
  ['dvh/svh/lvh', /\d(dvh|svh|lvh|dvw|svw)\b/, 'Safari 15.4 / Chrome 108'],
  ['cq units', /\d(cqw|cqh|cqi|cqb|cqmin|cqmax)\b/, 'Safari 16 / Chrome 105'],
];
for (const f of process.argv.slice(2)) {
  const css = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g; let m; let total = 0; const out = [];
  while ((m = re.exec(css))) {
    const sel = m[1].trim().split('\n').pop().trim();
    const decls = m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; });
    decls.forEach(([prop, val], idx) => {
      for (const [nome, rx] of MOD) {
        if (!rx.test(val)) continue;
        const temReserva = decls.slice(0, idx).some(([p2, v2]) => p2 === prop && !MOD.some(([, r]) => r.test(v2)));
        if (!temReserva) { total++; out.push(`${nome.padEnd(11)} ${sel.slice(0, 70).padEnd(70)} ${prop}`); }
      }
    });
  }
  console.log(`\n== ${f}: ${total} sem reserva`);
  console.log(out.join('\n'));
}
