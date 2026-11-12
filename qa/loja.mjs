/**
 * QA — loja online da empresa E (só localhost): checkout, cupões, concorrência de stock,
 * preço imposto, acesso a encomendas de outro cliente e callback de pagamento forjado.
 * Uso: node qa/loja.mjs  (depois de qa/seed-cinco.mjs)
 */
import fs from 'node:fs';
import { call, ok, db, Report } from './lib.mjs';

const S = JSON.parse(fs.readFileSync(process.env.QA_CINCO ?? 'qa/.cinco.json', 'utf8'));
const R = new Report('loja');
const ST = '/store/loja-welwitschia-qa';
const geo = { geoLat: -8.83, geoLng: 13.23, geoAccuracy: 10, geoConsent: true };
const c = await db(S.E.schema);
const l = await ok('POST', '/auth/login', { body: { email: S.E.email, password: S.pass } });
const adm = l.tokens?.accessToken ?? l.accessToken;
const P = S.E.products;
const tag = String(Date.now()).slice(-6);
const buyer = async (n) => (await ok('POST', `${ST}/auth/quick`, { body: { name: `Comprador ${n}`, phone: `94${tag}${n}`.slice(0, 9) } })).token;
const stock = async (id) => Number((await c.query('SELECT COALESCE(SUM(quantity),0) q FROM stock_items WHERE product_id=$1', [id])).rows[0].q);
const total = async (id) => Number((await c.query('SELECT gross_total FROM web_orders WHERE id=$1', [id])).rows[0]?.gross_total);

const cat = await call('GET', `${ST}/catalog`);
const txt = JSON.stringify(cat.body ?? '');
R.check('LJ-1', 'catálogo público responde e só mostra artigos da empresa E', cat.status < 300 && txt.includes('E00001') && !/"A000\d\d"/.test(txt), `${cat.status} ${txt.length} bytes`);
const b1 = await buyer(1), b2 = await buyer(2);

const p = P[5]; const q0 = await stock(p.id);
const o1 = await call('POST', `${ST}/checkout`, { token: b1, body: { lines: [{ productCode: p.code, quantity: 2 }], ...geo } });
R.check('LJ-2', 'checkout cria a encomenda', o1.status < 300 && !!o1.body?.id, `${o1.status} ${JSON.stringify(o1.body).slice(0, 160)}`);
const sumL = (await c.query('SELECT COALESCE(SUM(gross_amount),0) s FROM web_order_items WHERE order_id=$1', [o1.body?.id])).rows[0].s;
R.check('LJ-3', 'total da encomenda = soma das linhas', Math.round(Number(sumL) * 100) === Math.round((await total(o1.body?.id)) * 100), `${sumL} vs ${await total(o1.body?.id)}`);

for (const [name, body] of [
  ['preço imposto pelo cliente', { lines: [{ productCode: p.code, quantity: 1, unitPrice: 0.01 }] }],
  ['quantidade negativa', { lines: [{ productCode: p.code, quantity: -3 }] }],
  ['quantidade zero', { lines: [{ productCode: p.code, quantity: 0 }] }],
  ['artigo inexistente', { lines: [{ productCode: 'NAO-EXISTE', quantity: 1 }] }],
  ['artigo de outra empresa', { lines: [{ productCode: S.A.products[0].code, quantity: 1 }] }],
  ['sem linhas', { lines: [] }],
  ['total imposto', { lines: [{ productCode: p.code, quantity: 1 }], grossTotal: 1 }],
]) {
  const r = await call('POST', `${ST}/checkout`, { token: b1, body: { ...body, ...geo } });
  R.check('LJ-4', `checkout com ${name} é recusado`, r.status >= 400 && r.status < 500, `${r.status} ${JSON.stringify(r.body).slice(0, 110)}`);
}

// concorrência: 3 unidades, 12 compradores
const code = `W${tag}`;
const np = await ok('POST', '/pos/products', { token: adm, body: { code, name: 'Últimas 3 online', ivaCode: 'NOR', unitPrice: 1000, costPrice: 500, stockQty: 0, showOnline: true } });
await ok('POST', '/erp/stock/entry', { token: adm, body: { productId: np.id, warehouseId: S.E.storeId, quantity: 3, unitCost: 500 } });
const buyers = []; for (let i = 0; i < 12; i++) buyers.push(await buyer(10 + i));
await new Promise((r) => setTimeout(r, 11000)); // catálogo em cache 10 s
const rs = await Promise.all(buyers.map((t) => call('POST', `${ST}/checkout`, { token: t, body: { lines: [{ productCode: code, quantity: 1 }], ...geo } })));
const reserved = Number((await c.query("SELECT COALESCE(SUM(i.quantity),0) q FROM web_order_items i JOIN web_orders o ON o.id=i.order_id WHERE i.product_code=$1 AND o.status <> 'CANCELLED'", [code])).rows[0].q);
R.check('LJ-5', '12 compras simultâneas de 3 unidades: no máximo 3 em encomendas ativas, sem 5xx', reserved <= 3 && rs.every((r) => r.status < 500), `${rs.filter((r) => r.status < 300).length} aceites, ${reserved} unidades em encomendas, stock ${await stock(np.id)}, estados ${[...new Set(rs.map((r) => r.status))].join(',')}`);
// pagar todas as aceites: o stock nunca fica negativo
for (const r of rs.filter((x) => x.status < 300)) await call('POST', `/ecommerce/orders/${r.body.id}/pay`, { token: adm });
R.check('LJ-6', 'depois de pagas, o stock não fica negativo', (await stock(np.id)) >= 0, `stock ${await stock(np.id)}`);

