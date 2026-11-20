/**
 * QA — carga do ciclo do associado (só localhost/staging).
 *
 * Empresa E (Loja Welwitschia), 1 produto aberto com preço próprio até +20 %.
 *  - 4 associados afiliam-se (A1 com preço próprio +10 %).
 *  - 1 cliente faz 6 encomendas pela ligação de A1 (mesmo telefone).
 *  - 12 clientes diferentes compram pela ligação de A2 (em paralelo).
 *  - 1 cliente compra pelas ligações de A1, A3 e A4 (uma encomenda por associado).
 *  - Compra sem morada (só GPS) é aceite.
 *  - A empresa confirma o pagamento de todas e entrega metade; cancela 1 de A2.
 *  - Painel de cada associado: pendente/disponível certos (comissão + margem do preço próprio).
 *  - Saques em simultâneo: 5 pedidos do saldo inteiro de A2 ao mesmo tempo → só 1 passa;
 *    A1 pede 2 saques que somam o saldo → ambos passam; um 3.º acima do saldo é recusado.
 *  - A empresa paga os saques; saldos finais conferem.
 *
 * Uso: node qa/ciclo-carga.mjs
 */
import fs from 'node:fs';
import { call, ok, Report } from './lib.mjs';

const S = JSON.parse(fs.readFileSync(process.env.QA_CINCO ?? 'qa/.cinco.json', 'utf8'));
const R = new Report('ciclo-carga');
const K = '/kwanza', AK = '/ecommerce/kwanza';
const tag = String(Date.now()).slice(-6);
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const near = (a, b) => Math.abs(a - b) < 0.05;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const geo = { geoLat: -8.8383, geoLng: 13.2344, geoAccuracy: 7, geoConsent: true };
const login = async (email) => { const r = await ok('POST', '/auth/login', { body: { email, password: S.pass } }); return r.tokens?.accessToken ?? r.accessToken; };
async function kcheckout(body) {
  for (;;) { const r = await call('POST', `${K}/checkout`, { body }); if (r.status !== 429) return r; await sleep(12000); }
}

// ── empresa e produto ──────────────────────────────────────────────────────
const adm = await login(S.E.email);
const P = S.E.products[(Number(tag) % 30) + 5];
await ok('POST', '/erp/stock/entry', { token: adm, body: { productId: P.id, warehouseId: S.E.storeId, quantity: 400, unitCost: P.cost } });
await ok('PATCH', `${AK}/products/${P.code}`, { token: adm, body: { published: true, materials: [], percent: 10, mode: 'OPEN', allowMarkup: true, maxMarkupPct: 20 } });
const mk0 = await ok('GET', `${K}/market?_=${tag}`);
const CODE = mk0.find((l) => l.productCode === P.code)?.companyCode ?? 'loja-welwitschia-qa';

// ── 4 associados ───────────────────────────────────────────────────────────
const A = [];
for (let i = 0; i < 4; i++) {
  const r = await ok('POST', `${K}/auth/register`, { body: { name: `Carga ${i + 1} ${tag}`, phone: `91${tag}${i}`.slice(0, 9), password: 'segredo123' } });
  await ok('POST', `${K}/me/accounts`, { token: r.token, body: { method: 'Transferência bancária', bank: 'BFA', holder: `Carga ${i + 1}`, details: `AO06 0040 0000 ${tag}${i}` } });
  const acc = (await ok('GET', `${K}/me/accounts`, { token: r.token }))[0];
  A.push({ i, token: r.token, code: r.associate.code, accountId: acc.id });
}
const bulk = await Promise.all(A.map((a) => ok('POST', `${K}/me/affiliations/bulk`, { token: a.token, body: { items: [{ companyCode: CODE, productCode: P.code }] } })));
R.check('CC-1', '4 associados afiliam-se (em paralelo)', bulk.every((x) => x[0]?.status === 'APPROVED'), JSON.stringify(bulk.map((x) => x[0]?.status)));
await ok('POST', `${K}/me/markup`, { token: A[0].token, body: { companyCode: CODE, productCode: P.code, markupPct: 10 } });
const L = await ok('GET', `${K}/listing/${CODE}/${P.code}`);
const base = L.grossPrice;
const priceA1 = (await ok('GET', `${K}/listing/${CODE}/${P.code}?a=${A[0].code}`)).grossPrice;
R.check('CC-2', 'A1 vende a +10 % (preço visto pelo cliente)', near(priceA1, r2(base * 1.1)), `${priceA1} vs ${r2(base * 1.1)}`);

