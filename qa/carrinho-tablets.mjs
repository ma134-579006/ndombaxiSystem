/**
 * QA — carrinho da Caixa em tablets (missão QA, fase 4). Só contra o vite local.
 *
 * Com 7 artigos no carrinho, em cada tamanho verifica:
 *   C1  sem scroll lateral (página e dentro do carrinho);
 *   C2  TOTAL, Opções e FINALIZAR inteiros dentro do ecrã;
 *   C3  a 1.ª linha do carrinho está visível e o nome não sai da linha;
 *   C4  os botões das linhas têm alvo de toque ≥ 32 px;
 *   C5  a lista do carrinho rola quando não cabe (a última linha é alcançável).
 * Emulado (Chromium/WebKit com perfis de tablet) — NÃO é dispositivo real.
 * LEGACY=1: simula um motor ANTIGO invalidando no CSS color-mix(), dvh/svh/lvh,
 *   :has() e container queries — o motor descarta essas regras como um Chrome < 105
 *   / Safari < 15.4 (o JS já sai em ES2019 no build).
 * Uso: node qa/carrinho-tablets.mjs <url-caixa> [rótulo]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Report } from './lib.mjs';

const [CAIXA = 'http://localhost:5181', LABEL = 'correcao'] = process.argv.slice(2);
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(CAIXA)) throw new Error('Só local.');
const require = createRequire(path.join(process.env.QA_PLAYWRIGHT ?? '.', 'package.json'));
const pw = require('playwright-core');
const state = JSON.parse(fs.readFileSync(process.env.QA_STATE ?? 'qa/.state.json', 'utf8'));
const op = state.users[process.env.QA_USER ?? 'gerente-sup1@grupo-kwanza.qa.test'];
const rep = new Report(`carrinho-tablets (${LABEL})`);
const OUT = process.env.QA_SHOTS;
const LEGACY = process.env.LEGACY === '1';
const degradar = (t) => t
  .replace(/color-mix\(/g, 'color-mixx(')
  .replace(/(\d)(dvh|svh|lvh|dvw|svw|lvw|cqw|cqh|cqi|cqb|cqmin|cqmax)\b/g, '$1$2x')
  .replace(/:has\(/g, ':hasx(')
  .replace(/@container\b/g, '@containerx');

const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ATAB = 'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const perfis = [
  { nome: 'iPad 768×1024', motor: pw.webkit, vp: [768, 1024], ua: IPAD },
  { nome: 'iPad 1024×768', motor: pw.webkit, vp: [1024, 768], ua: IPAD },
  { nome: 'iPad Air 820×1180', motor: pw.webkit, vp: [820, 1180], ua: IPAD },
  { nome: 'iPad Air 1180×820', motor: pw.webkit, vp: [1180, 820], ua: IPAD },
  { nome: 'Android tab 800×1280', motor: pw.chromium, vp: [800, 1280], ua: ATAB, mobile: true },
  { nome: 'Android tab 1280×800', motor: pw.chromium, vp: [1280, 800], ua: ATAB, mobile: true },
  { nome: 'Tablet 7" 600×960', motor: pw.chromium, vp: [600, 960], ua: ATAB, mobile: true },
  { nome: 'Tablet 7" 960×600', motor: pw.chromium, vp: [960, 600], ua: ATAB, mobile: true },
];

for (const p of perfis) {
  const b = await p.motor.launch();
  const ctx = await b.newContext({ viewport: { width: p.vp[0], height: p.vp[1] }, hasTouch: true, userAgent: p.ua, ...(p.mobile ? { isMobile: true } : {}) });
  await ctx.route(/onrender\.com|lpsvendas|vendus\.co|connect\.facebook|accounts\.google/, (r) => r.abort());
  if (LEGACY) await ctx.route(/\.css(\?|$)/, async (route) => { const res = await route.fetch(); route.fulfill({ response: res, body: degradar(await res.text()) }); });
  const pg = await ctx.newPage();
  await pg.goto(CAIXA, { waitUntil: 'networkidle' }).catch(() => {});
  await pg.click('#ndx_field_acct'); await pg.fill('#ndx_field_acct', op.email);
  await pg.click('input[placeholder="PIN"]'); await pg.fill('input[placeholder="PIN"]', op.pin);
  await pg.click('button.va-btn');
  await pg.waitForTimeout(6000);
  for (let k = 0; k < 3 && await pg.locator('.vclosed-open').count(); k++) {
    await pg.waitForTimeout(1500); await pg.locator('.vclosed-open').first().click({ timeout: 8000 }).catch(() => undefined); await pg.waitForTimeout(4000);
  }
  // 7 artigos diferentes no carrinho.
  const tiles = pg.locator('button[aria-label*="em stock"]');
  await tiles.first().waitFor({ timeout: 20_000 }).catch(() => undefined);
  const n = await pg.locator('.vline').count();
  for (let i = n; i < 7; i++) { await tiles.nth(i).click({ timeout: 8000 }).catch(() => undefined); await pg.waitForTimeout(250); }
  await pg.waitForTimeout(800);
  const m = await pg.evaluate(() => {
    const vw = innerWidth; const vh = innerHeight;
    const de = document.documentElement;
    const box = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const dentro = (r) => !!r && r.w > 0 && r.l >= -0.5 && r.t >= -0.5 && r.r <= vw + 0.5 && r.b <= vh + 0.5;
    const cart = document.querySelector('.vcart');
    const lines = [...document.querySelectorAll('.vline')];
    const first = lines[0]?.getBoundingClientRect();
    const cbox = document.querySelector('.vcart-box')?.getBoundingClientRect();
    const nomeCortado = lines.some((l) => { const n = l.querySelector('.vline-main, .vline-name') ?? l; return n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).textOverflow !== 'ellipsis'; });
    const alvos = [...document.querySelectorAll('.vline button, .vline-ctl button')].filter((x) => x.getBoundingClientRect().width > 0).map((x) => { const r = x.getBoundingClientRect(); return Math.min(r.width, r.height); });
    const lista = lines[0]?.parentElement;
    return {
      lateral: Math.max(de.scrollWidth - vw, cart ? cart.scrollWidth - cart.clientWidth : 0),
      total: dentro(box('.vtotal')), fin: dentro(box('.vfinal')), opc: dentro(box('.vopt-btn')),
      linhas: lines.length, primeira: !!first && !!cbox && first.top >= cbox.top - 1 && first.bottom <= cbox.bottom + 1 && first.height > 0,
      nomeCortado, alvoMin: alvos.length ? Math.round(Math.min(...alvos)) : null,
      rola: !!lista && (lista.scrollHeight <= lista.clientHeight + 1 || ['auto', 'scroll'].includes(getComputedStyle(lista).overflowY)),
      cartH: cbox ? Math.round(cbox.height) : 0,
    };
  });
  const id = p.nome;
  rep.check(`C1 ${id}`, 'Sem scroll lateral', m.lateral <= 1, `${m.lateral}px`);
  rep.check(`C2 ${id}`, 'TOTAL, Opções e FINALIZAR dentro do ecrã', m.total && m.fin && m.opc, `total=${m.total} opções=${m.opc} finalizar=${m.fin}`);
  rep.check(`C3 ${id}`, '1.ª linha visível, nome sem sair da linha', m.linhas > 0 && m.primeira && !m.nomeCortado, `linhas=${m.linhas} caixa=${m.cartH}px`);
  rep.check(`C4 ${id}`, 'Botões das linhas ≥ 32 px', m.alvoMin === null || m.alvoMin >= 32, `mín=${m.alvoMin}px`);
  rep.check(`C5 ${id}`, 'Lista do carrinho rola quando não cabe', m.rola);
  if (OUT) await pg.screenshot({ path: path.join(OUT, `carrinho-${LABEL}-${p.vp.join('x')}.png`) });
  await b.close();
}
const sum = rep.summary();
fs.mkdirSync('qa/out', { recursive: true });
fs.writeFileSync(`qa/out/carrinho-tablets-${LABEL}.json`, JSON.stringify(sum, null, 2));
console.log(`\n${sum.passed}/${sum.total} PASS`);
process.exit(sum.failed ? 1 : 0);
