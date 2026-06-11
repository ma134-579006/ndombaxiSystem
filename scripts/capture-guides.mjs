/**
 * CAPTURA DOS GUIAS VISUAIS DO BOT — screenshots REAIS do sistema com
 * marcações exatas (círculos numerados + rótulos) nos botões/campos certos.
 *
 * Pré-requisitos:
 *   • API local em http://localhost:3000 (node apps/api/dist/main.js)
 *   • previews: web 5175 · pos 5173 · store 5174 (pnpm --filter <app> preview)
 *   • puppeteer-core instalado (env PPTR_DIR aponta para a pasta com node_modules)
 *   • env SA_EMAIL / SA_PASS (super admin) e GUIDE_COMPANY (código da empresa de demonstração)
 *
 * Saída: apps/web/public/guides/*.png  (≈1120×700 @1.5x)
 * Correr: node scripts/capture-guides.mjs [só-um-guia]
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const requireFrom = createRequire(path.join(process.env.PPTR_DIR ?? process.cwd(), 'package.json'));
const puppeteer = requireFrom('puppeteer-core');

const API = process.env.GUIDE_API ?? 'http://localhost:3000';
const WEB = process.env.GUIDE_WEB ?? 'http://localhost:5175';
const POS = process.env.GUIDE_POS ?? 'http://localhost:5173';
const STORE = process.env.GUIDE_STORE ?? 'http://localhost:5174';
const COMPANY = process.env.GUIDE_COMPANY ?? 'ndombaxi';
const OUT = path.resolve('apps/web/public/guides');
const ONLY = process.argv[2];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) } });
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Login super admin → impersonation (shadow) da empresa de demonstração. */
async function getTokens() {
  const sa = await json(`${API}/auth/super-admin/login`, {
    method: 'POST',
    body: JSON.stringify({ email: process.env.SA_EMAIL, password: process.env.SA_PASS }),
  });
  const saTok = sa.accessToken ?? sa.tokens?.accessToken;
  const tenants = await json(`${API}/super-admin/tenants`, { headers: { authorization: `Bearer ${saTok}` } });
  const list = Array.isArray(tenants) ? tenants : tenants.items ?? [];
  const t = list.find((x) => (x.companyCode ?? x.code) === COMPANY) ?? list[0];
  if (!t) throw new Error('nenhuma empresa para impersonar');
  const imp = await json(`${API}/super-admin/tenants/${t.id}/impersonate`, {
    method: 'POST', headers: { authorization: `Bearer ${saTok}` }, body: JSON.stringify({}),
  });
  const tokens = imp.tokens ?? imp;
  return { tokens, companyCode: t.companyCode ?? t.code ?? COMPANY, companyName: t.companyName ?? t.name ?? '' };
}

/** Desenha as marcações (anel vermelho + número + rótulo) sobre elementos reais. */
async function annotate(page, marks) {
  await page.evaluate((marks) => {
    document.getElementById('guide-overlay')?.remove();
    // esconde elementos internos que não pertencem ao guia (barra do modo
    // shadow do super admin e o balão flutuante do chat)
    [...document.querySelectorAll('button')].forEach((b) => {
      if (b.textContent.includes('Sair do shadow')) { const p = b.parentElement; if (p) p.style.display = 'none'; }
    });
    document.querySelector('.sc-fab')?.style.setProperty('display', 'none');
    const ov = document.createElement('div');
    ov.id = 'guide-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:Segoe UI,Arial,sans-serif;';
    document.body.appendChild(ov);
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight; };
    const findByText = (txt) => [...document.querySelectorAll('button, a, [role=button], h2, h3, label')]
      .find((e) => visible(e) && e.textContent.replace(/\s+/g, ' ').trim().toLowerCase().includes(txt.toLowerCase()));
    marks.forEach((m, idx) => {
      let el = null;
      if (m.sel) el = [...document.querySelectorAll(m.sel)].find(visible) ?? null;
      if (!el && m.text) el = findByText(m.text) ?? null;
      if (!el) { console.warn('marca não encontrada', m); return; }
      const r = el.getBoundingClientRect();
      const ring = document.createElement('div');
      ring.style.cssText = `position:fixed;left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px;border:3.5px solid #ef4444;border-radius:14px;box-shadow:0 0 0 4px rgba(239,68,68,.22), 0 8px 24px rgba(239,68,68,.25);`;
      ov.appendChild(ring);
      const n = idx + 1;
      const badge = document.createElement('div');
      const bx = Math.max(6, r.left - 20), by = Math.max(6, r.top - 20);
      badge.style.cssText = `position:fixed;left:${bx}px;top:${by}px;width:30px;height:30px;border-radius:999px;background:#ef4444;color:#fff;font-weight:800;font-size:16px;display:grid;place-items:center;box-shadow:0 4px 12px rgba(239,68,68,.5);border:2.5px solid #fff;`;
      badge.textContent = String(n);
      ov.appendChild(badge);
      if (m.label) {
        const lab = document.createElement('div');
        const labY = m.labelRight ? Math.max(6, r.top + r.height / 2 - 16) : m.labelBelow ? r.bottom + 12 : Math.max(6, r.top - 22);
        const labX = m.labelRight ? Math.min(innerWidth - 290, r.right + 14) : Math.min(innerWidth - 280, bx + 38);
        lab.style.cssText = `position:fixed;left:${labX}px;top:${labY}px;max-width:280px;background:#0f1729;color:#fff;font-size:13.5px;font-weight:700;padding:7px 12px;border-radius:10px;box-shadow:0 8px 24px rgba(8,14,28,.45);line-height:1.3;`;
        lab.textContent = m.label;
        ov.appendChild(lab);
      }
    });
  }, marks);
  await sleep(250);
}