const orders = []; // { a, id, amount }
const commission = (a, qty) => r2(base * 0.10 * qty + (a === A[0] ? r2(priceA1 - base) * qty : 0));
const buy = async (a, phone, qty, extra = {}) => {
  const r = await kcheckout({ companyCode: CODE, associateCode: a.code, lines: [{ productCode: P.code, quantity: qty }], name: `Cliente ${phone}`, phone, address: 'Rua Carga QA', deliveryMethod: 'DELIVERY', paymentMethod: 'CASH', ...geo, ...extra });
  if (r.status < 300) orders.push({ a, id: r.body.orderId, n: r.body.orderNumber, amount: commission(a, qty), total: r.body.grossTotal, qty });
  return r;
};

// 1 cliente, 6 encomendas, 1 associado
const one = `92${tag}9`.slice(0, 9);
const r1 = [];
for (let k = 0; k < 6; k++) r1.push(await buy(A[0], one, 1 + (k % 3)));
R.check('CC-3', '1 cliente faz 6 encomendas pela ligação de A1', r1.every((x) => x.status < 300), r1.map((x) => x.status).join(','));
const t1 = orders.filter((o) => o.a === A[0]).reduce((s, o) => s + o.total, 0);
R.check('CC-4', 'as encomendas de A1 cobram o preço próprio de A1', orders.filter((o) => o.a === A[0]).every((o) => near(o.total, r2(priceA1 * o.qty))), `total ${r2(t1)}`);

// 12 clientes, 1 associado (em paralelo, em grupos para o limite anti-abuso)
const rr = [];
for (let g = 0; g < 3; g++) rr.push(...await Promise.all(Array.from({ length: 4 }, (_, j) => buy(A[1], `93${tag}${g}${j}`.slice(0, 9), 1))));
R.check('CC-5', '12 clientes diferentes compram pela ligação de A2', rr.every((x) => x.status < 300) && orders.filter((o) => o.a === A[1]).length === 12, rr.map((x) => x.status).join(','));

// 1 cliente, 3 associados
const multi = `94${tag}8`.slice(0, 9);
const rm = [await buy(A[0], multi, 1), await buy(A[2], multi, 2), await buy(A[3], multi, 1)];
R.check('CC-6', '1 cliente compra pelas ligações de 3 associados (cada encomenda fica com o seu)', rm.every((x) => x.status < 300), rm.map((x) => x.status).join(','));

// Sem morada (só GPS)
const rn = await buy(A[3], `95${tag}7`.slice(0, 9), 1, { address: undefined });
R.check('CC-7', 'compra sem morada (só GPS) é aceite', rn.status < 300, `${rn.status} ${rn.body?.message ?? ''}`);
const rg = await call('POST', `${K}/checkout`, { body: { companyCode: CODE, associateCode: A[3].code, lines: [{ productCode: P.code, quantity: 1 }], name: 'Sem GPS', phone: `95${tag}6`.slice(0, 9), deliveryMethod: 'DELIVERY', paymentMethod: 'CASH' } });
R.check('CC-8', 'compra sem GPS é recusada', rg.status === 400 || rg.status === 429, `${rg.status}`);

// ── painel: tudo pendente ──────────────────────────────────────────────────
const dash = async (a) => (await ok('GET', `${K}/me/dashboard`, { token: a.token })).companies.find((c) => c.companyCode === CODE) ?? { pending: 0, available: 0, balance: 0, withdrawn: 0, requested: 0 };
const exp = (a, f) => r2(orders.filter((o) => o.a === a && f(o)).reduce((s, o) => s + o.amount, 0));
let d = await Promise.all(A.map(dash));
R.check('CC-9', 'antes de pagar: comissões em processo certas para os 4', A.every((a, i) => near(d[i].pending, exp(a, () => true)) && near(d[i].available, 0)), d.map((x, i) => `${x.pending}/${exp(A[i], () => true)}`).join(' '));

