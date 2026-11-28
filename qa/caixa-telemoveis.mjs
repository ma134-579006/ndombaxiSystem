/**
 * QA — Caixa em telemóveis e tablets (iPhone 4S → 18 Pro Max, Android 4 → 17, dobráveis,
 * iPad e tablets Android), retrato e paisagem. Só local.
 * Pedido do utilizador: «a Caixa continua a quebrar no iPhone e noutros dispositivos;
 * deve ajustar-se ao tamanho do ecrã sem quebrar nada».
 *
 * Emulação de aparelho: tamanho CSS do ecrã, user agent da geração, toque e densidade.
 * iPhone/iPad no WebKit (motor do Safari — todos os navegadores do iOS usam WebKit),
 * Android no Chromium (Chrome, Edge, Samsung Internet, Opera, WebView). NÃO é dispositivo real.
 * API clássica do Playwright: corre no playwright-core atual e no 1.12 dos motores antigos
 * reais (QA_EXE = WebKit 14.2 ≈ iOS 14, Chromium 93 ≈ Android 12).
 *
 * Por aparelho e ecrã:
 *   T1  sem scroll lateral na página nem dentro de contentores (barras deslizantes por desenho à parte);
 *   T2  nenhum botão/campo visível sai do ecrã (horizontal) nem fica cortado sem reticências;
 *   T3  venda (15 artigos): TOTAL e FINALIZAR inteiros no ecrã;
 *   T4  janelas (Opções, Finalizar, Entrada/Saída, Ponto de Caixa, Faturação): o painel cabe no ecrã;
 *   T5  campos de texto com letra ≥ 16 px (o iOS faz zoom ao focar um campo < 16 px).
 *
 * QA_GRUPO=pc: portáteis e monitores (800×600 → 8K, escala 125/150 %, Chromium = Chrome/Edge/Opera, WebKit = Safari do Mac).
 * Variáveis: QA_PW (pasta do playwright-core), QA_EXE (motor antigo; filtra pelo motor dele),
 *   QA_MOTOR_EXE (webkit|chromium, motor do QA_EXE), QA_PERFIS (regex), QA_JANELAS=0 (só login+venda),
 *   QA_STATE, QA_SHOTS.  Uso: node qa/caixa-telemoveis.mjs <url-caixa> [rótulo]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Report } from './lib.mjs';

const [CAIXA = 'http://localhost:5191', LABEL = 'atual'] = process.argv.slice(2);
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(CAIXA)) throw new Error('Só local.');
const require = createRequire(path.join(process.env.QA_PW ?? process.env.QA_PLAYWRIGHT ?? '.', 'package.json'));
const pw = require('playwright-core');
const state = JSON.parse(fs.readFileSync(process.env.QA_STATE ?? 'qa/.state.json', 'utf8'));
const op = state.users[process.env.QA_USER ?? 'gerente-sup1@grupo-kwanza.qa.test'];
const EXE = process.env.QA_EXE;
const MOTOR_EXE = process.env.QA_MOTOR_EXE;
const rep = new Report(`caixa-telemoveis (${LABEL}${EXE ? ` · ${MOTOR_EXE} antigo` : ''})`);
const SHOTS = process.env.QA_SHOTS;
const COM_JANELAS = process.env.QA_JANELAS !== '0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// User agents por geração (o motor é o do PC; o UA faz a app comportar-se como no aparelho).
const UA = {
  ios9: 'Mozilla/5.0 (iPhone; CPU iPhone OS 9_3_6 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13G37 Safari/601.1',
  ios12: 'Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1',
  ios15: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
  ios17: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ios18: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  and4: 'Mozilla/5.0 (Linux; Android 4.4.2; GT-I9300) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Mobile Safari/537.36',
  and8: 'Mozilla/5.0 (Linux; Android 8.0.0; SM-G950F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36',
  and14: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
  and17: 'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36',
  atab: 'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
};
const I = (nome, w, h, ua, dsf = 3) => ({ nome, motor: 'webkit', opts: { viewport: { width: w, height: h }, deviceScaleFactor: dsf, hasTouch: true, userAgent: ua } });
const A = (nome, w, h, ua, dsf = 2.625) => ({ nome, motor: 'chromium', opts: { viewport: { width: w, height: h }, deviceScaleFactor: dsf, isMobile: true, hasTouch: true, userAgent: ua } });
const TODOS = [
  // iPhone (retrato)
  I('iPhone 4S 320×480', 320, 480, UA.ios9, 2), I('iPhone 5/5S/SE1 320×568', 320, 568, UA.ios12, 2), I('iPhone 6/7/8/SE2/SE3 375×667', 375, 667, UA.ios15, 2),
  I('iPhone 6+/7+/8+ 414×736', 414, 736, UA.ios15), I('iPhone X/XS/11 Pro/12 mini 375×812', 375, 812, UA.ios15), I('iPhone XR/11 414×896', 414, 896, UA.ios17, 2),
  I('iPhone 12/13/14 390×844', 390, 844, UA.ios17), I('iPhone 14 Pro/15/16 393×852', 393, 852, UA.ios18), I('iPhone 16 Pro/17 402×874', 402, 874, UA.ios18),
  I('iPhone Plus/Pro Max 430×932', 430, 932, UA.ios18), I('iPhone 16–18 Pro Max 440×956', 440, 956, UA.ios18),
  // iPhone (paisagem)
  I('iPhone 4S paisagem 480×320', 480, 320, UA.ios9, 2), I('iPhone SE1 paisagem 568×320', 568, 320, UA.ios12, 2), I('iPhone 8 paisagem 667×375', 667, 375, UA.ios15, 2),
  I('iPhone 15 paisagem 852×393', 852, 393, UA.ios18), I('iPhone Pro Max paisagem 956×440', 956, 440, UA.ios18),
  // Android (retrato)
  A('Android 4.x 320×480', 320, 480, UA.and4, 1.5), A('Android 5–7 360×640', 360, 640, UA.and8, 3), A('Galaxy S8–S10 360×740', 360, 740, UA.and8, 4),
  A('Galaxy S2x 360×780 (Samsung Internet)', 360, 780, UA.samsung, 3), A('Pixel 7/8 412×915', 412, 915, UA.and14), A('Android 16/17 Pixel 10 412×923', 412, 923, UA.and17),
  A('Galaxy Z Fold fechado 280×653', 280, 653, UA.samsung, 3), A('Galaxy Z Fold aberto 673×841', 673, 841, UA.samsung, 2.5),
  // Android (paisagem)
  A('Android 4.x paisagem 480×320', 480, 320, UA.and4, 1.5), A('Android paisagem 640×360', 640, 360, UA.and8, 3), A('Pixel paisagem 915×412', 915, 412, UA.and14),
  // Tablets
  I('iPad mini 744×1133', 744, 1133, UA.ipad, 2), I('iPad 768×1024', 768, 1024, UA.ipad, 2), I('iPad Air 820×1180', 820, 1180, UA.ipad, 2), I('iPad Pro 12.9 1024×1366', 1024, 1366, UA.ipad, 2),
  I('iPad paisagem 1024×768', 1024, 768, UA.ipad, 2), I('iPad Pro paisagem 1366×1024', 1366, 1024, UA.ipad, 2),
  A('Tablet 7" 600×960', 600, 960, UA.atab, 2), A('Tablet Android 800×1280', 800, 1280, UA.atab, 2), A('Tablet 7" paisagem 960×600', 960, 600, UA.atab, 2), A('Tablet Android paisagem 1280×800', 1280, 800, UA.atab, 2),
];
// PCs (portáteis e monitores; dsf = escala do Windows/Retina). Sem toque nem isMobile.
const PC = (nome, w, h, motor, dsf = 1) => ({ nome, motor, grupo: 'pc', opts: { viewport: { width: w, height: h }, deviceScaleFactor: dsf, userAgent: motor === 'webkit' ? UA.mac : UA.win } });
const PCS = [
  PC('PC 800×600', 800, 600, 'chromium'), PC('PC 1024×768', 1024, 768, 'chromium'), PC('Portátil 1280×720', 1280, 720, 'chromium'),
  PC('Portátil 1280×800', 1280, 800, 'webkit', 2), PC('Portátil 1366×768', 1366, 768, 'chromium'), PC('Portátil 1366×768 (Safari)', 1366, 768, 'webkit'),
  PC('Portátil 1440×900 (MacBook Air)', 1440, 900, 'webkit', 2), PC('Portátil 1536×864 (escala 125 %)', 1536, 864, 'chromium', 1.25),
  PC('Portátil 1280×720 (escala 150 %)', 1280, 720, 'chromium', 1.5), PC('Monitor 1600×900', 1600, 900, 'chromium'), PC('Monitor 1680×1050', 1680, 1050, 'webkit'),
  PC('Monitor 1920×1080', 1920, 1080, 'chromium'), PC('Monitor 1920×1080 (Safari)', 1920, 1080, 'webkit'), PC('Monitor 2560×1440', 2560, 1440, 'chromium'),
  PC('Monitor 4K 3840×2160', 3840, 2160, 'chromium'), PC('iMac 5K 5120×2880', 5120, 2880, 'webkit'), PC('Monitor 8K 7680×4320', 7680, 4320, 'chromium'),
  PC('Janela estreita 1024×600 (netbook)', 1024, 600, 'chromium'), PC('Monitor vertical 1080×1920', 1080, 1920, 'chromium'),
];
for (const p of TODOS) p.grupo ??= 'movel';
TODOS.push(...PCS);
const GRUPO = process.env.QA_GRUPO ?? 'movel'; // movel | pc | todos
const SO = process.env.QA_PERFIS ? new RegExp(process.env.QA_PERFIS) : null;
const perfis = TODOS.filter((p) => (GRUPO === 'todos' || p.grupo === GRUPO) && (!SO || SO.test(p.nome)) && (!EXE || p.motor === MOTOR_EXE));

const MENU = "button[aria-label='Menu da caixa']";
const janelas = [
  { nome: 'Opções da venda', passos: ['.vopt-btn'] },
  { nome: 'Finalizar venda', passos: ['.vfinal'] },
  { nome: 'Entrada / Saída', passos: [MENU, 'text=Entrada / Saída de dinheiro'], largo: ['.vtop-m:not(.vtop-m-mob) > button:has-text("Caixa")', '.vtop-drop >> text=Entrada / Saída de dinheiro'] },
  { nome: 'Ponto de Caixa', passos: [MENU, 'text=Ponto de Caixa'], largo: ['.vtop-m:not(.vtop-m-mob) > button:has-text("Caixa")', '.vtop-drop >> text=Ponto de Caixa'] },
  { nome: 'Faturação', passos: [MENU, 'text=Faturação'], largo: ['.vtop-m:not(.vtop-m-mob) > button:has-text("Documentos")', '.vtop-drop >> text=Faturação'] },
];
const RAIZ = '.vw-bg, .vfin-bg, .modal-bg, .scan-overlay, .vopts';
const FECHAR = '[aria-label="Fechar"], .vfin-x, .vfin-close, .vw-x, .modal-x-auto, .vopts-x';
const DESLIZA = 'tabs|tab-bar|chips|vtabs|vcat|carousel|scroller|cat-bar|ptabs|seg|strip|rail';

const visivelEm = (pg, sel) => pg.evaluate((s) => [...document.querySelectorAll(s)].some((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; }), sel);

/** Mede o ecrã atual. `janela`: mede também o painel da janela de cima. */
const medir = (pg, janela) => pg.evaluate(({ DESLIZA, RAIZ, janela }) => {
  const re = new RegExp(DESLIZA);
  const vw = innerWidth; const vh = innerHeight; const de = document.documentElement;
  const nome = (e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''}`;
  const visivel = (e) => { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false; const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const pagina = Math.max(de.scrollWidth, document.body.scrollWidth) - vw;
  const contentores = [];
  for (const e of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(e);
    if (!/(auto|scroll)/.test(cs.overflowX)) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 40 || r.height < 16) continue;
    const d = e.scrollWidth - e.clientWidth;
    if (d > 2 && !re.test(String(e.className))) contentores.push(`${nome(e)}+${d}px`);
  }
  const antepassadoDeslizante = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { if (re.test(String(p.className)) || /(auto|scroll)/.test(getComputedStyle(p).overflowX)) return true; } return false; };
  // CSS zoom (useFitHeight no login): o WebKit e o Chromium antigo medem os filhos sem o zoom aplicado;
  // mede-se o bloco ampliado/reduzido em vez dos filhos.
  const zoomAnc = (e) => { let z = null; for (let p = e; p && p !== document.documentElement; p = p.parentElement) { const v = parseFloat(getComputedStyle(p).zoom); if (v && Math.abs(v - 1) > 0.001) z = p; } return z; };
  const fora = []; const cortados = [];
  for (const e of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], .vtotal, .vfinal')) {
    if (!visivel(e)) continue;
    // Dentro de um bloco com zoom as coordenadas vêm infladas: aí vale o T1 (scroll lateral da página).
    if (zoomAnc(e)) continue;
    const r = e.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !antepassadoDeslizante(e)) fora.push(`${nome(e)}[${Math.round(r.left)}..${Math.round(r.right)}]`);
    const cs = getComputedStyle(e);
    if (!/^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName) && e.scrollWidth > e.clientWidth + 2 && cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis') {
      const t = (e.textContent ?? '').trim();
      if (t) cortados.push(`${nome(e)}«${t.slice(0, 18)}»+${e.scrollWidth - e.clientWidth}px`);
    }
  }
  const caixa = (s) => { const e = document.querySelector(s); if (!e || !visivel(e)) return null; const r = e.getBoundingClientRect(); return r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5; };
  const campos = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([readonly]), textarea, select')]
    .filter(visivel).filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => `${nome(e)}${e.placeholder ? '«' + e.placeholder.slice(0, 14) + '»' : ''}=${getComputedStyle(e).fontSize}`);
  let painel = null;
  if (janela) {
    const raizes = [...document.querySelectorAll(RAIZ)].filter(visivel);
    const top = raizes.sort((a, b) => (Number(getComputedStyle(b).zIndex) || 0) - (Number(getComputedStyle(a).zIndex) || 0))[0];
    if (!top) painel = { ok: false, motivo: 'janela não abriu' };
    else {
      const filhos = [...top.children].filter(visivel);
      const area = (x) => { const r = x.getBoundingClientRect(); return r.width * r.height; };
      const alvo = top.classList.contains('vopts') || !filhos.length ? top : filhos.sort((a, b) => area(b) - area(a))[0];
      const r = alvo.getBoundingClientRect();
      painel = { ok: r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5, motivo: `${nome(alvo)} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)} (ecrã ${vw}×${vh})` };
    }
  }
  return { pagina, contentores: contentores.slice(0, 3), fora: fora.slice(0, 4), nFora: fora.length, cortados: [...new Set(cortados)].slice(0, 3), nCort: cortados.length, total: caixa('.vtotal'), fin: caixa('.vfinal'), campos: [...new Set(campos)].slice(0, 4), painel };
}, { DESLIZA, RAIZ, janela });

let TOQUE = true;
function registar(id, m, extra = {}) {
  rep.check(`T1 ${id}`, 'Sem scroll lateral (página e contentores)', m.pagina <= 1 && !m.contentores.length, `página+${m.pagina}px ${m.contentores.join(' ')}`);
  rep.check(`T2 ${id}`, 'Nada sai do ecrã nem fica cortado', !m.nFora && !m.nCort, `${m.fora.join(' ')} ${m.cortados.join(' ')}`.trim());
  if (extra.venda) rep.check(`T3 ${id}`, 'TOTAL e FINALIZAR inteiros no ecrã', m.total === true && m.fin === true, `total=${m.total} finalizar=${m.fin}`);
  if (m.painel) rep.check(`T4 ${id}`, 'Painel da janela cabe no ecrã', m.painel.ok, m.painel.motivo);
  // T5 só em ecrãs táteis: o zoom ao focar um campo < 16 px é do iOS (PCs não fazem zoom).
  if (TOQUE) rep.check(`T5 ${id}`, 'Campos de texto com letra ≥ 16 px (sem zoom no iOS)', !m.campos.length, m.campos.join(' '));
}
const foto = async (pg, p, ecra) => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, `tel-${LABEL}${EXE ? '-antigo' : ''}-${p.nome.replace(/\W+/g, '')}-${ecra.replace(/\W+/g, '')}.png`) }).catch(() => undefined); };

for (const p of perfis) {
  // PCs: o clique do Playwright desloca a página por causa do zoom CSS (useFitHeight) — clica-se sem deslocar, como o rato.
  TOQUE = p.grupo !== 'pc';
  const b = await pw[p.motor].launch(EXE ? { executablePath: EXE } : {});
  // isMobile não existe no WebKit para Windows; o Chromium antigo aceita.
  const ctx = await b.newContext(p.opts);
  await ctx.route(/onrender\.com|lpsvendas|vendus\.co|connect\.facebook|accounts\.google|googletagmanager|google-analytics/, (r) => r.abort());
  const pg = await ctx.newPage();
  try {
    await pg.goto(CAIXA, { waitUntil: 'load' });
    await pg.waitForSelector('#ndx_field_acct', { timeout: 30_000 });
    await sleep(1500);
    registar(`${p.nome} · login`, await medir(pg, false)); await foto(pg, p, 'login');
    const jsClick = (sel) => pg.$eval(sel, (e) => { e.focus(); e.click(); });
    await jsClick('#ndx_field_acct'); await pg.fill('#ndx_field_acct', op.email);
    await jsClick('input[placeholder="PIN"]'); await pg.fill('input[placeholder="PIN"]', op.pin);
    await jsClick('button.va-btn');
    // A API de QA pode demorar («A entrar…»): espera o fim do login até 60 s.
    await pg.waitForFunction(() => !document.querySelector('#ndx_field_acct'), null, { timeout: 60_000 }).catch(() => undefined);
    await sleep(3000);
    for (let k = 0; k < 3 && await pg.$('.vclosed-open'); k++) { await sleep(1500); await pg.click('.vclosed-open', { timeout: 8000 }).catch(() => undefined); await sleep(4000); }
    await pg.waitForSelector('button[aria-label*="em stock"]', { timeout: 20_000 }).catch(() => undefined);
    const tiles = await pg.$$('button[aria-label*="em stock"]');
    const ja = (await pg.$$('.vline')).length;
    for (let i = ja; i < 15 && i < tiles.length; i++) { await tiles[i].click({ timeout: 6000 }).catch(() => undefined); await sleep(200); }
    await sleep(1000);
    registar(`${p.nome} · venda 15 artigos`, await medir(pg, false), { venda: true }); await foto(pg, p, 'venda');
    if (COM_JANELAS) {
      const largo = !(await visivelEm(pg, MENU));
      for (const j of janelas) {
        const passos = largo && j.largo ? j.largo : j.passos;
        let abriu = true; let porque = '';
        try { for (const s of passos) { if (s === MENU && largo) continue; if (p.grupo === 'pc') await pg.locator(s).first().dispatchEvent('click', undefined, { timeout: 8000 }); else await pg.click(s, { timeout: 8000 }); await sleep(1800); } await pg.waitForSelector(RAIZ, { timeout: 6000 }).catch(() => undefined);
          // Ecrãs enormes sem GPU (8K): espera o fim da animação de abertura antes de medir.
          await pg.waitForFunction(() => document.getAnimations().every((x) => x.playState !== 'running'), null, { timeout: 6000 }).catch(() => undefined); } catch (e) { abriu = false; porque = String(e.message ?? e).split(/\r?\n/).slice(0, 12).join(' ').replace(/[[0-9;]*m/g, '').slice(0, 900); }
        if (!abriu && process.env.QA_DEBUG) console.error('DEBUG', porque);
        if (!abriu) rep.check(`T4 ${p.nome} · ${j.nome}`, 'Janela abre', false, 'não foi possível abrir: ' + porque);
        else { registar(`${p.nome} · ${j.nome}`, await medir(pg, true)); await foto(pg, p, j.nome); }
        for (let k = 0; k < 3 && await visivelEm(pg, RAIZ); k++) {
          const fechou = await pg.evaluate((F) => { const xs = [...document.querySelectorAll(F)].filter((e) => e.getBoundingClientRect().width > 0); const x = xs[xs.length - 1]; if (x) { x.click(); return true; } return false; }, FECHAR);
          if (!fechou) await pg.keyboard.press('Escape');
          await sleep(1000);
        }
      }
    }
  } catch (e) {
    rep.check(`${p.nome}`, 'Percurso completo', false, String(e.message ?? e).split('\n')[0].slice(0, 140));
    await foto(pg, p, 'erro');
  }
  await b.close();
}
const sum = rep.summary();
fs.mkdirSync('qa/out', { recursive: true });
fs.writeFileSync(`qa/out/caixa-${GRUPO}-${LABEL}${EXE ? `-${MOTOR_EXE}-antigo` : ''}.json`, JSON.stringify(sum, null, 2));
console.log(`\n${sum.passed}/${sum.total} PASS`);
process.exit(sum.failed ? 1 : 0);
