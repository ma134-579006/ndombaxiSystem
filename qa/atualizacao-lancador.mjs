// Atualização obrigatória no LANÇADOR (Android e Windows) — teste em navegador real.
// Uso: node qa/atualizacao-lancador.mjs   (PW = pasta com o playwright instalado)
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(process.env.PW || repo, 'package.json'));
const { chromium } = (() => { try { return require('playwright'); } catch { return require('playwright-core'); } })();

const MOB = path.join(repo, 'apps/mobile-shell/launcher');
const DESK = path.join(repo, 'apps/desktop/resources/modules/launcher');
const API = 'https://api.teste.invalid';
const rel = (platform, version, extra = {}) => ({ platform, version, minSupported: null, downloadPageUrl: 'https://lpsvendas.com.de/baixar', mandatory: true, notes: [], fixes: [], ...extra });

let falhas = 0;
const ok = (c, n, d = '') => { if (!c) falhas++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

async function abrir(browser, dir, { flag, api, desktop, ua }) {
  const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 360, height: 640 } });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  await page.route('http://app.local/**', async (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^\//, '') || 'index.html';
    if (p === 'native-flag.js') return route.fulfill({ contentType: 'text/javascript', body: flag ?? '' });
    if (p === 'update-check.js') return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(MOB, 'update-check.js')) });
    const f = path.join(dir, p);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ contentType: p.endsWith('.html') ? 'text/html' : p.endsWith('.js') ? 'text/javascript' : 'application/octet-stream', body: fs.readFileSync(f) });
  });
  let pedidos = 0;
  await page.route(`${API}/**`, (route) => { pedidos++; const r = api(new URL(route.request().url())); return r ? route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(r) }) : route.fulfill({ status: 503, body: '' }); });
  if (desktop) await page.addInitScript(desktop);
  await page.goto('http://app.local/index.html');
  await page.waitForTimeout(1800);
  const vis = await page.evaluate(() => { const e = document.getElementById('ndx-update'); return e ? { txt: e.innerText, r: e.getBoundingClientRect().toJSON() } : null; });
  return { ctx, page, vis, erros, pedidos: () => pedidos };
}

const flag = (v) => `window.__NDOMBAXI_NATIVE__=true;window.__NDOMBAXI_APP_VERSION__=${JSON.stringify(v)};window.__NDOMBAXI_API_URL__=${JSON.stringify(API)};window.__NDOMBAXI_APP_PLATFORM__='android';`;
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 9; SM-J600G Build/PPR1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/90.0.4430.91 Mobile Safari/537.36';

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
try {
  // 1. Android com versão antiga → tranca no lançador.
  let t = await abrir(browser, MOB, { flag: flag('3.5.0'), api: (u) => u.searchParams.get('platform') === 'android' ? rel('android', '3.5.7') : null, ua: ANDROID_UA });
  ok(!!t.vis && /3\.5\.0/.test(t.vis.txt) && /3\.5\.7/.test(t.vis.txt), 'Android 3.5.0 com 3.5.7 publicada: ecrã de atualização no lançador', t.vis && t.vis.txt.replace(/\s+/g, ' '));
  ok(t.vis && t.vis.r.width <= 360 && t.vis.r.height <= 640, 'ecrã cabe em 360×640');
  const [popup] = await Promise.all([t.page.waitForEvent('popup').catch(() => null), t.page.click('#ndx-update button')]);
  ok(!!popup && /lpsvendas\.com\.de\/baixar/.test(popup.url()), '«Atualizar Agora» abre a página oficial', popup && popup.url());
  ok(t.erros.length === 0, 'sem erros de JavaScript', t.erros.join(' | '));
  await t.ctx.close();
  // 2. Já atualizada → nada.
  t = await abrir(browser, MOB, { flag: flag('3.5.7'), api: () => rel('android', '3.5.7'), ua: ANDROID_UA });
  ok(!t.vis, 'Android já na 3.5.7: lançador normal'); await t.ctx.close();
  // 3. Sem rede → não tranca.
  t = await abrir(browser, MOB, { flag: flag('3.5.0'), api: () => null, ua: ANDROID_UA });
  ok(!t.vis && t.pedidos() > 0, 'servidor sem resposta: não tranca (e perguntou)'); await t.ctx.close();
  // 4. Canal de teste / outra plataforma → não tranca.
  t = await abrir(browser, MOB, { flag: flag('3.5.0'), api: () => rel('android', '9.9.9', { channel: 'beta' }), ua: ANDROID_UA });
  ok(!t.vis, 'versão do canal beta ignorada'); await t.ctx.close();
  t = await abrir(browser, MOB, { flag: flag('3.5.0'), api: () => rel('windows', '9.9.9'), ua: ANDROID_UA });
  ok(!t.vis, 'resposta de outra plataforma ignorada'); await t.ctx.close();
  // 5. Windows (Electron simulado): pergunta ao processo principal.
  const desk = (state) => `window.__abriu=0;window.ndombaxi={update:{check:function(){return Promise.resolve(${JSON.stringify(state)})},openDownloadPage:function(){window.__abriu++;return Promise.resolve()}},settings:{setModule:function(){}}};`;
  t = await abrir(browser, DESK, { desktop: desk({ state: 'mandatory', current: '3.5.0', release: { version: '3.5.7', downloadPageUrl: 'https://lpsvendas.com.de/baixar' } }) });
  ok(!!t.vis && /3\.5\.7/.test(t.vis.txt), 'Windows 3.5.0: ecrã de atualização no lançador');
  await t.page.click('#ndx-update button');
  ok(await t.page.evaluate(() => window.__abriu === 1), '«Atualizar Agora» chama o processo principal (abre a página e fecha)');
  ok(t.erros.length === 0, 'Windows: sem erros de JavaScript', t.erros.join(' | '));
  await t.ctx.close();
  t = await abrir(browser, DESK, { desktop: desk({ state: 'none', current: '3.5.7' }) });
  ok(!t.vis, 'Windows já atualizado: lançador normal'); await t.ctx.close();
} finally { await browser.close(); }
console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo PASS');
process.exit(falhas ? 1 : 0);
