/**
 * QA — login/registo no telemóvel (missão QA, fase 2). Só contra o vite local.
 *
 *   K1  com o teclado no ecrã (a janela encolhe: interactive-widget=resizes-content)
 *       o cartão do login NÃO encolhe (zoom 1) e o campo em edição fica visível;
 *   K2  ao fechar o teclado o cartão volta a caber sem scroll;
 *   F1  sem App ID do Facebook publicado, o botão "Entrar com Facebook" não aparece.
 *
 * Emulação: Chromium com perfil Android (412×915) e WebKit com perfil iPhone
 * (390×844). O teclado é emulado reduzindo a altura da janela — NÃO é um
 * dispositivo real.
 * Uso: node qa/login-teclado.mjs <url-caixa> <url-gestão> [rótulo]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Report } from './lib.mjs';

const [CAIXA = 'http://localhost:5181', GESTAO = 'http://localhost:5183', LABEL = 'correcao'] = process.argv.slice(2);
for (const u of [CAIXA, GESTAO]) if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(u)) throw new Error('Só local.');
const require = createRequire(path.join(process.env.QA_PLAYWRIGHT ?? '.', 'package.json'));
const pw = require('playwright-core');
const rep = new Report(`login-teclado (${LABEL})`);

const perfis = [
  { nome: 'Android', motor: pw.chromium, vp: { width: 412, height: 915 }, kb: 480,
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36' },
  { nome: 'iPhone', motor: pw.webkit, vp: { width: 390, height: 844 }, kb: 500,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
];
const ecras = [
  { nome: 'Caixa', url: `${CAIXA}/`, native: false },
  { nome: 'Gestão', url: `${GESTAO}/`, native: true }, // na app o login abre logo
];

for (const p of perfis) {
  const b = await p.motor.launch();
  for (const e of ecras) {
    const ctx = await b.newContext({ viewport: p.vp, isMobile: p.motor !== pw.webkit ? true : undefined, hasTouch: true, userAgent: p.ua });
    await ctx.route(/onrender\.com|lpsvendas|vendus\.co|connect\.facebook|accounts\.google/, (r) => r.abort());
    if (e.native) await ctx.addInitScript(() => { window.__NDOMBAXI_NATIVE__ = true; });
    const pg = await ctx.newPage();
    await pg.goto(e.url, { waitUntil: 'networkidle' }).catch(() => {});
    await pg.waitForSelector('#ndx_field_acct', { timeout: 30_000 });
    await pg.waitForTimeout(800);
    const card = () => pg.evaluate(() => { const el = document.querySelector('.va-col'); const r = el.getBoundingClientRect(); return { zoom: Number(getComputedStyle(el).zoom || 1), w: Math.round(r.width) }; });
    const antes = await card();
    const id = `${p.nome}/${e.nome}`;
    if (!e.native) {
      const fb = await pg.locator('.va-social.f').count();
      rep.check(`F1 ${id}`, 'Sem App ID do Facebook: botão escondido', fb === 0, `botões=${fb}`);
    }
    await pg.tap('#ndx_field_acct');
    await pg.setViewportSize({ width: p.vp.width, height: p.kb });
    await pg.waitForTimeout(1200);
    const com = await card();
    const campo = await pg.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }; });
    rep.check(`K1 ${id}`, 'Teclado aberto: cartão não encolhe e campo visível',
      com.zoom === antes.zoom && com.w === antes.w && campo.top >= 0 && campo.bottom <= campo.vh,
      `zoom ${antes.zoom}→${com.zoom}, largura ${antes.w}→${com.w}, campo ${campo.top}-${campo.bottom}/${campo.vh}`);
    await pg.evaluate(() => document.activeElement.blur());
    await pg.setViewportSize(p.vp);
    await pg.waitForTimeout(800);
    const depois = await card();
    const scroll = await pg.evaluate(() => { const v = document.querySelector('.va'); return v.scrollHeight - v.clientHeight; });
    rep.check(`K2 ${id}`, 'Teclado fechado: volta a caber sem scroll', scroll <= 1 && depois.zoom === antes.zoom, `overflow=${scroll}px zoom=${depois.zoom}`);
    await ctx.close();
  }
  await b.close();
}
const sum = rep.summary();
fs.mkdirSync('qa/out', { recursive: true });
fs.writeFileSync(`qa/out/login-teclado-${LABEL}.json`, JSON.stringify(sum, null, 2));
console.log(`\n${sum.passed}/${sum.total} PASS`);
process.exit(sum.failed ? 1 : 0);
