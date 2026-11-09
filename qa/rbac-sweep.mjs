/**
 * QA — varrimento DINÂMICO de permissões: chama TODOS os endpoints de escrita
 * (POST/PATCH/PUT/DELETE) da API local com um utilizador só de consulta
 * (ATTENDANT) e com um caixa (CASHIER). Lê as rotas do código-fonte.
 *
 * Sinaliza: 2xx de quem não devia (escrita aceite), 5xx (rebentou com corpo
 * vazio/ids aleatórios). 400/403/404/409/422 são respostas aceitáveis.
 * Endpoints públicos e de autenticação ficam de fora.
 */
import fs from 'node:fs';
import path from 'node:path';
import { call, ok, uuid } from './lib.mjs';

const S = JSON.parse(fs.readFileSync(process.env.QA_STATE ?? 'qa/.state.json', 'utf8'));
const ROOT = 'apps/api/src';

function routes() {
  const out = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.controller.ts')) {
      const src = fs.readFileSync(p, 'utf8');
      // Cada classe @Controller tem o seu prefixo e os seus decoradores.
      const parts = src.split(/(?=@Controller\()/);
      for (const part of parts.slice(1)) {
        const prefix = (part.match(/@Controller\(\s*['"`]([^'"`]*)['"`]/) ?? [])[1] ?? '';
        const head = part.slice(0, part.indexOf('class ') + 200);
        const classPublic = /@Public\(\)/.test(head);
        const re = /((?:\s*@[A-Za-z]+\([^)]*\)[^\n]*\n)+)\s*(?:async\s+)?\w+\s*\(/g;
        let m;
        while ((m = re.exec(part))) {
          const deco = m[1];
          const v = deco.match(/@(Post|Patch|Put|Delete)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/);
          if (!v) continue;
          out.push({ method: v[1].toUpperCase(), url: `/${prefix}/${v[2] ?? ''}`.replace(/\/+/g, '/').replace(/\/$/, ''), public: classPublic || /@Public\(\)/.test(deco), file: p });
        }
      }
    }
  });
  walk(ROOT);
  return out;
}

async function tok(email) {
  const r = await ok('POST', '/auth/login', { body: { email, password: S.pass } });
  return r.tokens?.accessToken ?? r.accessToken;
}

async function main() {
  const all = routes().filter((r) => !r.public && !r.url.startsWith('/auth') && !r.url.startsWith('/store/') && !r.url.includes('/public'));
  const who = { ATTENDANT: await tok('limitado@grupo-kwanza.qa.test'), CASHIER: await tok('caixa5@grupo-kwanza.qa.test') };
  const findings = [];
  let n = 0;
  for (const [role, token] of Object.entries(who)) {
    for (const r of all) {
      const url = r.url.replace(/:[A-Za-z]+/g, () => uuid());
      const res = await call(r.method, url, { token, body: {} });
      n++;
      if (res.status < 300 || res.status >= 500) findings.push({ role, method: r.method, route: r.url, status: res.status, body: JSON.stringify(res.body).slice(0, 160), file: r.file });
    }
  }
  fs.mkdirSync('qa/out', { recursive: true });
  fs.writeFileSync('qa/out/rbac-sweep.json', JSON.stringify({ calls: n, routes: all.length, findings }, null, 1));
  console.log(`${n} chamadas a ${all.length} rotas de escrita; ${findings.length} respostas a rever`);
  for (const f of findings) console.log(`${f.role.padEnd(9)} ${String(f.status).padEnd(4)} ${f.method.padEnd(6)} ${f.route}  ${f.body}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
