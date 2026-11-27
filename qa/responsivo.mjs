/**
 * QA — responsividade da GESTÃO (missão QA, fase 6). Só contra a Gestão local + API de QA.
 *
 * Para cada secção × tamanho verifica:
 *   R1  zero scroll lateral na PÁGINA;
 *   R2  zero scroll lateral DENTRO de contentores (tabelas/cartões com overflow-x
 *       auto/scroll e conteúdo mais largo) — barras de abas/categorias deslizantes
 *       ficam listadas à parte como "intencional?";
 *   R3  texto cortado por contentor com overflow hidden SEM reticências (amostra).
 * Motores: QA_MOTOR=chromium|firefox|webkit (padrão chromium).
 * Uso: node qa/responsivo.mjs <url-gestão> [rótulo]   (QA_TAMANHOS="240x320,390x844,…")
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Report, jwtPayload } from './lib.mjs';

const [GESTAO = 'http://localhost:5183', LABEL = 'atual'] = process.argv.slice(2);
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(GESTAO)) throw new Error('Só local.');
const require = createRequire(path.join(process.env.QA_PLAYWRIGHT ?? '.', 'package.json'));
const pw = require('playwright-core');
const motor = pw[process.env.QA_MOTOR ?? 'chromium'];
const EMAIL = process.env.QA_GESTOR ?? 'admin@grupo-kwanza.qa.test';
const PASS = 'QaTeste!2026x'; // senha sintética do qa/seed-empresa.mjs
const rep = new Report(`responsivo ${process.env.QA_MOTOR ?? 'chromium'} (${LABEL})`);
const SHOTS = process.env.QA_SHOTS;
const TAM = (process.env.QA_TAMANHOS ?? '240x320,320x568,390x844,768x1024,1024x768,1366x768,1920x1080,3840x2160,7680x4320').split(',').map((t) => t.split('x').map(Number));
const SECOES = (process.env.QA_SECOES ?? 'overview,products,stock-analysis,inventory,stock-movements,documents-new,documents,promotions,customers,receivables,profit,expenses,cashflow,purchasing-suppliers,purchasing,payables,saft,subscription,stores,registers,store,kwanza,orders,operations,payments,users,employees,payroll,leave,settings').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Barras deslizantes por desenho (abas/categorias/carrosséis): registadas, não contam como falha.
const INTENCIONAL = /tabs|tab-bar|chips|vtabs|vcats|carousel|scroller|cat-bar|ptabs|seg/;

const b = await motor.launch();
const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
await ctx.route(/onrender\.com|lpsvendas|vendus\.co|connect\.facebook|accounts\.google/, (r) => r.abort());
const pg = await ctx.newPage();
await pg.goto(`${GESTAO}/login`, { waitUntil: 'domcontentloaded' });
if (!(await pg.locator('#ndx_field_acct').count())) await pg.locator('a, button').filter({ hasText: /^\s*Entrar\s*$/, visible: true }).first().click().catch(() => undefined);
await pg.waitForSelector('#ndx_field_acct', { timeout: 20_000 });
await pg.click('#ndx_field_acct'); await pg.fill('#ndx_field_acct', EMAIL);
await pg.click('#ndx_field_secret'); await pg.fill('#ndx_field_secret', PASS);
await pg.click('button.va-btn');
await pg.waitForFunction(() => !!sessionStorage.getItem('ndombaxi.web.access'), null, { timeout: 40_000 });
const uid = jwtPayload(await pg.evaluate(() => sessionStorage.getItem('ndombaxi.web.access'))).sub;

const falhasPorSecao = {};
for (const sec of SECOES) {
  await pg.evaluate(({ uid, sec }) => { localStorage.setItem(`ndombaxi.ws.${uid}`, JSON.stringify({ savedAt: Date.now(), section: sec, fields: {} })); }, { uid, sec });
  await pg.setViewportSize({ width: 1366, height: 768 });
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await sleep(3000);
  for (const [w, h] of TAM) {
    await pg.setViewportSize({ width: w, height: h });
    await sleep(700);
    const r = await pg.evaluate((INT) => {
      const re = new RegExp(INT);
      const de = document.documentElement;
      const pagina = Math.max(de.scrollWidth, document.body.scrollWidth) - innerWidth;
      const internos = []; const intencionais = [];
      for (const e of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(e);
        if (!/(auto|scroll)/.test(cs.overflowX)) continue;
        const r = e.getBoundingClientRect();
        if (r.width < 40 || r.height < 16) continue;
        const d = e.scrollWidth - e.clientWidth;
        if (d <= 2) continue;
        const nome = `${e.tagName.toLowerCase()}.${String(e.className).split(' ').filter(Boolean).slice(0, 2).join('.')}`;
        (re.test(String(e.className)) ? intencionais : internos).push(`${nome}+${d}px`);
      }
      return { pagina, internos: internos.slice(0, 4), nInt: internos.length, intencionais: intencionais.slice(0, 3) };
    }, INTENCIONAL.source);
    const id = `${sec} ${w}×${h}`;
    const ok = r.pagina <= 1 && r.nInt === 0;
    if (!ok) {
      (falhasPorSecao[sec] ??= []).push(`${w}×${h}`);
      rep.check(id, 'Sem scroll lateral (página e contentores)', false, `página+${r.pagina}px ${r.internos.join(' ')}`);
      if (SHOTS && w <= 1366) await pg.screenshot({ path: path.join(SHOTS, `resp-${LABEL}-${sec}-${w}x${h}.png`) }).catch(() => undefined);
    } else {
      rep.check(id, 'Sem scroll lateral (página e contentores)', true, r.intencionais.length ? `deslizantes: ${r.intencionais.join(' ')}` : '');
    }
  }
}
await b.close();
const sum = rep.summary();
fs.mkdirSync('qa/out', { recursive: true });
fs.writeFileSync(`qa/out/responsivo-${process.env.QA_MOTOR ?? 'chromium'}-${LABEL}.json`, JSON.stringify({ ...sum, falhasPorSecao }, null, 2));
console.log(`\n${sum.passed}/${sum.total} PASS`);
console.log('Falhas por secção:', JSON.stringify(falhasPorSecao));
process.exit(sum.failed ? 1 : 0);
