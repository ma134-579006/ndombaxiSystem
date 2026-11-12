/**
 * QA — LPS Kwanza: configuração em lote, publicação só com stock e dados em tempo real.
 * Uso: node qa/kwanza-lote.mjs  (empresa B de qa/seed-cinco.mjs; só localhost)
 */
import fs from 'node:fs';
import { call, ok, db, Report, sleep } from './lib.mjs';

const S = JSON.parse(fs.readFileSync(process.env.QA_CINCO ?? 'qa/.cinco.json', 'utf8'));
const R = new Report('kwanza-lote');
const CODE = 'grossista-kuanza-qa';
const l = await ok('POST', '/auth/login', { body: { email: S.B.email, password: S.pass } });
const adm = l.tokens?.accessToken ?? l.accessToken;
const cx = (await ok('POST', '/auth/login', { body: { email: S.B.users.caixa1.email, password: S.pass } }));
const caixa = cx.tokens?.accessToken ?? cx.accessToken;
const c = await db(S.B.schema);
const P = S.B.products;
const K = '/ecommerce/kwanza';
const list = async (q) => ok('GET', `${K}/products${q ? `?q=${encodeURIComponent(q)}` : ''}`, { token: adm });
const tag = String(Date.now()).slice(-6);

// produto sem stock
const zero = await ok('POST', '/pos/products', { token: adm, body: { code: `Z${tag}`, name: `Sem stock ${tag}`, ivaCode: 'NOR', unitPrice: 1000, costPrice: 500, stockQty: 0, showOnline: true } });
let rows = await list(`Sem stock ${tag}`);
R.check('KL-1', 'a lista mostra stock e "não pode publicar" no produto sem stock', rows[0]?.stock === 0 && rows[0]?.canPublish === false && rows[0]?.id === zero.id, JSON.stringify(rows[0]).slice(0, 160));
const pub0 = await call('PATCH', `${K}/products/Z${tag}`, { token: adm, body: { published: true, percent: 10, mode: 'OPEN', allowMarkup: false, maxMarkupPct: null, materials: [] } });
R.check('KL-2', 'publicar produto sem stock é recusado', pub0.status === 400 && /stock/i.test(pub0.body?.message ?? ''), `${pub0.status} ${pub0.body?.message}`);
const cfg0 = await call('PATCH', `${K}/products/Z${tag}`, { token: adm, body: { published: false, percent: 10, mode: 'OPEN', allowMarkup: false, maxMarkupPct: null, materials: [] } });
R.check('KL-3', 'configurar (sem publicar) o produto sem stock é aceite', cfg0.status < 300, cfg0.status);

// lote: marcados
const codes = P.slice(0, 12).map((p) => p.code);
const b1 = await call('POST', `${K}/products/bulk`, { token: adm, body: { codes: [...codes, `Z${tag}`], published: true, percent: 12.5, mode: 'RESTRICTED', allowMarkup: true, maxMarkupPct: 25 } });
const st = (await c.query('SELECT code, kwanza_published p, affiliate_percent pct, affiliate_mode m, allow_markup mk, max_markup_pct mx FROM products WHERE code = ANY($1)', [[...codes, `Z${tag}`]])).rows;
const okAll = st.filter((r) => r.code !== `Z${tag}`).every((r) => r.p && Number(r.pct) === 12.5 && r.m === 'RESTRICTED' && r.mk && Number(r.mx) === 25);
const z = st.find((r) => r.code === `Z${tag}`);
R.check('KL-4', '12 marcados configurados e publicados de uma vez; o sem stock fica configurado mas NÃO publicado', b1.status < 300 && okAll && z && !z.p && Number(z.pct) === 12.5 && b1.body.skipped === 1, `${b1.status} ${JSON.stringify(b1.body)} z=${JSON.stringify(z)}`);
// só um campo: os outros ficam
const b2 = await call('POST', `${K}/products/bulk`, { token: adm, body: { codes: codes.slice(0, 3), percent: 20 } });
const st2 = (await c.query('SELECT affiliate_percent pct, affiliate_mode m, kwanza_published p FROM products WHERE code = ANY($1)', [codes.slice(0, 3)])).rows;
R.check('KL-5', 'alterar só a comissão não mexe nos outros campos', b2.status < 300 && st2.every((r) => Number(r.pct) === 20 && r.m === 'RESTRICTED' && r.p), JSON.stringify(st2));
// publicar sem % produtos que nunca tiveram comissão → ficam de fora
await call('POST', `${K}/products/bulk`, { token: adm, body: { codes: [P[40].code, P[41].code], percent: 0, published: false } });
const b3 = await call('POST', `${K}/products/bulk`, { token: adm, body: { codes: [P[40].code, P[41].code], published: true } });
const st3 = (await c.query('SELECT kwanza_published p FROM products WHERE code = ANY($1)', [[P[40].code, P[41].code]])).rows;
R.check('KL-6', 'publicar em lote sem comissão definida não publica (conta como ignorados)', b3.status < 300 && st3.every((r) => !r.p) && b3.body.skipped === 2, `${b3.status} ${JSON.stringify(b3.body)}`);
for (const [name, body] of [['sem produtos', { published: true, percent: 5 }], ['sem alterações', { codes }], ['comissão 95 %', { codes, percent: 95 }], ['acréscimo 500 %', { codes, maxMarkupPct: 500 }]]) {
  const r = await call('POST', `${K}/products/bulk`, { token: adm, body });
  R.check('KL-7', `lote ${name} é recusado`, r.status === 400, r.status);
}
const rc = await call('POST', `${K}/products/bulk`, { token: caixa, body: { codes, published: false } });
R.check('KL-8', 'operador de caixa não configura o LPS Kwanza', rc.status === 403, rc.status);
// lote: todos os da pesquisa
const b4 = await call('POST', `${K}/products/bulk`, { token: adm, body: { all: true, q: 'Arroz', percent: 8, published: true } });
const arroz = (await c.query("SELECT COUNT(*) n, COUNT(*) FILTER (WHERE kwanza_published) p, COUNT(*) FILTER (WHERE affiliate_percent = 8) e FROM products WHERE is_active AND lower(name) LIKE '%arroz%'")).rows[0];
const outros = (await c.query("SELECT COUNT(*) n FROM products WHERE affiliate_percent = 8 AND lower(name) NOT LIKE '%arroz%'")).rows[0];
R.check('KL-9', '"todos os da pesquisa": aplica a todos os que correspondem e só a esses', b4.status < 300 && Number(arroz.n) > 0 && arroz.n === arroz.p && arroz.n === arroz.e && Number(outros.n) === 0 && b4.body.updated === Number(arroz.n), `${JSON.stringify(b4.body)} arroz=${JSON.stringify(arroz)} outros=${outros.n}`);

