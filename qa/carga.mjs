/**
 * QA — carga e stress PROGRESSIVOS contra a API LOCAL (nunca produção).
 *
 * Cada utilizador virtual (VU) imita um posto: pesquisa produtos, consulta
 * clientes, emite vendas (com chave de idempotência), consulta o histórico e o
 * dashboard. Níveis: 10 → 50 → 100 → 250 → 500 → 1000 VUs (pára antes se a
 * taxa de erro passar 20 % ou p95 > 15 s — ponto de saturação).
 * Amostra a cada 2 s: CPU/RAM do processo da API e do Postgres, ligações,
 * esperas por locks e deadlocks (pg_stat_database).
 *
 * Uso: node qa/carga.mjs [segundosPorNível=40] [níveis=10,50,100,250,500,1000]
 * Saída: qa/out/carga.json
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { call, ok, db, uuid, pct, sleep } from './lib.mjs';

const S = JSON.parse(fs.readFileSync(process.env.QA_STATE ?? 'qa/.state.json', 'utf8'));
const DUR = Number(process.argv[2] ?? 40) * 1000;
const LEVELS = (process.argv[3] ?? '10,50,100,250,500,1000').split(',').map(Number);
const HOT = S.products.slice(0, 120);

function pidOnPort(port) {
  const out = execSync('netstat -ano').toString();
  const line = out.split('\n').find((l) => l.includes(`:${port} `) && l.includes('LISTEN'));
  return line ? line.trim().split(/\s+/).pop() : null;
}
function procStats(pid) {
  try {
    const o = execSync(`wmic path Win32_PerfFormattedData_PerfProc_Process where IDProcess=${pid} get PercentProcessorTime,WorkingSetPrivate /format:csv`).toString().trim().split('\n').pop().split(',');
    return { cpu: Number(o[1]), ramMB: Math.round(Number(o[2]) / 1048576) };
  } catch { return { cpu: NaN, ramMB: NaN }; }
}
function pgCpu() {
  try {
    const o = execSync('wmic path Win32_PerfFormattedData_PerfProc_Process where "Name like \'postgres%\'" get PercentProcessorTime,WorkingSetPrivate /format:csv').toString().trim().split('\n').slice(1);
    let cpu = 0, ram = 0;
    for (const l of o) { const p = l.trim().split(','); if (p.length >= 3) { cpu += Number(p[1]) || 0; ram += Number(p[2]) || 0; } }
    return { cpu, ramMB: Math.round(ram / 1048576) };
  } catch { return { cpu: NaN, ramMB: NaN }; }
}

async function tokens() {
  const out = [];
  for (const [email, u] of Object.entries(S.users)) {
    if (u.role !== 'CASHIER') continue;
    const r = await ok('POST', '/auth/login', { body: { email, password: S.pass } });
    out.push(r.tokens?.accessToken ?? r.accessToken);
  }
  return out;
}

async function main() {
  // Stock abundante nos artigos "quentes" para medir capacidade, não roturas.
  const stores = Object.entries(S.stores).filter(([k]) => k !== 'ARM' && !/^[0-9a-f-]{36}$/.test(k)).map(([, v]) => v);
  if (!process.env.QA_SKIP_STOCK) {
    for (const p of HOT) for (const s of stores) await call('POST', '/erp/stock/entry', { token: S.A.token, body: { productId: p.id, warehouseId: s, quantity: 1_000_000, unitCost: p.cost } });
  }
  const toks = await tokens();
  // QA_DEVICES=1: cada caixa regista o SEU posto → série fiscal própria (o
  // caminho recomendado para muitas caixas; sem isso todas partilham a série A).
  const devKeys = [];
  if (process.env.QA_DEVICES) {
    for (let i = 0; i < toks.length; i++) {
      const key = `qa-posto-${String(i).padStart(4, '0')}`;
      const r = await call('POST', '/devices/register', { token: toks[i], body: { deviceKey: key, name: `Posto QA ${i}`, platform: 'windows' } });
      if (r.status >= 300) console.log('posto', r.status, JSON.stringify(r.body).slice(0, 200));
      devKeys.push(key);
    }
  }
  const apiPid = pidOnPort(3901);
  const c = await db();
  const dl0 = Number((await c.query("SELECT sum(deadlocks) d FROM pg_stat_database")).rows[0].d);

  const results = [];
  for (const vus of LEVELS) {
    const lat = {}; const errs = {}; let done = 0; let failed = 0; let sales = 0;
    const samples = [];
    let stop = false;
    const t0 = Date.now();
    const sampler = (async () => {
      while (!stop) {
        const a = procStats(apiPid); const pgs = pgCpu();
        const q = (await c.query(`SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname='nexus_qa') conns,
                                          (SELECT count(*) FROM pg_stat_activity WHERE datname='nexus_qa' AND wait_event_type='Lock') lockwaits,
                                          (SELECT count(*) FROM pg_stat_activity WHERE datname='nexus_qa' AND state='active') active`)).rows[0];
        samples.push({ t: Date.now() - t0, apiCpu: a.cpu, apiRam: a.ramMB, pgCpu: pgs.cpu, pgRam: pgs.ramMB, conns: Number(q.conns), lockwaits: Number(q.lockwaits), active: Number(q.active) });
        await sleep(2000);
      }
    })();
    const rec = (name, r) => {
      (lat[name] ??= []).push(r.ms);
      done++;
      if (r.status >= 400 || r.status === 0) { failed++; const k = `${name} ${r.status}`; errs[k] = (errs[k] ?? 0) + 1; }
    };
    const vu = async (i) => {
      const token = toks[i % toks.length];
      let n = 0;
      while (Date.now() - t0 < DUR) {
        n++;
        try {
          const p = HOT[(i * 7 + n) % HOT.length];
          const step = n % 5;
          if (step === 0) rec('GET products?q', await call('GET', `/pos/products?q=${encodeURIComponent(p.code)}&limit=20`, { token }));
          else if (step === 1) rec('GET customers?q', await call('GET', `/pos/customers?q=Cliente%20QA%20${n % 900}&limit=20`, { token }));
          else if (step === 4) rec('GET invoices', await call('GET', '/pos/invoices?from=' + new Date().toISOString().slice(0, 10), { token }));
          else {
            const r = await call('POST', '/pos/invoices', { token, body: {
              lines: [{ productCode: p.code, quantity: 1 }, { productCode: HOT[(i + n * 3) % HOT.length].code, quantity: 2 }],
              paymentType: n % 3 ? 'CASH' : 'CARD', tendered: n % 3 ? 10_000_000 : undefined, clientOpId: uuid(),
              ...(devKeys.length ? { deviceKey: devKeys[i % devKeys.length] } : {}),
            } });
            rec('POST invoices', r);
            if (r.status < 300) sales++;
          }
        } catch (e) {
          rec('NETWORK', { status: 0, ms: 0 }); errs[String(e.cause?.code ?? e.message).slice(0, 40)] = (errs[String(e.cause?.code ?? e.message).slice(0, 40)] ?? 0) + 1;
        }
      }
    };
    await Promise.all(Array.from({ length: vus }, (_, i) => vu(i)));
    stop = true; await sampler;
    const secs = (Date.now() - t0) / 1000;
    const all = Object.values(lat).flat();
    const row = {
      vus, seconds: Math.round(secs), requests: done, rps: Math.round(done / secs), salesPerSec: +(sales / secs).toFixed(1), sales,
      errorRate: +(failed / Math.max(1, done) * 100).toFixed(2), p50: Math.round(pct(all, 50)), p95: Math.round(pct(all, 95)), p99: Math.round(pct(all, 99)),
      byEndpoint: Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, { n: v.length, p50: Math.round(pct(v, 50)), p95: Math.round(pct(v, 95)), p99: Math.round(pct(v, 99)) }])),
      errors: errs,
      apiCpuMax: Math.max(...samples.map((s) => s.apiCpu).filter(Number.isFinite), 0), apiRamMaxMB: Math.max(...samples.map((s) => s.apiRam).filter(Number.isFinite), 0),
      pgCpuMax: Math.max(...samples.map((s) => s.pgCpu).filter(Number.isFinite), 0), pgRamMaxMB: Math.max(...samples.map((s) => s.pgRam).filter(Number.isFinite), 0),
      pgConnsMax: Math.max(...samples.map((s) => s.conns), 0), lockWaitsMax: Math.max(...samples.map((s) => s.lockwaits), 0),
    };
    results.push(row);
    console.log(JSON.stringify({ vus: row.vus, rps: row.rps, salesPerSec: row.salesPerSec, err: row.errorRate, p50: row.p50, p95: row.p95, p99: row.p99, apiCpu: row.apiCpuMax, apiRam: row.apiRamMaxMB, pgCpu: row.pgCpuMax, conns: row.pgConnsMax, lockWaits: row.lockWaitsMax, errors: row.errors }));
    if (row.errorRate > 20 || row.p95 > 15000) { console.log(`SATURAÇÃO a ${vus} VUs — paragem.`); break; }
    await sleep(3000);
  }
  const dl1 = Number((await c.query("SELECT sum(deadlocks) d FROM pg_stat_database")).rows[0].d);
  await c.end();
  fs.mkdirSync('qa/out', { recursive: true });
  fs.writeFileSync('qa/out/carga.json', JSON.stringify({ levels: results, deadlocks: dl1 - dl0, machine: { cpus: (await import('node:os')).cpus().length, ramGB: Math.round((await import('node:os')).totalmem() / 1e9) } }, null, 1));
  console.log(`deadlocks durante a carga: ${dl1 - dl0}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
