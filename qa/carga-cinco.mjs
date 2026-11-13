/**
 * QA — carga PROGRESSIVA contra a API LOCAL (nunca produção), com as 5 empresas de
 * `qa/seed-cinco.mjs` ao mesmo tempo (multi-inquilino real).
 *
 * Cada utilizador virtual (VU) é um caixa de uma das empresas: abre o turno (com rede
 * só se vende com a caixa aberta), pesquisa produtos e clientes, emite vendas com
 * chave de idempotência e consulta o histórico. Níveis por omissão: 10 → 25 → 50 → 100.
 * Pára antes se a taxa de erro passar 20 % ou o p95 passar 15 s (saturação).
 *
 * No fim confirma a coerência: nº de faturas emitidas = nº de respostas 2xx de venda,
 * sem números fiscais repetidos, e deadlocks do Postgres no período.
 *
 * Uso: node qa/carga-cinco.mjs [segundosPorNível=30] [níveis=10,25,50,100]
 * Saída: qa/out/carga-cinco.json
 */
import fs from 'node:fs';
import { call, ok, db, uuid, pct, sleep } from './lib.mjs';

const S = JSON.parse(fs.readFileSync(process.env.QA_STATE ?? 'qa/.cinco.json', 'utf8'));
const DUR = Number(process.argv[2] ?? 30) * 1000;
const LEVELS = (process.argv[3] ?? '10,25,50,100').split(',').map(Number);
const KEYS = ['A', 'B', 'C', 'D', 'E'].filter((k) => S[k]);

