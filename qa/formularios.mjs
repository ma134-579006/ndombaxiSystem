/**
 * QA — formulários da Gestão (missão QA, fase 5). Só contra a Gestão local + API de QA.
 *
 * Para cada secção com botão «Novo…/Adicionar…/Criar…»:
 *   F1  o formulário abre e todos os campos visíveis têm nome acessível
 *       (label, aria-label ou label envolvente — placeholder sozinho não conta);
 *   F2  nada sai do formulário (sem scroll lateral, telemóvel 390 e desktop 1366);
 *   F3  submeter VAZIO não grava (nenhum POST/PUT/PATCH aceite com 2xx);
 *   F4  duplo clique em «Guardar/Criar» com os campos preenchidos envia UMA só
 *       escrita (sem registos duplicados).
 * Dados sintéticos «QA …». Emulado — não é dispositivo real.
 * Uso: node qa/formularios.mjs <url-gestão> [rótulo]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Report, jwtPayload } from './lib.mjs';

const [GESTAO = 'http://localhost:5183', LABEL = 'atual'] = process.argv.slice(2);
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(GESTAO)) throw new Error('Só local.');
const require = createRequire(path.join(process.env.QA_PLAYWRIGHT ?? '.', 'package.json'));
const pw = require('playwright-core');
const EMAIL = process.env.QA_GESTOR ?? 'admin@grupo-kwanza.qa.test';
const PASS = 'QaTeste!2026x'; // senha sintética do qa/seed-empresa.mjs
const rep = new Report(`formularios (${LABEL})`);
const SHOTS = process.env.QA_SHOTS;

const SECOES = (process.env.QA_SECOES ?? 'customers,products,purchasing-suppliers,expenses,employees,users,stores,promotions,leave,payables').split(',');
const NOVO = /^\s*(\+\s*)?(Novo|Nova|Adicionar|Criar|Registar|Lançar)\b/i;
const GRAVAR = /^\s*(Criar|Guardar|Gravar|Adicionar|Registar|Lançar|Confirmar|Salvar)\b/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function abrirSecao(pg, uid, sec) {
  await pg.evaluate(({ uid, sec }) => { localStorage.setItem(`ndombaxi.ws.${uid}`, JSON.stringify({ savedAt: Date.now(), section: sec, fields: {} })); }, { uid, sec });
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await sleep(3500);
}
const escritas = [];
for (const vp of [{ nome: 'Desktop', w: 1366, h: 768 }, { nome: 'Telemóvel', w: 390, h: 844, mobile: true }]) {
  const b = await pw.chromium.launch();
  // Login em largura de desktop (no telemóvel o «Entrar» está no menu da landing); depois o tamanho real.
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, ...(vp.mobile ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.route(/onrender\.com|lpsvendas|vendus\.co|connect\.facebook|accounts\.google/, (r) => r.abort());
  const pg = await ctx.newPage();
  pg.on('response', (r) => { const m = r.request().method(); if (m !== 'GET' && m !== 'OPTIONS' && r.url().includes('/papi/') && !/\/auth\/|\/preferences|\/presence|\/heartbeat|\/telemetry|\/notifications/.test(r.url())) escritas.push({ m, url: r.url().replace(/.*\/papi/, ''), s: r.status(), t: Date.now() }); });
  await pg.goto(`${GESTAO}/login`, { waitUntil: 'domcontentloaded' });
  // Na Gestão o login vive dentro da landing: abre-o se for preciso.
  if (!(await pg.locator('#ndx_field_acct').count())) await pg.locator('a, button').filter({ hasText: /^\s*Entrar\s*$/, visible: true }).first().click().catch(() => undefined);
  await pg.waitForSelector('#ndx_field_acct', { timeout: 20_000 });
  await pg.click('#ndx_field_acct'); await pg.fill('#ndx_field_acct', EMAIL);
  await pg.click('#ndx_field_secret'); await pg.fill('#ndx_field_secret', PASS);
  await pg.click('button.va-btn');
  await pg.waitForFunction(() => !!sessionStorage.getItem('ndombaxi.web.access'), null, { timeout: 40_000 });
  await pg.setViewportSize({ width: vp.w, height: vp.h });
  const uid = jwtPayload(await pg.evaluate(() => sessionStorage.getItem('ndombaxi.web.access'))).sub;
  for (const sec of SECOES) {
    const id = `${vp.nome} · ${sec}`;
    try {
      await abrirSecao(pg, uid, sec);
      // Só botões com TEXTO «Adicionar…/Novo…» fora da barra de topo (o «+» do topo abre um menu rápido).
      const novo = pg.locator('button:not(.topbar *):not(.tb *)').filter({ hasText: NOVO, visible: true }).first();
      if (!(await novo.count())) { rep.check(`F1 ${id}`, 'Formulário «Novo…» encontrado', false, 'sem botão Novo/Adicionar/Criar visível'); continue; }
      await novo.click({ timeout: 8000 }); await sleep(1200);
      let dlg = pg.locator('[role="dialog"], .modal, .vw-bg').filter({ visible: true }).last();
      // Formulário em PÁGINA (ex.: Produtos): a área principal é o contentor.
      if (!(await dlg.count())) dlg = pg.locator('.main, main').filter({ visible: true }).first();
      if (!(await dlg.count())) { rep.check(`F1 ${id}`, 'Formulário abre', false, 'nenhuma janela abriu'); continue; }
      // F1 + F2
      const a = await dlg.evaluate((d) => {
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
        const campos = [...d.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea')].filter(vis);
        const semNome = campos.filter((c) => {
          if (c.getAttribute('aria-label') || c.getAttribute('aria-labelledby') || c.title) return false;
          if (c.id && d.ownerDocument.querySelector(`label[for="${CSS.escape(c.id)}"]`)) return false;
          if (c.closest('label')) return false;
          return true;
        }).map((c) => c.placeholder || c.name || c.type);
        const lat = Math.max(...[d, ...d.querySelectorAll('*')].map((e) => (getComputedStyle(e).overflowX === 'visible' ? 0 : e.scrollWidth - e.clientWidth)), document.documentElement.scrollWidth - innerWidth);
        return { n: campos.length, semNome, lat };
      });
      rep.check(`F1 ${id}`, 'Todos os campos têm nome acessível', a.semNome.length === 0, a.semNome.length ? `${a.semNome.length}/${a.n} sem nome: ${a.semNome.slice(0, 4).join(', ')}` : `${a.n} campos`);
      rep.check(`F2 ${id}`, 'Sem scroll lateral no formulário', a.lat <= 1, `${a.lat}px`);
      // F3: submeter vazio
      const gravar = dlg.getByRole('button', { name: GRAVAR }).filter({ visible: true }).last();
      if (!(await gravar.count())) { rep.check(`F3 ${id}`, 'Botão de gravar encontrado', false, 'não encontrado'); await pg.keyboard.press('Escape'); continue; }
      let i0 = escritas.length;
      await gravar.click({ timeout: 5000 }).catch(() => undefined); await sleep(1500);
      const aceitesVazio = escritas.slice(i0).filter((w) => w.s < 300);
      rep.check(`F3 ${id}`, 'Submeter vazio não grava', aceitesVazio.length === 0, aceitesVazio.map((w) => `${w.m} ${w.url} ${w.s}`).join(' | ') || 'nada gravado');
      // F4: preencher e duplo clique (só desktop, para não duplicar dados de teste)
      if (vp.nome === 'Desktop' && await dlg.isVisible().catch(() => false)) {
        const tag = `QA F5 ${sec} ${Date.now() % 100000}`;
        await dlg.evaluate((d, tag) => {
          const set = (el, v) => { const p = Object.getPrototypeOf(el); const s = Object.getOwnPropertyDescriptor(p, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
          for (const c of d.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea')) {
            if (c.disabled || c.readOnly || c.value) continue;
            const t = (c.type || 'text').toLowerCase(); const k = `${c.name} ${c.id} ${c.placeholder} ${c.getAttribute('aria-label') || ''}`.toLowerCase();
            if (t === 'email' || /mail/.test(k)) set(c, `qa.f5.${Date.now() % 1e6}@exemplo.qa.test`);
            else if (t === 'number') set(c, '10');
            else if (t === 'date') set(c, new Date().toISOString().slice(0, 10));
            else if (t === 'tel' || /telef|phone|tel/.test(k)) set(c, '923000000');
            else if (/nif|tax/.test(k)) set(c, '5000000000');
            else if (/pre[cç]o|valor|montante|price|amount|custo/.test(k)) set(c, '100');
            else set(c, tag);
          }
          for (const s of d.querySelectorAll('select')) if (!s.value && s.options.length > 1) { s.selectedIndex = 1; s.dispatchEvent(new Event('change', { bubbles: true })); }
        }, tag);
        await sleep(300);
        i0 = escritas.length;
        await gravar.dblclick({ timeout: 5000 }).catch(() => undefined);
        await sleep(3500);
        const ws = escritas.slice(i0).filter((w) => w.m === 'POST' || w.m === 'PUT' || w.m === 'PATCH');
        const ok = ws.filter((w) => w.s < 300);
        // Mesma escrita repetida = duplicado.
        const porUrl = {}; for (const w of ok) porUrl[`${w.m} ${w.url.split('?')[0]}`] = (porUrl[`${w.m} ${w.url.split('?')[0]}`] ?? 0) + 1;
        const dup = Object.entries(porUrl).filter(([, n]) => n > 1);
        rep.check(`F4 ${id}`, 'Duplo clique em gravar envia uma só escrita', dup.length === 0,
          ws.length ? ws.map((w) => `${w.m} ${w.url.split('?')[0]} ${w.s}`).join(' | ') : 'nenhuma escrita (validação do formulário?)');
      }
      if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, `form-${LABEL}-${vp.nome}-${sec}.png`) });
      await pg.keyboard.press('Escape'); await sleep(400);
    } catch (e) {
      rep.check(`F1 ${id}`, 'Formulário', false, e.message.split('\n')[0]);
    }
  }
  await b.close();
}
const sum = rep.summary();
fs.mkdirSync('qa/out', { recursive: true });
fs.writeFileSync(`qa/out/formularios-${LABEL}.json`, JSON.stringify(sum, null, 2));
console.log(`\n${sum.passed}/${sum.total} PASS`);
process.exit(sum.failed ? 1 : 0);