async function shot(page, name) {
  mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('✓', file);
}

/** Espera até a função (avaliada na página) devolver verdadeiro. */
async function waitEval(page, fn, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn)) return;
    await sleep(600);
  }
  throw new Error('waitEval: tempo esgotado');
}

async function clickText(page, txt, scope = 'button, a, [role=button]') {
  const ok = await page.evaluate(({ txt, scope }) => {
    const el = [...document.querySelectorAll(scope)]
      .find((e) => e.textContent.replace(/\s+/g, ' ').trim().toLowerCase().includes(txt.toLowerCase()));
    if (el) { el.click(); return true; }
    return false;
  }, { txt, scope });
  if (!ok) throw new Error(`não encontrei «${txt}»`);
  await sleep(900);
}

/** Entra no painel do gestor injetando os tokens (shadow) no sessionStorage. */
async function gestorPage(browser, auth) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1120, height: 700, deviceScaleFactor: 1.5 });
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ tokens, companyCode, companyName }) => {
    sessionStorage.setItem('ndombaxi.web.access', tokens.accessToken);
    sessionStorage.setItem('ndombaxi.web.refresh', tokens.refreshToken);
    sessionStorage.setItem('ndombaxi.web.company', companyCode);
    sessionStorage.setItem('ndombaxi.web.session_start', String(Date.now()));
    sessionStorage.setItem('ndombaxi.web.shadow', companyName || companyCode);
  }, auth);
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.admin', { timeout: 20000, polling: 500 });
  await sleep(1200);
  return page;
}

