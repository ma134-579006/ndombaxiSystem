/**
 * QA — toda a janela da Caixa tem um botão de FECHAR visível, dentro do ecrã e
 * sem nada por cima, e fechar funciona (missão QA, fase 3). Só contra o vite local.
 *
 * Perfis emulados: Android (Chromium 412×915), iPhone (WebKit 390×844),
 * iPad em pé (WebKit 820×1180) e desktop (Chromium 1366×768). NÃO são
 * dispositivos reais.
 * Uso: node qa/modais-x.mjs <url-caixa> [rótulo]
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
// Gerente de loja: é quem vê «Cancelar» em Faturação (canCancel).
const op = state.users[process.env.QA_USER ?? 'gerente-sup1@grupo-kwanza.qa.test'];
const rep = new Report(`modais-x (${LABEL})`);

const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const perfis = [
  { nome: 'Android', motor: pw.chromium, opts: { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, userAgent: UA_ANDROID } },
  { nome: 'iPhone', motor: pw.webkit, opts: { viewport: { width: 390, height: 844 }, hasTouch: true, userAgent: UA_IOS } },
  { nome: 'iPad', motor: pw.webkit, opts: { viewport: { width: 820, height: 1180 }, hasTouch: true, userAgent: UA_IPAD } },
  { nome: 'Desktop', motor: pw.chromium, opts: { viewport: { width: 1366, height: 768 } } },
];
const MENU = "button[aria-label='Menu da caixa']";
const janelas = [
  { nome: 'Opções da venda', passos: ['.vopt-btn'] },
  { nome: 'Opções › Cliente', passos: ['.vopt-btn', 'text=Cliente'] },
  { nome: 'Finalizar venda', passos: ['.vfinal'] },
  { nome: 'Entrada / Saída de dinheiro', passos: [MENU, 'text=Entrada / Saída de dinheiro'], desktop: ['btn=Caixa', '.vtop-drop >> text=Entrada / Saída de dinheiro'] },
  { nome: 'Ponto de Caixa', passos: [MENU, 'text=Ponto de Caixa'], desktop: ['btn=Caixa', '.vtop-drop >> text=Ponto de Caixa'] },
  { nome: 'Autoconsumo', passos: [MENU, 'text=Autoconsumo'], desktop: ['btn=Autoconsumo', '.vtop-drop >> text=Registar'] },
  { nome: 'Faturação', passos: [MENU, 'text=Faturação'], desktop: ['btn=Documentos', '.vtop-drop >> text=Faturação'] },
  { nome: 'Faturação › Cancelar artigos (anular venda)', passos: [MENU, 'text=Faturação', '.sales-table button.btn.danger'], desktop: ['btn=Documentos', '.vtop-drop >> text=Faturação', '.sales-table button.btn.danger'] },
];
const RAIZ = '.vw-bg, .vfin-bg, .modal-bg, .scan-overlay, .vopts';
const FECHAR = '[aria-label="Fechar"], [aria-label="Close"], .vfin-x, .vfin-close, .vw-x, .modal-x-auto, .vopts-x';

async function clicar(pg, s) {
  // Menu hambúrguer só existe em ecrã estreito; no desktop os itens estão na barra.
  if (s === MENU && !(await pg.locator(MENU).first().isVisible().catch(() => false))) return;
  const loc = s.startsWith('btn=') ? pg.getByRole('button', { name: new RegExp(`^\\s*${s.slice(4)}`) }).first() : s.startsWith('text=') ? pg.getByText(s.slice(5), { exact: false }).first() : pg.locator(s).first();
  await loc.click({ timeout: 10_000 });
  await pg.waitForTimeout(900);
}

/** A janela de cima: o último elemento-raiz visível. Devolve o fecho visível dela. */
async function fechoVisivel(pg) {
  return pg.evaluate(({ RAIZ, FECHAR }) => {
    const raizes = [...document.querySelectorAll(RAIZ)].filter((e) => e.getBoundingClientRect().height > 0);
    if (!raizes.length) return { ok: false, motivo: 'nenhuma janela aberta' };
    const top = raizes.sort((a, b) => (Number(getComputedStyle(b).zIndex) || 0) - (Number(getComputedStyle(a).zIndex) || 0))[0];
    const vw = innerWidth; const vh = innerHeight;
    for (const b of top.querySelectorAll(FECHAR)) {
      const r = b.getBoundingClientRect();
      if (r.width < 16 || r.height < 16) continue;
      const dentro = r.left >= 0 && r.top >= 0 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5;
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const livre = !!el && (el === b || b.contains(el));
      if (dentro && livre) { document.querySelectorAll('[data-qa-fecho]').forEach((x) => x.removeAttribute('data-qa-fecho')); b.setAttribute('data-qa-fecho', '1'); return { ok: true, raiz: top.className, tam: `${Math.round(r.width)}×${Math.round(r.height)}`, sel: b.className || b.getAttribute('aria-label') }; }
    }
    return { ok: false, motivo: `sem fecho visível em ${top.className}` };
  }, { RAIZ, FECHAR });
}

