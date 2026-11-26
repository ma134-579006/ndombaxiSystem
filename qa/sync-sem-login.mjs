/**
 * QA — a fila offline da Caixa sobe SOZINHA quando a rede volta, sem ninguém
 * entrar na Caixa (missão QA, fase 1). Só contra a API local de QA.
 *
 * Cenários (Caixa em modo "app instalada": window.__NDOMBAXI_NATIVE__ = true):
 *   S1  operador entra com rede → API cai → venda entra na fila → app FECHA →
 *       app reabre (sem sessão: sessionStorage morreu) ainda sem rede → a rede
 *       volta → ninguém entra → a venda tem de chegar à BD (mesmo client_op_id).
 *   S2  idempotência: a mesma venda não é emitida duas vezes.
 *   S3  a app continua no ecrã de login (nada foi aberto em nome do operador).
 *
 * Uso: node qa/sync-sem-login.mjs <url-da-caixa> [rótulo]
 *   ex.: node qa/sync-sem-login.mjs http://localhost:5181 correcao
 * Requer: API QA em 127.0.0.1:3901, vite da Caixa com VITE_API_URL=<url>/papi e
 *   PAPI_TARGET=http://127.0.0.1:3901; QA_PLAYWRIGHT = pasta com playwright-core.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { db, Report, sleep, uuid } from './lib.mjs';

const BASE = process.argv[2] ?? 'http://localhost:5181';
const LABEL = process.argv[3] ?? 'correcao';
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error('Só contra a Caixa local.');
const require = createRequire(path.join(process.env.QA_PLAYWRIGHT ?? '.', 'package.json'));
const { chromium } = require('playwright-core');
const state = JSON.parse(fs.readFileSync(process.env.QA_STATE ?? 'qa/.state.json', 'utf8'));
const op = state.users['caixa1@grupo-kwanza.qa.test'];
const prod = state.products[0];
const rep = new Report(`sync-sem-login (${LABEL})`);

let apiDown = false;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-caixa-'));

async function abrirApp() {
  const ctx = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { window.__NDOMBAXI_NATIVE__ = true; });
  // Segurança: nada sai para produção, aconteça o que acontecer.
  await ctx.route(/onrender\.com|lpsvendas|vendus\.co/, (r) => r.abort());
  // "Sem rede" = a API não responde (o vite continua a servir a app, como o disco da app instalada).
  await ctx.route('**/papi/**', (r) => (apiDown ? r.abort('internetdisconnected') : r.continue()));
  const page = ctx.pages()[0] ?? await ctx.newPage();
  return { ctx, page };
}

const clientOpId = uuid();
let a = await abrirApp();
await a.page.goto(BASE, { waitUntil: 'domcontentloaded' });
await a.page.click('#ndx_field_acct');
await a.page.fill('#ndx_field_acct', op.email);
await a.page.click('input[placeholder="PIN"]');
await a.page.fill('input[placeholder="PIN"]', op.pin);
await a.page.click('button.va-btn');
await a.page.waitForFunction(() => !!sessionStorage.getItem('nexus.pos.access'), null, { timeout: 30_000 });
rep.check('S0', 'Operador entrou com rede (sessão real)', true, op.email);
await sleep(1500);
const temIdentidade = await a.page.evaluate(() => !!localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith('offline:syncIdentity')) ?? '__'));
console.log(`      identidade de sincronização no aparelho: ${temIdentidade ? 'sim' : 'não'}`);

// API cai; a venda vai para a fila pela MESMA função que o ecrã de vendas usa.
apiDown = true;
await a.page.evaluate(async ({ p, id }) => {
  const m = await import('/src/offline/db.ts');
  const sale = m.buildPendingSale(
    [{ product: { id: p.id, code: p.code, name: `QA ${p.code}`, unit_price: String(p.price), iva_code: 'NOR' }, quantity: 2 }],
    { net: p.price * 2, iva: 0, gross: p.price * 2 }, null, id, { paymentType: 'CASH', tendered: p.price * 2, changeGiven: 0 },
  );
  await m.queueSale(sale);
}, { p: prod, id: clientOpId });
const naFila = await a.page.evaluate(async () => (await import('/src/offline/db.ts')).countPendingSales());
rep.check('S1a', 'Venda feita sem rede ficou na fila do aparelho', naFila >= 1, `pendentes=${naFila}`);

// App FECHA (fim do dia, falta de luz, operador sai).
await a.ctx.close();

// App reabre ainda sem rede; ninguém entra.
a = await abrirApp();
await a.page.goto(BASE, { waitUntil: 'domcontentloaded' });
await sleep(4000);
const semSessao = await a.page.evaluate(() => !sessionStorage.getItem('nexus.pos.access'));
rep.check('S1b', 'App reaberta sem sessão do operador', semSessao);

// A rede volta.
apiDown = false;
const t0 = Date.now();
const c = await db(state.A.schema);
let row = null;
while (Date.now() - t0 < 60_000) {
  const r = await c.query('SELECT number AS document_no, gross_total, cashier_id FROM invoices WHERE client_op_id = $1::uuid', [clientOpId]);
  if (r.rows.length) { row = r.rows; break; }
  await sleep(1000);
}
const segs = ((Date.now() - t0) / 1000).toFixed(1);
rep.check('S1', 'A venda subiu sozinha quando a rede voltou, sem login', !!row, row ? `${row[0].document_no} em ${segs}s` : `não subiu em ${segs}s`);
rep.check('S2', 'Sem duplicados (idempotência pelo client_op_id)', !row || row.length === 1, `linhas=${row?.length ?? 0}`);
const fila = await a.page.evaluate(async () => (await import('/src/offline/db.ts')).countPendingSales());
rep.check('S1c', 'Fila do aparelho vazia', fila === 0, `pendentes=${fila}`);
const noLogin = await a.page.locator('#ndx_field_acct').count();
rep.check('S3', 'A Caixa continua no ecrã de login (nada aberto em nome do operador)', noLogin === 1);
await c.end();

// S4 — "Lembrar-me" + app aberta SEM REDE com o token de acesso já expirado:
// a sessão tem de ficar de pé (antes terminava e pedia o login) e renovar-se
// sozinha quando a rede voltar.
await a.page.click('#ndx_field_acct');
await a.page.fill('#ndx_field_acct', op.email);
await a.page.click('input[placeholder="PIN"]');
await a.page.fill('input[placeholder="PIN"]', op.pin);
await a.page.check('.va-remember input[type=checkbox]');
await a.page.click('button.va-btn');
await a.page.waitForFunction(() => !!localStorage.getItem('ndx.pos.rm.nexus.pos.access'), null, { timeout: 30_000 });
await a.page.evaluate(() => {
  // Mesmo token, com `exp` no passado (o cliente não verifica a assinatura).
  const t = localStorage.getItem('ndx.pos.rm.nexus.pos.access');
  const [h, p, s] = t.split('.');
  const pl = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
  pl.exp = Math.floor(Date.now() / 1000) - 60;
  const np = btoa(JSON.stringify(pl)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  localStorage.setItem('ndx.pos.rm.nexus.pos.access', `${h}.${np}.${s}`);
});
await a.ctx.close();
apiDown = true;
a = await abrirApp();
await a.page.goto(BASE, { waitUntil: 'domcontentloaded' });
await sleep(6000);
const loginOffline = await a.page.locator('#ndx_field_acct').count();
rep.check('S4a', '"Lembrar-me": app aberta sem rede com token expirado mantém a sessão', loginOffline === 0, loginOffline ? 'voltou ao login' : 'sessão de pé');
apiDown = false;
let renovado = false;
const t1 = Date.now();
while (Date.now() - t1 < 45_000) {
  renovado = await a.page.evaluate(() => {
    const t = sessionStorage.getItem('nexus.pos.access');
    if (!t) return false;
    const pl = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return pl.exp * 1000 > Date.now();
  }).catch(() => false);
  if (renovado) break;
  await sleep(1000);
}
rep.check('S4b', 'Quando a rede volta, a sessão renova-se sozinha', renovado, `${((Date.now() - t1) / 1000).toFixed(1)}s`);
await a.ctx.close();
fs.rmSync(profile, { recursive: true, force: true });

const sum = rep.summary();
fs.mkdirSync('qa/out', { recursive: true });
fs.writeFileSync(`qa/out/sync-sem-login-${LABEL}.json`, JSON.stringify(sum, null, 2));
console.log(`\n${sum.passed}/${sum.total} PASS`);
process.exit(sum.failed ? 1 : 0);