// ── empresa: paga todas, entrega metade, cancela 1 de A2 ───────────────────
const cancelO = orders.find((o) => o.a === A[1]);
await ok('POST', `/ecommerce/orders/${cancelO.id}/cancel`, { token: adm });
cancelO.cancelled = true;
let k = 0;
for (const o of orders.filter((x) => !x.cancelled)) {
  await ok('POST', `/ecommerce/orders/${o.id}/pay`, { token: adm });
  if (k++ % 2 === 0) { await ok('POST', `/ecommerce/orders/${o.id}/ship`, { token: adm }); await ok('POST', `/ecommerce/orders/${o.id}/deliver`, { token: adm }); }
}
d = await Promise.all(A.map(dash));
R.check('CC-10', 'depois de pagas: tudo disponível, a cancelada sai, nada pendente', A.every((a, i) => near(d[i].available, exp(a, (o) => !o.cancelled)) && near(d[i].pending, 0)), d.map((x, i) => `${x.available}/${exp(A[i], (o) => !o.cancelled)} p${x.pending}`).join(' '));

// ── saques ─────────────────────────────────────────────────────────────────
const wd = (a, amount) => call('POST', `${K}/me/withdrawals`, { token: a.token, body: { companyCode: CODE, amount, accountId: a.accountId } });
const bal2 = d[1].balance;
const conc = await Promise.all(Array.from({ length: 5 }, () => wd(A[1], bal2)));
R.check('CC-11', '5 saques do saldo inteiro de A2 ao mesmo tempo → só 1 passa', conc.filter((x) => x.status < 300).length === 1, conc.map((x) => x.status).join(','));
const bal1 = d[0].balance;
const half = r2(Math.floor(bal1 * 50) / 100);
const w1 = await wd(A[0], half), w2 = await wd(A[0], r2(bal1 - half)), w3 = await wd(A[0], 1);
R.check('CC-12', 'A1: dois saques que somam o saldo passam; um 3.º acima do saldo é recusado', w1.status < 300 && w2.status < 300 && w3.status === 400, `${w1.status},${w2.status},${w3.status}`);
const d1 = await dash(A[0]);
R.check('CC-13', 'saldo de A1 fica 0 e o pedido soma o que pediu', near(d1.balance, 0) && near(d1.requested, bal1), `saldo ${d1.balance} pedido ${d1.requested} de ${bal1}`);

const list = (await ok('GET', `${AK}/withdrawals`, { token: adm })).filter((w) => w.status === 'REQUESTED' && String(w.name ?? '').includes(tag));
R.check('CC-14', 'a empresa vê os 3 pedidos de saque (2 de A1 + 1 de A2)', list.length === 3, `${list.length}`);
for (const w of list) await ok('POST', `${AK}/withdrawals/${w.id}/pay`, { token: adm, body: { note: `Transf ${tag}` } });
d = await Promise.all(A.map(dash));
R.check('CC-15', 'pagos: levantado = pedido, saldo 0 em A1 e A2', near(d[0].withdrawn, bal1) && near(d[1].withdrawn, bal2) && near(d[0].balance, 0) && near(d[1].balance, 0), `A1 ${d[0].withdrawn}/${bal1} A2 ${d[1].withdrawn}/${bal2}`);
R.check('CC-16', 'A3 e A4 mantêm o saldo intacto', near(d[2].balance, exp(A[2], () => true)) && near(d[3].balance, exp(A[3], (o) => !o.cancelled)), `${d[2].balance} ${d[3].balance}`);

fs.mkdirSync('qa/out', { recursive: true });
const s = R.summary();
fs.writeFileSync('qa/out/ciclo-carga.json', JSON.stringify(s, null, 1));
console.log(`\n${s.passed}/${s.total} passaram; ${s.failed} falharam`);
