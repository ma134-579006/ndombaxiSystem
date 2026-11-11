// Mostra a cobertura do dicionário face aos textos extraídos do ecrã.
// Uso: node scripts/i18n/coverage.cjs [lista.json]
const fs = require('fs'); const path = require('path');
const ts = require(require.resolve('typescript', { paths: [process.cwd() + '/apps/web'] }));
const dir = path.join(process.cwd(), 'packages/i18n/src/dict');
const keys = new Map();
for (const f of fs.readdirSync(dir).filter((f) => /^part\d+\.ts$/.test(f))) {
  const js = ts.transpileModule(fs.readFileSync(path.join(dir, f), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const m = { exports: {} }; new Function('module', 'exports', js)(m, m.exports);
  const d = m.exports.default;
  for (const [k, v] of Object.entries(d)) {
    if (!Array.isArray(v) || v.length !== 3 || v.some((x) => typeof x !== 'string' || !x)) console.log('ENTRADA INVÁLIDA', f, k);
    if (keys.has(k)) console.log('DUPLICADO', k, '→', keys.get(k), 'e', f);
    keys.set(k, f);
  }
}
const list = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : [];
const missing = list.filter((s) => !keys.has(s.replace(/\s+/g, ' ').trim()));
console.log('entradas no dicionário:', keys.size);
if (list.length) { console.log('textos extraídos:', list.length, '· em falta:', missing.length, `(${(100 - missing.length * 100 / list.length).toFixed(1)}% cobertos)`); console.log(missing.slice(0, 60).join('\n')); }
