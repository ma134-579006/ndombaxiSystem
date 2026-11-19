/**
 * QA — afiliação como no Kikolo Online (só localhost/staging).
 *
 * Empresa E (Loja Welwitschia): afiliar a vários produtos de uma vez (abertos e restritos),
 * preço próprio entre 0 % e o máximo da empresa (nunca abaixo nem acima), publicação com preço
 * próprio vista pelo cliente na ligação, remover afiliação.
 *
 * Uso: node qa/associados-afiliar.mjs
 */
import fs from 'node:fs';
import { call, ok, Report } from './lib.mjs';

const S = JSON.parse(fs.readFileSync(process.env.QA_CINCO ?? 'qa/.cinco.json', 'utf8'));
const R = new Report('associados-afiliar');
const K = '/kwanza', AK = '/ecommerce/kwanza';
const tag = String(Date.now()).slice(-6);
const login = async (email) => { const r = await ok('POST', '/auth/login', { body: { email, password: S.pass } }); return r.tokens?.accessToken ?? r.accessToken; };

const E = { k: 'E' };
E.adm = await login(S.E.email);
const base = 20 + (Number(tag) % 50);
E.prods = S.E.products.slice(base, base + 5);
// 4 abertos (o 1.º com preço próprio até 20 %), 1 restrito.
for (const [i, p] of E.prods.entries()) {
  await ok('POST', '/erp/stock/entry', { token: E.adm, body: { productId: p.id, warehouseId: S.E.storeId, quantity: 50, unitCost: p.cost } });
  await ok('PATCH', `${AK}/products/${p.code}`, { token: E.adm, body: { published: true, materials: [], percent: 10, mode: i === 4 ? 'RESTRICTED' : 'OPEN', allowMarkup: i === 0, maxMarkupPct: i === 0 ? 20 : null } });
}
const market = await ok('GET', `${K}/market?_=${tag}`);
E.code = market.find((l) => E.prods.some((p) => p.code === l.productCode))?.companyCode ?? 'loja-welwitschia-qa';
const listing = (code) => ok('GET', `${K}/listing/${E.code}/${code}`);

const mk = async (n) => (await ok('POST', `${K}/auth/register`, { body: { name: `Assoc Plano ${n} ${tag}`, phone: `94${tag}${n}`.slice(0, 9), password: 'segredo123' } })).token;
const a1 = await mk(1), a2 = await mk(2);

// ── afiliar a vários de uma vez ─────────────────────────
let r = await ok('POST', `${K}/me/affiliations/bulk`, { token: a1, body: { items: E.prods.slice(0, 3).map((p) => ({ companyCode: E.code, productCode: p.code })).concat([{ companyCode: E.code, productCode: E.prods[4].code }]) } });
R.check('PL-1', 'afiliar a 4 produtos de uma vez: 3 abertos aprovados + 1 restrito pendente', r.filter((x) => x.status === 'APPROVED').length === 3 && r.filter((x) => x.status === 'PENDING').length === 1, JSON.stringify(r.map((x) => x.status ?? x.error)));
const affs = await ok('GET', `${K}/me/affiliations`, { token: a1 });
R.check('PL-2', '"Minhas afiliações" mostra os 4', E.prods.slice(0, 3).concat([E.prods[4]]).every((p) => affs.some((x) => x.productCode === p.code)), `${affs.length}`);