for (const p of perfis) {
  const b = await p.motor.launch();
  const ctx = await b.newContext(p.opts);
  await ctx.route(/onrender\.com|lpsvendas|vendus\.co|connect\.facebook|accounts\.google/, (r) => r.abort());
  const pg = await ctx.newPage();
  await pg.goto(CAIXA, { waitUntil: 'networkidle' }).catch(() => {});
  await pg.click('#ndx_field_acct'); await pg.fill('#ndx_field_acct', op.email);
  await pg.click('input[placeholder="PIN"]'); await pg.fill('input[placeholder="PIN"]', op.pin);
  await pg.click('button.va-btn');
  await pg.waitForTimeout(6000);
  // Caixa fechada: abre o turno (dados sintéticos). O painel anima — espera e repete.
  for (let k = 0; k < 3 && await pg.locator('.vclosed-open').count(); k++) {
    await pg.waitForTimeout(1500);
    await pg.locator('.vclosed-open').first().click({ timeout: 8000 }).catch(() => undefined);
    await pg.waitForTimeout(4000);
  }
  // Carrinho com um artigo (para "Finalizar" e "Cancelar venda").
  if (await pg.locator('.vline, .cart-line').count() === 0) await pg.locator('button[aria-label*="em stock"]').first().click({ timeout: 15_000 }).catch(() => {});
  await pg.waitForTimeout(800);
  for (const j of janelas) {
    const id = `${p.nome} · ${j.nome}`;
    try {
      for (const s of (p.nome === 'Desktop' && j.desktop) ? j.desktop : j.passos) await clicar(pg, s);
      const f = await fechoVisivel(pg);
      if (!f.ok) { rep.check(id, 'Botão de fechar visível', false, f.motivo); await pg.keyboard.press('Escape'); await pg.reload(); await pg.waitForTimeout(5000); continue; }
      const antes = await pg.locator(RAIZ).count();
      await pg.locator('[data-qa-fecho]').click({ timeout: 5000 });
      await pg.waitForTimeout(700);
      const depois = await pg.locator(RAIZ).filter({ visible: true }).count();
      rep.check(id, 'Botão de fechar visível e fecha a janela', depois < antes, `${f.sel} ${f.tam}`);
      // Janelas empilhadas (ex.: Faturação por baixo de Cancelar artigos): fecha o resto.
      for (let k = 0; k < 3 && await pg.locator(RAIZ).filter({ visible: true }).count(); k++) {
        const g = await fechoVisivel(pg);
        if (g.ok) await pg.locator('[data-qa-fecho]').click({ timeout: 3000 }).catch(() => undefined); else await pg.keyboard.press('Escape');
        await pg.waitForTimeout(500);
      }
    } catch (e) {
      rep.check(id, 'Janela abriu', false, e.message.split('\n')[0]);
      await pg.reload().catch(() => {}); await pg.waitForTimeout(5000);
    }
  }
  await b.close();
}
const sum = rep.summary();
fs.mkdirSync('qa/out', { recursive: true });
fs.writeFileSync(`qa/out/modais-x-${LABEL}.json`, JSON.stringify(sum, null, 2));
console.log(`\n${sum.passed}/${sum.total} PASS`);
process.exit(sum.failed ? 1 : 0);
