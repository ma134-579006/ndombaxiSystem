/**
 * QA — a fila de alterações feitas sem rede na GESTÃO sobe sozinha quando a
 * rede volta, sem ninguém entrar (missão QA, fase 1b). Só contra a API local.
 *
 *   G1  gestor entra com rede → API cai → cliente novo entra na fila (mesma
 *       `enqueueWrite` que o cliente HTTP usa) → app FECHA → reabre sem rede e
 *       sem sessão → a rede volta → ninguém entra → o cliente aparece na BD.
 *   G2  uma só linha (idempotência pelo X-Client-Op-Id).
 *   G3  a Gestão continua no ecrã de login.
 *
 * Uso: node qa/sync-gestao-sem-login.mjs <url-da-gestão> [rótulo]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { db, Report, sleep } from './lib.mjs';

const BASE = process.argv[2] ?? 'http://localhost:5183';
const LABEL = process.argv[3] ?? 'correcao';
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error('Só contra a Gestão local.');
const require = createRequire(path.join(process.env.QA_PLAYWRIGHT ?? '.', 'package.json'));
const { chromium } = require('playwright-core');
const state = JSON.parse(fs.readFileSync(process.env.QA_STATE ?? 'qa/.state.json', 'utf8'));
const EMAIL = 'gestor@grupo-kwanza.qa.test';
const PASS = 'QaTeste!2026x'; // senha sintética do qa/seed-empresa.mjs
const rep = new Report(`sync-gestao-sem-login (${LABEL})`);

let apiDown = false;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-gestao-'));
async function abrirApp() {
  const ctx = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { window.__NDOMBAXI_NATIVE__ = true; });
  await ctx.route(/onrender\.com|lpsvendas|vendus\.co/, (r) => r.abort());
  await ctx.route('**/papi/**', (r) => (apiDown ? r.abort('internetdisconnected') : r.continue()));
  return { ctx, page: ctx.pages()[0] ?? await ctx.newPage() };
}

const nome = `QA Cliente Offline ${Date.now()}`;
let a = await abrirApp();
await a.page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await a.page.click('#ndx_field_acct');
await a.page.fill('#ndx_field_acct', EMAIL);
await a.page.click('#ndx_field_secret');
await a.page.fill('#ndx_field_secret', PASS);
await a.page.click('button.va-btn');
await a.page.waitForFunction(() => !!sessionStorage.getItem('ndombaxi.web.access'), null, { timeout: 40_000 });
rep.check('G0', 'Gestor entrou com rede', true, EMAIL);
await sleep(2000);

apiDown = true;
await a.page.evaluate(async (n) => {
  const m = await import('/src/offline/outbox.ts');
  await m.enqueueWrite('POST', '/pos/customers', { name: n });
}, nome);
const naFila = await a.page.evaluate(async () => (await import('/src/offline/outbox.ts')).outboxCount());
rep.check('G1a', 'Alteração feita sem rede ficou na fila', naFila >= 1, `pendentes=${naFila}`);
await a.ctx.close();

a = await abrirApp();
await a.page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await sleep(4000);
rep.check('G1b', 'App reaberta sem sessão', await a.page.evaluate(() => !sessionStorage.getItem('ndombaxi.web.access')));

apiDown = false;
const c = await db(state.A.schema);
const t0 = Date.now();
let rows = [];
while (Date.now() - t0 < 60_000) {
  rows = (await c.query('SELECT id FROM customers WHERE name = $1', [nome])).rows;
  if (rows.length) break;
  await sleep(1000);
}
const segs = ((Date.now() - t0) / 1000).toFixed(1);
rep.check('G1', 'A alteração subiu sozinha quando a rede voltou, sem login', rows.length > 0, rows.length ? `em ${segs}s` : `não subiu em ${segs}s`);
await sleep(4000);
rows = (await c.query('SELECT id FROM customers WHERE name = $1', [nome])).rows;
rep.check('G2', 'Sem duplicados', rows.length <= 1, `linhas=${rows.length}`);
const fila = await a.page.evaluate(async () => (await import('/src/offline/outbox.ts')).outboxCount());
rep.check('G1c', 'Fila do aparelho vazia', fila === 0, `pendentes=${fila}`);
rep.check('G3', 'A Gestão continua no ecrã de login', (await a.page.locator('#ndx_field_acct').count()) === 1);
await c.end();
await a.ctx.close();
fs.rmSync(profile, { recursive: true, force: true });

const sum = rep.summary();
fs.mkdirSync('qa/out', { recursive: true });
fs.writeFileSync(`qa/out/sync-gestao-sem-login-${LABEL}.json`, JSON.stringify(sum, null, 2));
console.log(`\n${sum.passed}/${sum.total} PASS`);
process.exit(sum.failed ? 1 : 0);
