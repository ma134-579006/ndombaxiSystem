/**
 * QA — apps: depois de terminar a sessão da Caixa aberta a partir do Admin, há um botão para
 * voltar ao ecrã que escolhe entre Admin e Caixa (QA-040). Só local.
 *
 * Simula a app móvel (Capacitor): Gestão e Caixa na MESMA origem (www/gestao, www/caixa) e o
 * lançador em www/index.html. A Caixa real (build de QA) é servida em /caixa/ com o
 * back-launcher.js injetado como faz o prepare-web.mjs. O Admin deixa a sua sessão guardada
 * (ndombaxi.web.access), tal como acontece ao abrir a Caixa pelo painel.
 *   L1  login da Caixa (com a sessão do Admin guardada): botão «Início» visível;
 *   L2  com sessão na Caixa: botão escondido (não tapa a Caixa);
 *   L3  depois de «Terminar sessão» na Caixa: botão visível outra vez;
 *   L4  tocar no botão leva ao lançador (www/index.html).
 * Uso: QA_BACK=<back-launcher.js> node qa/lancador-voltar.mjs <url-caixa-qa> [rótulo]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Report } from './lib.mjs';

const [CAIXA = 'http://localhost:5191', LABEL = 'atual'] = process.argv.slice(2);
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(CAIXA)) throw new Error('Só local.');
const require = createRequire(path.join(process.env.QA_PW ?? process.env.QA_PLAYWRIGHT ?? '.', 'package.json'));
const pw = require('playwright-core');
const BACK = fs.readFileSync(process.env.QA_BACK ?? 'apps/mobile-shell/launcher/back-launcher.js', 'utf8');
const state = JSON.parse(fs.readFileSync(process.env.QA_STATE ?? 'qa/.state.json', 'utf8'));
const op = state.users[process.env.QA_USER ?? 'gerente-sup1@grupo-kwanza.qa.test'];
const rep = new Report(`lancador-voltar (${LABEL})`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const APP = 'http://app.local';

const b = await pw.chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
await ctx.route(/onrender\.com|lpsvendas|vendus\.co|google/, (r) => r.abort());
await ctx.route(`${APP}/**`, async (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Lançador</title><h1 id="lancador">Admin · Caixa</h1>' });
  if (u.pathname === '/caixa/back-launcher.js') return route.fulfill({ contentType: 'text/javascript', body: BACK });
  if (u.pathname === '/caixa/' || u.pathname === '/caixa/index.html') {
    const html = await (await fetch(`${CAIXA}/`)).text();
    return route.fulfill({ contentType: 'text/html', body: html.replace('</body>', '<script src="./back-launcher.js"></script></body>') });
  }
  // Assets e /papi da Caixa de QA (o build usa caminhos absolutos).
  const res = await route.fetch({ url: `${CAIXA}${u.pathname}${u.search}` });
  return route.fulfill({ response: res });
});
const pg = await ctx.newPage();
const botao = () => pg.evaluate(() => { const e = document.getElementById('ndx-back-launcher'); if (!e) return 'ausente'; const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width > 0 ? 'visível' : 'escondido'; });

// O Admin abriu a Caixa: a sessão da Gestão fica guardada na mesma origem.
await pg.goto(`${APP}/index.html`);
await pg.evaluate(() => { sessionStorage.setItem('ndombaxi.web.access', 'token-da-gestao'); });
await pg.goto(`${APP}/caixa/index.html`);
await pg.waitForSelector('#ndx_field_acct', { timeout: 30_000 });
await sleep(1500);
const l1 = await botao();
rep.check('L1', 'Login da Caixa (Admin com sessão): botão «Início» visível', l1 === 'visível', l1);

await pg.click('#ndx_field_acct'); await pg.fill('#ndx_field_acct', op.email);
await pg.click('input[placeholder="PIN"]'); await pg.fill('input[placeholder="PIN"]', op.pin);
await pg.click('button.va-btn');
await pg.waitForFunction(() => !!(sessionStorage.getItem('nexus.pos.access') || localStorage.getItem('nexus.pos.access')), null, { timeout: 30_000 });
await sleep(1500);
const l2 = await botao();
rep.check('L2', 'Com sessão na Caixa: botão escondido', l2 === 'escondido', l2);

// Terminar sessão pelo menu da conta.
for (let k = 0; k < 3 && await pg.locator('.vclosed-open').count(); k++) { await sleep(1500); await pg.locator('.vclosed-open').first().click({ timeout: 8000 }).catch(() => undefined); await sleep(3000); }
await pg.locator('.acct2-btn').first().click({ timeout: 10_000 });
await sleep(600);
await pg.getByRole('menuitem', { name: /Terminar sessão/ }).click({ timeout: 10_000 });
await sleep(800);
// Se a Caixa pedir confirmação, confirma.
const conf = pg.getByRole('button', { name: /^(Sim|Terminar|Confirmar)/ }).filter({ visible: true });
if (await conf.count()) await conf.first().click().catch(() => undefined);
await pg.waitForSelector('#ndx_field_acct', { timeout: 30_000 }).catch(() => undefined);
await sleep(1500);
const l3 = await botao();
rep.check('L3', 'Depois de terminar a sessão da Caixa: botão «Início» visível', l3 === 'visível', l3);

if (l3 === 'visível') {
  await pg.click('#ndx-back-launcher');
  await pg.waitForSelector('#lancador', { timeout: 10_000 }).catch(() => undefined);
}
const l4 = new URL(pg.url()).pathname;
rep.check('L4', 'O botão leva ao lançador (Admin · Caixa)', l4 === '/index.html', l4);

await b.close();
const sum = rep.summary();
fs.mkdirSync('qa/out', { recursive: true });
fs.writeFileSync(`qa/out/lancador-voltar-${LABEL}.json`, JSON.stringify(sum, null, 2));
console.log(`\n${sum.passed}/${sum.total} PASS`);
process.exit(sum.failed ? 1 : 0);
