/**
 * QA — Caixa em MOTORES ANTIGOS REAIS (missão QA, fase 4): Chromium 93 (Blink,
 * como as WebViews Android antigas) e WebKit 14.2 (o motor do Safari 14), ambos
 * sem dvh, :has() e color-mix(). Corre contra o BUILD DE PRODUÇÃO (JS em ES2019).
 * Só a API clássica do Playwright (a 1.12 é a que fala com estes motores).
 *
 *   A0  a app arranca sem erros de JS e o login funciona;
 *   A1  tablets (768×1024, 1024×768, 800×1280, 1280×800): sem scroll lateral, TOTAL/
 *       Opções/FINALIZAR no ecrã, fundo do TOTAL não transparente, lista rola,
 *       ✕ das linhas ≥ 32 px;
 *   A2  telemóvel (390×844): Opções com fecho visível e «Cancelar Venda» visível;
 *       fundo da janela não transparente;
 *   A3  Finalizar venda com fecho visível.
 *
 * Uso: QA_PW=<pasta com playwright-core@1.12.3> QA_OLD=<pasta dos motores>
 *      node qa/navegadores-antigos.mjs <url-build-caixa> [rótulo]
 * Os motores vêm do CDN oficial do Playwright (chromium rev. 888113, webkit rev. 1492).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Report } from './lib.mjs';

const [CAIXA = 'http://localhost:5191', LABEL = 'correcao'] = process.argv.slice(2);
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(CAIXA)) throw new Error('Só local.');
const require = createRequire(path.join(process.env.QA_PW, 'package.json'));
const { chromium, webkit } = require('playwright-core');
const OLD = process.env.QA_OLD;
const state = JSON.parse(fs.readFileSync(process.env.QA_STATE ?? 'qa/.state.json', 'utf8'));
const op = state.users[process.env.QA_USER ?? 'gerente-sup1@grupo-kwanza.qa.test'];
const rep = new Report(`navegadores-antigos (${LABEL})`);
const SHOTS = process.env.QA_SHOTS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const motores = [
  { nome: 'Chromium 93', motor: chromium, exe: path.join(OLD, 'chromium-888113/chrome-win/chrome.exe'), mobile: true,
    ua: 'Mozilla/5.0 (Linux; Android 11; SM-T505) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4530.0 Safari/537.36' },
  { nome: 'WebKit 14.2', motor: webkit, exe: path.join(OLD, 'webkit-1492/Playwright.exe'), mobile: false,
    ua: 'Mozilla/5.0 (iPad; CPU OS 14_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1' },
];

async function entrar(pg) {
  await pg.goto(CAIXA, { waitUntil: 'load' });
  await pg.waitForSelector('#ndx_field_acct', { timeout: 30_000 });
  await pg.click('#ndx_field_acct'); await pg.fill('#ndx_field_acct', op.email);
  await pg.click('input[placeholder="PIN"]'); await pg.fill('input[placeholder="PIN"]', op.pin);
  await pg.click('button.va-btn');
  await sleep(7000);
  for (let k = 0; k < 3 && await pg.$('.vclosed-open'); k++) { await sleep(1500); await pg.click('.vclosed-open', { timeout: 8000 }).catch(() => undefined); await sleep(4000); }
  return !(await pg.$('#ndx_field_acct'));
}
async function encherCarrinho(pg, n) {
  await pg.waitForSelector('button[aria-label*="em stock"]', { timeout: 20_000 }).catch(() => undefined);
  const tiles = await pg.$$('button[aria-label*="em stock"]');
  const ja = (await pg.$$('.vline')).length;
  for (let i = ja; i < n && i < tiles.length; i++) { await tiles[i].click().catch(() => undefined); await sleep(250); }
  await sleep(800);
}
const transparente = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);

for (const m of motores) {
  const b = await m.motor.launch({ executablePath: m.exe });
  // ── A1: tablets ───────────────────────────────────────────────────────────
  for (const vp of [[768, 1024], [1024, 768], [800, 1280], [1280, 800]]) {
    const ctx = await b.newContext({ viewport: { width: vp[0], height: vp[1] }, userAgent: m.ua, hasTouch: true, ...(m.mobile ? { isMobile: true } : {}) });
    await ctx.route(/onrender\.com|lpsvendas|vendus\.co|connect\.facebook|accounts\.google/, (r) => r.abort());
    const pg = await ctx.newPage();
    const erros = []; pg.on('pageerror', (e) => erros.push(e.message));
    const id = `${m.nome} ${vp.join('×')}`;
    const ok = await entrar(pg).catch(() => false);
    if (vp[0] === 768) rep.check(`A0 ${m.nome}`, 'App arranca sem erros de JS e o login funciona', ok && erros.length === 0, erros.slice(0, 2).join(' | ') || 'sem erros');
    if (!ok) { rep.check(`A1 ${id}`, 'Carrinho', false, 'login falhou'); await ctx.close(); continue; }
    await encherCarrinho(pg, 7);
    const r = await pg.evaluate(() => {
      const vw = innerWidth; const vh = innerHeight; const de = document.documentElement;
      const box = (s) => { const e = document.querySelector(s); if (!e) return null; const q = e.getBoundingClientRect(); return { l: q.left, t: q.top, r: q.right, b: q.bottom, w: q.width }; };
      const dentro = (q) => !!q && q.w > 0 && q.l >= -0.5 && q.t >= -0.5 && q.r <= vw + 0.5 && q.b <= vh + 0.5;
      const lines = [...document.querySelectorAll('.vline')];
      const lista = lines[0] && lines[0].parentElement;
      const dels = [...document.querySelectorAll('.vl-del')].map((x) => { const q = x.getBoundingClientRect(); return Math.min(q.width, q.height); });
      const tot = document.querySelector('.vtotal');
      return {
        lateral: de.scrollWidth - vw, total: dentro(box('.vtotal')), opc: dentro(box('.vopt-btn')), fin: dentro(box('.vfinal')),
        fundoTotal: tot ? getComputedStyle(tot).backgroundColor : null, linhas: lines.length,
        rola: !!lista && (lista.scrollHeight <= lista.clientHeight + 1 || ['auto', 'scroll'].includes(getComputedStyle(lista).overflowY)),
        delMin: dels.length ? Math.round(Math.min(...dels)) : null, paginaRola: de.scrollHeight - vh,
      };
    });
    rep.check(`A1 ${id}`, 'Carrinho: sem scroll lateral, TOTAL/Opções/FINALIZAR no ecrã, TOTAL com fundo, lista rola, ✕ ≥ 32 px',
      r.lateral <= 1 && r.total && r.opc && r.fin && !rest(r.fundoTotal) && r.rola && (r.delMin === null || r.delMin >= 32),
      `lateral=${r.lateral} total=${r.total} opções=${r.opc} finalizar=${r.fin} fundo=${r.fundoTotal} linhas=${r.linhas} ✕=${r.delMin}px página+${r.paginaRola}px`);
    if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, `antigo-real-${LABEL}-${m.nome.replace(/\W+/g, '')}-${vp.join('x')}.png`) });
    // ── A3: Finalizar (só no 1.º tamanho) ───────────────────────────────────
    if (vp[0] === 768) {
      await pg.click('.vfinal').catch(() => undefined); await sleep(1200);
      const f = await pg.evaluate(() => { const bg = document.querySelector('.vfin-bg'); if (!bg) return { ok: false, motivo: 'não abriu' };
        for (const x of bg.querySelectorAll('.vfin-x, .vfin-close, [aria-label="Fechar"]')) { const q = x.getBoundingClientRect(); const el = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
          if (q.width >= 16 && q.top >= 0 && q.bottom <= innerHeight && q.right <= innerWidth && el && (el === x || x.contains(el))) { x.setAttribute('data-qa-fecho', '1'); return { ok: true, sel: x.className }; } }
        return { ok: false, motivo: 'sem fecho visível' }; });
      let fechou = false;
      if (f.ok) { await pg.click('[data-qa-fecho]'); await sleep(700); fechou = !(await pg.$('.vfin-bg')); }
      rep.check(`A3 ${m.nome}`, 'Finalizar venda: fecho visível e fecha', f.ok && fechou, f.sel || f.motivo);
    }
    await ctx.close();
  }
  // ── A2: telemóvel — Opções da venda ───────────────────────────────────────
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, userAgent: m.ua, hasTouch: true, ...(m.mobile ? { isMobile: true } : {}) });
    await ctx.route(/onrender\.com|lpsvendas|vendus\.co|connect\.facebook|accounts\.google/, (r) => r.abort());
    const pg = await ctx.newPage();
    const ok = await entrar(pg).catch(() => false);
    if (ok) await encherCarrinho(pg, 1);
    await pg.click('.vopt-btn').catch(() => undefined); await sleep(1200);
    const o = await pg.evaluate(() => {
      const vw = innerWidth; const vh = innerHeight;
      const raiz = document.querySelector('.vw-bg') || document.querySelector('.vopts');
      if (!raiz) return { ok: false, motivo: 'Opções não abriram' };
      const btn = [...raiz.querySelectorAll('button')].find((x) => /Cancelar Venda/.test(x.textContent));
      const q = btn && btn.getBoundingClientRect();
      const el = q && document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      const cancelarVisivel = !!q && q.top >= 0 && q.bottom <= vh && (el === btn || btn.contains(el));
      let fecho = null;
      for (const x of raiz.querySelectorAll('[aria-label="Fechar"], .vw-x, .vopts-x')) { const r = x.getBoundingClientRect(); const e2 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (r.width >= 16 && r.top >= 0 && r.bottom <= vh && r.right <= vw && e2 && (e2 === x || x.contains(e2))) { x.setAttribute('data-qa-fecho', '1'); fecho = x.className; break; } }
      const fundo = getComputedStyle(raiz).backgroundImage !== 'none' ? getComputedStyle(raiz).backgroundImage : getComputedStyle(raiz).backgroundColor;
      return { ok: true, cancelarVisivel, fecho, fundo };
    });
    let fechou = false;
    if (o.fecho) { await pg.click('[data-qa-fecho]'); await sleep(700); fechou = !(await pg.$('.vw-bg')) && !(await pg.$('.vopts')); }
    if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, `antigo-real-${LABEL}-${m.nome.replace(/\W+/g, '')}-telemovel.png`) });
    rep.check(`A2 ${m.nome}`, 'Telemóvel: Opções com fecho visível, «Cancelar Venda» visível, fundo não transparente, fecha',
      ok && o.ok && o.cancelarVisivel && !!o.fecho && fechou && !rest(o.fundo), o.ok ? `cancelar=${o.cancelarVisivel} fecho=${o.fecho} fundo=${String(o.fundo).slice(0, 40)}` : o.motivo);
    await ctx.close();
  }
  await b.close();
}
function rest(c) { return transparente(c); }

const sum = rep.summary();
fs.mkdirSync('qa/out', { recursive: true });
fs.writeFileSync(`qa/out/navegadores-antigos-${LABEL}.json`, JSON.stringify(sum, null, 2));
console.log(`\n${sum.passed}/${sum.total} PASS`);
process.exit(sum.failed ? 1 : 0);