// ── preço próprio: 0..máximo da empresa ────────────────────────────────────
const L0 = await listing(E.prods[0].code);
r = await call('POST', `${K}/me/markup`, { token: a1, body: { companyCode: E.code, productCode: E.prods[0].code, markupPct: 25 } });
R.check('PL-3', 'preço próprio acima do máximo (+25% > +20%) é recusado', r.status === 400 && /20/.test(r.body?.message ?? ''), `${r.status} ${r.body?.message}`);
r = await call('POST', `${K}/me/markup`, { token: a1, body: { companyCode: E.code, productCode: E.prods[0].code, markupPct: -5 } });
R.check('PL-4', 'preço abaixo do da empresa é recusado', r.status === 400, `${r.status} ${r.body?.message}`);
r = await call('POST', `${K}/me/markup`, { token: a1, body: { companyCode: E.code, productCode: E.prods[0].code, markupPct: 20 } });
R.check('PL-5', 'preço próprio no máximo (+20%) aceite', r.status < 300 && r.body?.markupPct === 20, `${r.status} ${JSON.stringify(r.body)}`);
r = await call('POST', `${K}/me/markup`, { token: a1, body: { companyCode: E.code, productCode: E.prods[0].code, markupPct: 7.5 } });
R.check('PL-6', 'preço próprio abaixo do máximo (+7,5%) aceite', r.status < 300 && r.body?.markupPct === 7.5, `${r.status} ${JSON.stringify(r.body)}`);
r = await call('POST', `${K}/me/markup`, { token: a1, body: { companyCode: E.code, productCode: E.prods[1].code, markupPct: 5 } });
R.check('PL-7', 'produto sem preço próprio: recusa qualquer subida', r.status === 400, `${r.status} ${r.body?.message}`);
const post = await call('PUT', `${K}/me/posts`, { token: a1, body: { companyCode: E.code, productCode: E.prods[0].code, price: Math.round(L0.grossPrice * 1.3), images: [], videoUrl: null, caption: null, published: false } });
R.check('PL-8', 'publicação com preço acima do máximo é recusada', post.status === 400, `${post.status} ${post.body?.message}`);

// ── remover afiliação ──────────────────────────────────────────────────────
r = await call('DELETE', `${K}/me/affiliations/${E.code}/${E.prods[2].code}`, { token: a1 });
const affs2 = await ok('GET', `${K}/me/affiliations`, { token: a1 });
R.check('PL-9', 'remover afiliação tira o produto das afiliações', r.status < 300 && !affs2.some((x) => x.productCode === E.prods[2].code), `${r.status}`);
r = await call('DELETE', `${K}/me/affiliations/${E.code}/${E.prods[2].code}`, { token: a1 });
R.check('PL-10', 'remover de novo → 404', r.status === 404, `${r.status}`);

// ── outro associado: afilia, publica com preço próprio dentro do limite e o cliente vê esse preço ──
r = await ok('POST', `${K}/me/affiliations/bulk`, { token: a2, body: { items: [{ companyCode: E.code, productCode: E.prods[0].code }, { companyCode: E.code, productCode: 'NAO-EXISTE' }] } });
R.check('PL-11', 'vários de uma vez com um produto inexistente: o bom passa, o mau devolve erro', r[0]?.status === 'APPROVED' && !!r[1]?.error, JSON.stringify(r.map((x) => x.status ?? x.error)));
const price = Math.round(L0.grossPrice * 1.15 * 100) / 100;
r = await call('PUT', `${K}/me/posts`, { token: a2, body: { companyCode: E.code, productCode: E.prods[0].code, price, images: [], videoUrl: null, caption: 'QA', published: true } });
R.check('PL-12', 'publica com preço +15% (dentro de +20%)', r.status < 300 && r.body?.published, `${r.status} ${JSON.stringify(r.body)}`);
const me2 = (await ok('POST', `${K}/auth/login`, { body: { login: `94${tag}2`.slice(0, 9), password: 'segredo123' } })).associate;
const viaLink = await ok('GET', `${K}/listing/${E.code}/${E.prods[0].code}?a=${me2.code}`);
R.check('PL-13', 'o cliente que abre a ligação vê o preço do associado', Math.abs(viaLink.grossPrice - price) < 0.02, `${viaLink.grossPrice} vs ${price}`);
r = await call('POST', `${K}/me/affiliations/bulk`, { body: { items: [{ companyCode: E.code, productCode: E.prods[0].code }] } });
R.check('PL-14', 'afiliar sem sessão → 401', r.status === 401, `${r.status}`);
r = await call('DELETE', `${K}/me/affiliations/${E.code}/${E.prods[0].code}`, { token: a2 });
const mk2 = await ok('GET', `${K}/market?_=${tag}b`);
R.check('PL-15', 'remover afiliação tira a publicação do marketplace', r.status < 300 && !mk2.some((l) => l.productCode === E.prods[0].code && l.associate?.code === me2.code), `${r.status}`);

fs.mkdirSync('qa/out', { recursive: true });
const s = R.summary();
fs.writeFileSync('qa/out/associados-afiliar.json', JSON.stringify(s, null, 1));
console.log(`\n${s.passed}/${s.total} passaram; ${s.failed} falharam`);
