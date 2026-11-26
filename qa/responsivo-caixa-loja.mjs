/**
 * QA — responsividade da CAIXA e da LOJA (missão QA, fase 6). Só local.
 * API clássica do Playwright (corre no playwright-core atual e no 1.12 dos motores antigos).
 *
 * Para cada página × tamanho: zero scroll lateral na página e dentro de contentores
 * (barras deslizantes por desenho — abas/categorias/carrosséis — listadas à parte).
 *
 * Variáveis: QA_PW (pasta do playwright-core), QA_MOTOR (chromium|webkit),
 *   QA_EXE (executável de um motor antigo, opcional), QA_TAMANHOS, QA_CAIXA, QA_LOJA,
 *   QA_LOJA_CODIGO (padrão grupo-kwanza-distribuicao-qa), QA_STATE.
 * Uso: node qa/responsivo-caixa-loja.mjs [rótulo]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Report } from './lib.mjs';

const LABEL = process.argv[2] ?? 'atual';
const CAIXA = process.env.QA_CAIXA ?? 'http://localhost:5191';
const LOJA = process.env.QA_LOJA ?? 'http://localhost:5193';
for (const u of [CAIXA, LOJA]) if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(u)) throw new Error('Só local.');
const require = createRequire(path.join(process.env.QA_PW ?? process.env.QA_PLAYWRIGHT ?? '.', 'package.json'));
const pw = require('playwright-core');
const motor = pw[process.env.QA_MOTOR ?? 'chromium'];
const EXE = process.env.QA_EXE;
const COD = process.env.QA_LOJA_CODIGO ?? 'grupo-kwanza-distribuicao-qa';
const state = JSON.parse(fs.readFileSync(process.env.QA_STATE ?? 'qa/.state.json', 'utf8'));
const op = state.users[process.env.QA_USER ?? 'gerente-sup1@grupo-kwanza.qa.test'];
const TAM = (process.env.QA_TAMANHOS ?? '240x320,320x568,390x844,768x1024,1024x768,1366x768,1920x1080,3840x2160').split(',').map((t) => t.split('x').map(Number));
const nomeMotor = `${process.env.QA_MOTOR ?? 'chromium'}${EXE ? ' (antigo)' : ''}`;
const rep = new Report(`responsivo caixa+loja ${nomeMotor} (${LABEL})`);
const SHOTS = process.env.QA_SHOTS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INT = 'tabs|tab-bar|chips|vtabs|vcat|carousel|scroller|cat-bar|ptabs|seg|banner|slider|swiper|strip|rail';

const medir = (page) => page.evaluate((intSrc) => {
  const re = new RegExp(intSrc);
  const de = document.documentElement;
  const pagina = Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0) - innerWidth;
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
  const fin = document.querySelector('.vfinal');
  let finalizar = null;
  if (fin) { const q = fin.getBoundingClientRect(); finalizar = q.width > 0 && q.top >= -0.5 && q.bottom <= innerHeight + 0.5 && q.right <= innerWidth + 0.5; }
  return { pagina, internos: internos.slice(0, 3), n: internos.length, intencionais: intencionais.slice(0, 2), finalizar };
}, INT);

const b = await motor.launch(EXE ? { executablePath: EXE } : {});
const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
await ctx.route(/onrender\.com|lpsvendas|vendus\.co|connect\.facebook|accounts\.google|googletagmanager|google-analytics/, (r) => r.abort());
const page = await ctx.newPage();

async function varrer(nome, prep) {
  for (const [w, h] of TAM) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(900);
    if (prep) await prep();
    const m = await medir(page);
    const ok = m.pagina <= 1 && m.n === 0 && m.finalizar !== false;
    rep.check(`${nome} ${w}×${h}`, 'Sem scroll lateral' + (m.finalizar === null ? '' : ' e FINALIZAR no ecrã'), ok,
      ok ? (m.intencionais.length ? `deslizantes: ${m.intencionais.join(' ')}` : '') : `página+${m.pagina}px ${m.internos.join(' ')}${m.finalizar === false ? ' FINALIZAR fora do ecrã' : ''}`);
    if (!ok && SHOTS) await page.screenshot({ path: path.join(SHOTS, `rcl-${LABEL}-${nomeMotor.replace(/\W+/g, '')}-${nome.replace(/\W+/g, '')}-${w}x${h}.png`) }).catch(() => undefined);
  }
}

// ── LOJA (pública) ──────────────────────────────────────────────────────────
const lojaPaginas = [
  ['Loja · início', `${LOJA}/${COD}`],
  ['Loja · associados', `${LOJA}/${COD}/associados`],
];
for (const [nome, url] of lojaPaginas) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(url, { waitUntil: 'load' }).catch(() => undefined);
  await sleep(4000);
  await varrer(nome);
}
// Produto: o 1.º link de produto que aparecer na loja.
await page.setViewportSize({ width: 1366, height: 768 });
await page.goto(`${LOJA}/${COD}`, { waitUntil: 'load' }).catch(() => undefined);
await sleep(4000);
// A loja abre o produto por estado (sem URL própria): toca no 1.º cartão de produto.
const cartao = await page.$('.go-card');
if (cartao) { await cartao.click().catch(() => undefined); await sleep(2500); await varrer('Loja · produto'); }
else rep.check('Loja · produto', 'Cartão de produto encontrado', false, 'sem .go-card na página inicial');

// ── CAIXA (com sessão e carrinho) ───────────────────────────────────────────
await page.setViewportSize({ width: 1366, height: 768 });
await page.goto(CAIXA, { waitUntil: 'load' });
await page.waitForSelector('#ndx_field_acct', { timeout: 30_000 });
await varrer('Caixa · login');
await page.setViewportSize({ width: 1366, height: 768 });
await page.click('#ndx_field_acct'); await page.fill('#ndx_field_acct', op.email);
await page.click('input[placeholder="PIN"]'); await page.fill('input[placeholder="PIN"]', op.pin);
await page.click('button.va-btn');
await sleep(7000);
for (let k = 0; k < 3 && await page.$('.vclosed-open'); k++) { await sleep(1500); await page.click('.vclosed-open', { timeout: 8000 }).catch(() => undefined); await sleep(4000); }
await page.waitForSelector('button[aria-label*="em stock"]', { timeout: 20_000 }).catch(() => undefined);
const tiles = await page.$$('button[aria-label*="em stock"]');
const ja = (await page.$$('.vline')).length;
for (let i = ja; i < 5 && i < tiles.length; i++) { await tiles[i].click().catch(() => undefined); await sleep(250); }
await varrer('Caixa · venda');

await b.close();
const sum = rep.summary();
fs.mkdirSync('qa/out', { recursive: true });
fs.writeFileSync(`qa/out/responsivo-caixa-loja-${nomeMotor.replace(/\W+/g, '')}-${LABEL}.json`, JSON.stringify(sum, null, 2));
console.log(`\n${sum.passed}/${sum.total} PASS`);
process.exit(sum.failed ? 1 : 0);
