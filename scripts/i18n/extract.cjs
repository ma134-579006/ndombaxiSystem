// Extrai os textos visíveis (PT) dos .tsx/.ts das apps: texto JSX, atributos
// visíveis (placeholder/title/aria-label/alt/label) e literais passados a
// setError/alert/confirm/toast. Uso: node extract.cjs <dir...> > out.json
const ts = require(require.resolve('typescript', { paths: [process.cwd() + '/apps/web'] }));
const fs = require('fs'); const path = require('path');
const ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'hint', 'tooltip', 'emptyText', 'confirmText', 'cancelText', 'subtitle', 'heading', 'text', 'description']);
const CALLS = /^(setError|setErr|setWarn|setMsg|setInfo|setNotice|alert|confirm|toast|notify|showToast|swal|askConfirm|setToast|setBanner|prompt)$/;
const out = new Map();
const looksText = (s) => {
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 220) return null;
  if (!/[A-Za-zÀ-ÿ]/.test(s)) return null;
  if (/^[a-z0-9_.:\/#?&=-]+$/.test(s) && !/\s/.test(s) && !/[À-ÿ]/.test(s) && s.length > 0 && s === s.toLowerCase()) return null; // ids/classes/urls
  if (/^(https?:|\/|#|\.|var\(|rgba?\(|\d+px)/.test(s)) return null;
  if (/[{}<>;]/.test(s)) return null;
  return s;
};
function walk(dir, files) { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); const st = fs.statSync(p); if (st.isDirectory()) { if (!/node_modules|dist|__tests__|test/.test(f)) walk(p, files); } else if (/\.tsx?$/.test(f) && !/\.(spec|test|d)\.tsx?$/.test(f)) files.push(p); } return files; }
function add(s, file) { const t = looksText(s); if (!t) return; const e = out.get(t) || { n: 0, f: new Set() }; e.n++; e.f.add(path.basename(file)); out.set(t, e); }
for (const d of process.argv.slice(2)) for (const file of walk(d, [])) {
  const src = fs.readFileSync(file, 'utf8'); const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (n) => {
    if (ts.isJsxText(n)) add(n.text, file);
    else if (ts.isJsxAttribute(n) && n.initializer && ATTRS.has(n.name.getText())) {
      const i = n.initializer; if (ts.isStringLiteral(i)) add(i.text, file);
      else if (ts.isJsxExpression(i) && i.expression && (ts.isStringLiteral(i.expression) || ts.isNoSubstitutionTemplateLiteral(i.expression))) add(i.expression.text, file);
    } else if (ts.isCallExpression(n) && CALLS.test(n.expression.getText().split('.').pop())) {
      for (const a of n.arguments) if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) add(a.text, file);
    } else if (ts.isJsxExpression(n) && n.expression && (ts.isStringLiteral(n.expression)) && n.parent && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) add(n.expression.text, file);
    else if (ts.isConditionalExpression(n) && n.parent && ts.isJsxExpression(n.parent)) { for (const b of [n.whenTrue, n.whenFalse]) if (ts.isStringLiteral(b)) add(b.text, file); }
    else if (ts.isPropertyAssignment(n) && /^(label|title|hint|placeholder|text|desc|description|name|help|caption|empty|subtitle)$/.test(n.name.getText()) && ts.isStringLiteral(n.initializer)) add(n.initializer.text, file);
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
const res = [...out.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => ({ s: k, n: v.n, f: [...v.f].slice(0, 3) }));
process.stdout.write(JSON.stringify(res, null, 0));