async function main() {
  // Um posto por caixa (2 por empresa = 10 postos), cada um com a sua série e o seu turno.
  const posts = [];
  for (const k of KEYS) {
    const prods = S[k].products.filter((p) => p.price > 0).slice(0, 80);
    for (const nick of ['caixa1', 'caixa2']) {
      const u = S[k].users[nick];
      const r = await ok('POST', '/auth/login', { body: { email: u.email, password: S.pass } });
      const token = r.tokens?.accessToken ?? r.accessToken;
      const cur = await call('GET', '/cashbox/session/current', { token });
      if (!cur.body?.id) await ok('POST', '/cashbox/session/open', { token, body: { openingFloat: 0 } });
      const deviceKey = `qa-carga-${k}-${nick}`;
      await call('POST', '/devices/register', { token, body: { deviceKey, name: `Carga ${k} ${nick}`, platform: 'windows' } });
      posts.push({ k, token, prods, deviceKey });
    }
  }
  // Stock abundante nos artigos usados: mede capacidade, não roturas.
  const owner = {};
  for (const k of KEYS) {
    const r = await ok('POST', '/auth/login', { body: { email: S[k].email, password: S.pass } });
    owner[k] = r.tokens?.accessToken ?? r.accessToken;
    if (!process.env.QA_SKIP_STOCK) {
      for (const p of S[k].products.filter((x) => x.price > 0).slice(0, 80)) {
        await call('POST', '/erp/stock/entry', { token: owner[k], body: { productId: p.id, warehouseId: S[k].storeId, quantity: 100_000, unitCost: p.cost } });
      }
    }
  }

  const c = await db();
  const dl0 = Number((await c.query('SELECT sum(deadlocks) d FROM pg_stat_database')).rows[0].d);
  const okSales = []; // { k, number }
  const results = [];
  for (const vus of LEVELS) {
    const lat = {}; const errs = {}; let done = 0; let failed = 0; let sales = 0; let maxConns = 0; let maxLockWaits = 0;
    let stop = false;
    const t0 = Date.now();
    const sampler = (async () => {
      while (!stop) {
        const q = (await c.query(`SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) conns,
                                         (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock') lw`)).rows[0];
        maxConns = Math.max(maxConns, Number(q.conns)); maxLockWaits = Math.max(maxLockWaits, Number(q.lw));
        await sleep(2000);
      }
    })();
    const rec = (name, r) => {
      (lat[name] ??= []).push(r.ms); done++;
      if (r.status >= 400 || r.status === 0) { failed++; const key = `${name} ${r.status}`; errs[key] = (errs[key] ?? 0) + 1; }
    };
    const vu = async (i) => {
      const post = posts[i % posts.length];
      let n = 0;
      while (Date.now() - t0 < DUR) {
        n++;
        const p = post.prods[(i * 7 + n) % post.prods.length];
        const step = n % 5;
        try {
          if (step === 0) rec('GET products?q', await call('GET', `/pos/products?q=${encodeURIComponent(p.code)}&limit=20`, { token: post.token }));
          else if (step === 1) rec('GET customers', await call('GET', '/pos/customers?limit=20', { token: post.token }));
          else if (step === 4) rec('GET invoices', await call('GET', '/pos/invoices?from=' + new Date().toISOString().slice(0, 10), { token: post.token }));
          else {
            const q = post.prods[(i + n * 3) % post.prods.length];
            const r = await call('POST', '/pos/invoices', { token: post.token, body: {
              lines: [{ productCode: p.code, quantity: 1 }, { productCode: q.code, quantity: 2 }],
              paymentType: n % 3 ? 'CASH' : 'CARD', tendered: n % 3 ? 100_000_000 : undefined, clientOpId: uuid(), deviceKey: post.deviceKey,
            } });
            rec('POST invoices', r);
            if (r.status < 300) { sales++; okSales.push({ k: post.k, number: r.body?.number }); }
          }
        } catch (e) {
          rec('NETWORK', { status: 0, ms: 0 });
        }
      }
    };
    await Promise.all(Array.from({ length: vus }, (_, i) => vu(i)));
    stop = true; await sampler;
    const secs = (Date.now() - t0) / 1000;
    const all = Object.values(lat).flat();
    const row = {
      vus, seconds: Math.round(secs), requests: done, rps: Math.round(done / secs), sales, salesPerSec: +(sales / secs).toFixed(1),
      errorRate: +(failed / Math.max(1, done) * 100).toFixed(2), p50: Math.round(pct(all, 50)), p95: Math.round(pct(all, 95)), p99: Math.round(pct(all, 99)),
      byEndpoint: Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, { n: v.length, p50: Math.round(pct(v, 50)), p95: Math.round(pct(v, 95)) }])),
      errors: errs, pgConnsMax: maxConns, lockWaitsMax: maxLockWaits,
    };
    results.push(row);
    console.log(JSON.stringify({ vus, rps: row.rps, vendas_s: row.salesPerSec, erro: row.errorRate, p50: row.p50, p95: row.p95, p99: row.p99, conns: maxConns, locks: maxLockWaits, errors: errs }));
    if (row.errorRate > 20 || row.p95 > 15000) { console.log(`SATURAÇÃO a ${vus} VUs — paragem.`); break; }
    await sleep(3000);
  }
  const dl1 = Number((await c.query('SELECT sum(deadlocks) d FROM pg_stat_database')).rows[0].d);

  // Coerência: números fiscais únicos por empresa e todos gravados na base.
  const integrity = {};
  for (const k of KEYS) {
    const mine = okSales.filter((s) => s.k === k).map((s) => s.number);
    const dupes = mine.length - new Set(mine).size;
    const ck = await db(S[k].schema);
    const found = mine.length ? Number((await ck.query('SELECT count(*) n FROM invoices WHERE number = ANY($1)', [mine])).rows[0].n) : 0;
    const chainDupes = Number((await ck.query('SELECT count(*) n FROM (SELECT number FROM invoices GROUP BY number HAVING count(*) > 1) x')).rows[0].n);
    await ck.end();
    integrity[k] = { vendas: mine.length, gravadas: found, repetidasNaResposta: dupes, numerosRepetidosNaBase: chainDupes };
  }
  await c.end();
  const out = { at: new Date().toISOString(), levels: results, deadlocks: dl1 - dl0, integrity };
  fs.mkdirSync('qa/out', { recursive: true });
  fs.writeFileSync('qa/out/carga-cinco.json', JSON.stringify(out, null, 1));
  console.log('deadlocks no período:', dl1 - dl0);
  console.log('coerência:', JSON.stringify(integrity));
}
main().catch((e) => { console.error(e); process.exit(1); });