// cupões
const mkC = (body) => call('POST', '/ecommerce/coupons', { token: adm, body });
const cu = await mkC({ code: `QA${tag}`, type: 'PERCENT', value: 10, maxUses: 1, perCustomer: 1, isActive: true });
R.check('LJ-7', 'criar cupão de 10 %', cu.status < 300, `${cu.status} ${JSON.stringify(cu.body).slice(0, 150)}`);
const big = await mkC({ code: `QB${tag}`, type: 'PERCENT', value: 150, isActive: true });
R.check('LJ-8', 'cupão de 150 % é recusado', big.status >= 400, `${big.status} ${JSON.stringify(big.body).slice(0, 120)}`);
const exp = await mkC({ code: `QC${tag}`, type: 'AMOUNT', value: 100, endsAt: '2020-01-01', isActive: true });
const amt = await mkC({ code: `QD${tag}`, type: 'AMOUNT', value: 99999999, isActive: true });
const base = await ok('POST', `${ST}/checkout`, { token: b2, body: { lines: [{ productCode: P[6].code, quantity: 1 }], ...geo } });
const u1 = await call('POST', `${ST}/checkout`, { token: b1, body: { lines: [{ productCode: P[6].code, quantity: 1 }], couponCode: `QA${tag}`, ...geo } });
const u2 = await call('POST', `${ST}/checkout`, { token: b2, body: { lines: [{ productCode: P[6].code, quantity: 1 }], couponCode: `QA${tag}`, ...geo } });
const full = await total(base.id), g1 = u1.status < 300 ? await total(u1.body.id) : null;
R.check('LJ-9', 'cupão de 10 % desconta 10 % do total', g1 != null && Math.abs(g1 - Math.round(full * 0.9 * 100) / 100) <= 0.02, `sem cupão ${full}, com cupão ${g1} (${u1.status} ${JSON.stringify(u1.body).slice(0, 100)})`);
R.check('LJ-10', 'segunda utilização de um cupão com limite 1 é recusada (ou sem desconto)', u2.status >= 400 || (await total(u2.body.id)) === full, `${u2.status} ${JSON.stringify(u2.body).slice(0, 100)}`);
const ue = await call('POST', `${ST}/checkout`, { token: b1, body: { lines: [{ productCode: P[7].code, quantity: 1 }], couponCode: `QC${tag}`, ...geo } });
R.check('LJ-11', 'cupão expirado é recusado', exp.status >= 400 || ue.status >= 400, `criar ${exp.status} usar ${ue.status} ${JSON.stringify(ue.body).slice(0, 100)}`);
const ua = await call('POST', `${ST}/checkout`, { token: b1, body: { lines: [{ productCode: P[8].code, quantity: 1 }], couponCode: `QD${tag}`, ...geo } });
const ga = ua.status < 300 ? await total(ua.body.id) : null;
R.check('LJ-12', 'cupão de valor superior à compra nunca dá total negativo', amt.status >= 400 || ua.status >= 400 || ga >= 0, `criar ${amt.status} usar ${ua.status} total ${ga}`);
const anonC = await call('POST', `${ST}/checkout`, { body: { lines: [{ productCode: P[8].code, quantity: 1 }], couponCode: `QD${tag}`, ...geo } });
R.check('LJ-13', 'cupão sem sessão é recusado', anonC.status === 401 || anonC.status === 403, anonC.status);