// tempo real: associado vê preço e stock novos sem "Atualizar"
const a = (await ok('POST', '/kwanza/auth/register', { body: { name: 'Associado Lote', phone: `95${String(Date.now()).slice(-7)}`, password: 'segredo123' } }));
const mk = async () => (await ok('GET', '/kwanza/market', { token: a.token })).find((x) => x.companyCode === CODE && x.productCode === codes[5]);
const off5 = (await c.query('SELECT show_online FROM products WHERE code=$1', [codes[5]])).rows[0];
R.check('KL-9b', 'publicar no LPS Kwanza põe o produto na loja online (onde a compra acontece)', off5.show_online === true, JSON.stringify(off5));
const before = await mk();
R.check('KL-10', 'produto configurado em lote aparece no marketplace dos associados', !!before && before.commissionPct === 12.5, JSON.stringify(before ?? null).slice(0, 160));
const newPrice = Math.round((P[5].price + 777) * 100) / 100;
await ok('PATCH', `/pos/products/${P[5].id}`, { token: adm, body: { unitPrice: newPrice } });
let after = null; const t0 = Date.now();
for (let i = 0; i < 20; i++) { after = await mk(); if (after && Math.abs(after.grossPrice - before.grossPrice) > 1) break; await sleep(1000); }
R.check('KL-11', 'alterar o preço na empresa reflete-se no marketplace sozinho (em segundos)', after && Math.abs(after.grossPrice - before.grossPrice) > 1, `${before?.grossPrice} → ${after?.grossPrice} em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
await ok('POST', '/erp/stock/adjust', { token: adm, body: { productId: P[5].id, warehouseId: S.B.storeId, newQuantity: 0, reason: 'QA esgotar' } });
let gone = null; const t1 = Date.now();
for (let i = 0; i < 20; i++) { gone = await mk(); if (!gone || gone.inStock === false) break; await sleep(1000); }
R.check('KL-12', 'produto esgotado deixa de estar disponível no marketplace sozinho', !gone || gone.inStock === false, `inStock=${gone?.inStock} em ${((Date.now() - t1) / 1000).toFixed(0)}s`);
rows = await list(P[5].code);
R.check('KL-13', 'no painel, o produto esgotado passa a "sem stock" (não publicável)', rows.find((r) => r.code === P[5].code)?.canPublish === false, JSON.stringify(rows.find((r) => r.code === P[5].code)).slice(0, 140));
await ok('POST', '/erp/stock/entry', { token: adm, body: { productId: P[5].id, warehouseId: S.B.storeId, quantity: 50, unitCost: P[5].cost } });
await ok('PATCH', `/pos/products/${P[5].id}`, { token: adm, body: { unitPrice: P[5].price } });
rows = await list(P[5].code);
R.check('KL-14', 'depois da entrada de stock volta a ser publicável', rows.find((r) => r.code === P[5].code)?.canPublish === true && rows.find((r) => r.code === P[5].code)?.stock === 50, JSON.stringify(rows.find((r) => r.code === P[5].code)).slice(0, 140));
const off = await call('POST', `${K}/products/bulk`, { token: adm, body: { all: true, published: false } });
const left = (await c.query('SELECT COUNT(*) n FROM products WHERE kwanza_published')).rows[0].n;
R.check('KL-15', '"todos": retirar tudo do marketplace de uma vez', off.status < 300 && Number(left) === 0, `${JSON.stringify(off.body)} publicados=${left}`);
await call('POST', `${K}/products/bulk`, { token: adm, body: { codes, published: true } });

await c.end();
const s = R.summary(); fs.mkdirSync('qa/out', { recursive: true }); fs.writeFileSync('qa/out/kwanza-lote.json', JSON.stringify(s, null, 1));
console.log(`\n${s.passed}/${s.total} passaram; ${s.failed} falharam`);