const CAPTURES = {
  /* 1 ─ Criar conta (landing → registo) */
  async 'criar-conta'(browser) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1120, height: 700, deviceScaleFactor: 1.5 });
    await page.goto(WEB, { waitUntil: 'domcontentloaded' });
    await waitEval(page, () => [...document.querySelectorAll('button')]
      .some((b) => b.textContent.trim() === 'Criar conta'));
    await sleep(1500); // deixa o React montar os handlers
    await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Criar conta')?.click(); });
    await waitEval(page, () => !!document.querySelector('input[type=email], .field input'), 25000);
    await sleep(900);
    await annotate(page, [
      { sel: 'input[type=email]', label: '1. Plano + e-mail + palavra-passe', labelRight: true },
      { text: 'criar conta', label: '2. «Criar conta» → transferência + comprovativo', labelRight: true },
    ]);
    await shot(page, 'criar-conta');
    await page.close();
  },

  /* 2 ─ Login na caixa (nome + PIN) */
  async 'login-caixa'(browser) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1120, height: 700, deviceScaleFactor: 1.5 });
    await page.goto(POS, { waitUntil: 'domcontentloaded' });
    await waitEval(page, () => !!document.querySelector('.input-wrap input'), 15000);
    await page.type('.input-wrap input', COMPANY, { delay: 25 });
    await sleep(500);
    await annotate(page, [
      { sel: '.input-wrap', label: '1. Escreve o CÓDIGO da tua empresa' },
      { text: 'Continuar', label: '2. «Continuar» → escolhe o teu NOME e digita o PIN de 6 dígitos', labelBelow: true },
    ]);
    await shot(page, 'login-caixa');
    await page.close();
  },

  /* 3 ─ Vender no caixa (interior do POS, autenticado por shadow) */
  async 'vender-caixa'(browser, auth) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1120, height: 700, deviceScaleFactor: 1.5 });
    await page.goto(POS, { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ tokens, companyCode }) => {
      sessionStorage.setItem('nexus.pos.access', tokens.accessToken);
      sessionStorage.setItem('nexus.pos.refresh', tokens.refreshToken);
      localStorage.setItem('nexus.pos.company', companyCode);
    }, auth);
    await page.goto(POS, { waitUntil: 'domcontentloaded' });
    await waitEval(page, () => !!document.querySelector('.grid .prod'), 25000);
    await sleep(900);
    await annotate(page, [
      { sel: '.search-bar .input-wrap', label: '1. Pesquisa ou usa o scanner 📷' },
      { sel: '.grid .prod', label: '2. Toca no produto para adicionar', labelBelow: true },
      { text: 'Abrir turno', label: '3. Abre o turno → «Finalizar venda» emite o recibo AGT' },
    ]);
    await shot(page, 'vender-caixa');
    await page.close();
  },

  /* 4 ─ Criar produto (painel → Produtos → Novo produto) */
  async 'criar-produto'(browser, auth) {
    const page = await gestorPage(browser, auth);
    await clickText(page, 'Produtos', '.nav button, .nav-group-head');
    await clickText(page, 'Criar produtos', '.nav-sub button');
    await waitEval(page, () => !!document.querySelector('.content'), 15000);
    await sleep(1000);
    await clickText(page, 'Novo produto');
    await waitEval(page, () => !!document.querySelector('.modal'), 10000);
    await sleep(700);
    await annotate(page, [
      { sel: '.modal .field input', label: '1. Código = código de BARRAS (usa o scanner)' },
      { text: 'guardar', label: '2. Preenche nome, preço e IVA → «Guardar»', labelBelow: true },
    ]);
    await shot(page, 'criar-produto');
    await page.close();
  },

  /* 5 ─ Entrada de stock */
  async 'entrada-stock'(browser, auth) {
    const page = await gestorPage(browser, auth);
    await clickText(page, 'Produtos', '.nav button, .nav-group-head');
    await clickText(page, 'Entrada stock', '.nav-sub button');
    await waitEval(page, () => !!document.querySelector('.content'), 15000);
    await waitEval(page, () => [...document.querySelectorAll('.content button')]
      .some((b) => b.textContent.includes('Entrada de stock') && !b.disabled));
    await sleep(400);
    await clickText(page, 'Entrada de stock', '.content button');
    await waitEval(page, () => !!document.querySelector('.modal'), 10000);
    await sleep(700);
    await annotate(page, [
      { sel: '.modal .field input', label: '1. Escolhe o produto' },
      { text: 'registar', label: '2. Qtd + custo TOTAL → custo unitário e lucro automáticos', labelBelow: true },
    ]);
    await shot(page, 'entrada-stock');
    await page.close();
  },

  /* 6 ─ Folha salarial */
  async 'folha-salarial'(browser, auth) {
    const page = await gestorPage(browser, auth);
    await clickText(page, 'Usuários', '.nav button, .nav-group-head');
    await clickText(page, 'Folha Salarial', '.nav-sub button');
    await waitEval(page, () => !!document.querySelector('.content'), 15000);
    await sleep(1400);
    await annotate(page, [
      { text: 'Processar folha', label: '1. «Processar folha» — INSS 3%/8% + IRT automáticos', labelBelow: true },
    ]);
    await shot(page, 'folha-salarial');
    await page.close();
  },

  /* 7 ─ Relatórios */
  async 'relatorios'(browser, auth) {
    const page = await gestorPage(browser, auth);
    await clickText(page, 'Relatórios', '.nav button, .nav-group-head');
    await waitEval(page, () => !!document.querySelector('.content'), 15000);
    await sleep(1800);
    await annotate(page, [
      { sel: '.content .seg, .content .tabs, .content .chip', label: '1. Escolhe o tipo de relatório' },
      { text: 'imprimir', label: '2. Imprime em A4 profissional ou exporta CSV', labelBelow: true },
    ]);
    await shot(page, 'relatorios');
    await page.close();
  },

  /* 8 ─ Loja online (montra pública da empresa) */
  async 'loja-online'(browser) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1120, height: 700, deviceScaleFactor: 1.5 });
    await page.goto(`${STORE}/${COMPANY}`, { waitUntil: 'domcontentloaded' });
    await waitEval(page, () => !!document.querySelector('.product'), 25000).catch(() => {});
    await sleep(1200);
    await annotate(page, [
      { sel: '.search input', label: '1. O cliente pesquisa os teus produtos' },
      { sel: '.product .add-btn, .product button', label: '2. Adiciona ao carrinho', labelBelow: true },
      { sel: '.cart-btn', label: '3. Carrinho → checkout' },
    ]);
    await shot(page, 'loja-online');
    await page.close();
  },
};

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
});
try {
  const auth = await getTokens();
  console.log('shadow de', auth.companyCode);
  for (const [name, fn] of Object.entries(CAPTURES)) {
    if (ONLY && name !== ONLY) continue;
    try { await fn(browser, auth); } catch (e) { console.error('✗', name, e.message); }
  }
} finally {
  await browser.close();
}