// acesso a dados de outro cliente
const mine = await call('GET', `${ST}/my/orders`, { token: b2 });
R.check('LJ-14', 'a lista do cliente 2 não mostra a encomenda do cliente 1', mine.status < 300 && !JSON.stringify(mine.body).includes(o1.body?.id), mine.status);
const anon = await call('GET', `${ST}/my/orders`);
R.check('LJ-15', 'lista de encomendas sem sessão é recusada', anon.status === 401 || anon.status === 403, anon.status);
const guess = await call('GET', `${ST}/orders/00000000-0000-4000-8000-000000000000`);
const bad = await call('GET', `${ST}/orders/${encodeURIComponent("' OR 1=1--")}`);
R.check('LJ-16', 'encomenda inexistente ou id malformado → 4xx (sem 5xx)', guess.status >= 400 && guess.status < 500 && bad.status >= 400 && bad.status < 500, `${guess.status} ${bad.status}`);
const other = await call('GET', `/store/super-palanca-qa/orders/${o1.body?.id}`);
R.check('LJ-17', 'encomenda da empresa E não se lê pela loja de outra empresa', other.status >= 400, other.status);
const loc = await call('POST', `${ST}/orders/${o1.body?.id}/location`, { token: b2, body: { lat: 1, lng: 1 } });
const locRow = (await c.query('SELECT geo_lat FROM web_orders WHERE id=$1', [o1.body?.id])).rows[0];
R.check('LJ-18', 'cliente 2 não altera a localização da encomenda do cliente 1', loc.status >= 400 || Number(locRow.geo_lat) !== 1, `${loc.status} geo_lat=${locRow.geo_lat}`);

// pagamento forjado
for (const [name, headers] of [['sem segredo', {}], ['com segredo errado', { 'x-emis-secret': 'errado' }]]) {
  const r = await call('POST', `${ST}/payments/reference/callback`, { headers, body: { reference: '123456789', amount: 1 } });
  R.check('LJ-19', `callback de pagamento ${name} é recusado`, r.status === 403 || r.status === 503, r.status);
}
const st1 = (await c.query('SELECT status FROM web_orders WHERE id=$1', [o1.body?.id])).rows[0]?.status;
const prf = await call('POST', `${ST}/orders/${o1.body?.id}/proof`, { body: { reference: 'x', imageBase64: 'PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', mimeType: 'text/html', fileName: 'a.html' } });
const st2 = (await c.query('SELECT status FROM web_orders WHERE id=$1', [o1.body?.id])).rows[0]?.status;
R.check('LJ-20', 'comprovativo enviado pelo cliente nunca marca a encomenda como paga', st2 !== 'PAID', `${prf.status} ${st1}→${st2} ${JSON.stringify(prf.body).slice(0, 120)}`);
const exA = await call('POST', `${ST}/orders/${o1.body?.id}/pay/express`, { body: { phone: '923000000' } });
const st3 = (await c.query('SELECT status FROM web_orders WHERE id=$1', [o1.body?.id])).rows[0]?.status;
R.check('LJ-21', '"paguei por Express" declarado pelo cliente não marca como paga sem confirmação da loja', st3 !== 'PAID', `${exA.status} estado ${st3}`);

// ciclo: pagar → stock; cancelar
const pay = await call('POST', `/ecommerce/orders/${o1.body?.id}/pay`, { token: adm });
const pay2 = await call('POST', `/ecommerce/orders/${o1.body?.id}/pay`, { token: adm });
const invs = (await c.query('SELECT COUNT(*) n FROM invoices i WHERE i.id IN (SELECT invoice_id FROM web_orders WHERE id=$1)', [o1.body?.id])).rows[0].n;
const q1 = await stock(p.id);
R.check('LJ-22', 'marcar paga duas vezes: uma fatura e o stock baixa 2 uma só vez', pay.status < 300 && q0 - q1 === 2 && Number(invs) === 1, `pagar ${pay.status}/${pay2.status} faturas=${invs} stock ${q0}→${q1}`);
const o3 = await ok('POST', `${ST}/checkout`, { token: b1, body: { lines: [{ productCode: P[9].code, quantity: 4 }], ...geo } });
const s0 = await stock(P[9].id);
const can = await call('POST', `/ecommerce/orders/${o3.id}/cancel`, { token: adm, body: { reason: 'QA' } });
const can2 = await call('POST', `/ecommerce/orders/${o3.id}/cancel`, { token: adm, body: { reason: 'QA' } });
const payC = await call('POST', `/ecommerce/orders/${o3.id}/pay`, { token: adm });
const s1 = await stock(P[9].id);
R.check('LJ-23', 'encomenda cancelada não pode ser paga e o stock não muda', can.status < 300 && payC.status >= 400 && s1 === s0, `cancelar ${can.status}/${can2.status} pagar ${payC.status} stock ${s0}→${s1}`);

await c.end();
const s = R.summary(); fs.mkdirSync('qa/out', { recursive: true }); fs.writeFileSync('qa/out/loja.json', JSON.stringify(s, null, 1));
console.log(`\n${s.passed}/${s.total} passaram; ${s.failed} falharam`);
