/**
 * QA — percurso completo do LPS Kwanza, como o utilizador o descreveu:
 * associado cria conta e associa-se a um produto → o cliente (sem conta) abre a ligação,
 * compra DENTRO do LPS Kwanza com GPS obrigatório → o associado acompanha no painel
 * (comprou, pagamento enviado, paga, em entrega, entregue) e o saldo sobe quando a empresa
 * marca paga → pede o saque. O cliente acompanha as suas compras e envia a localização.
 * Uso: node qa/kwanza-compra.mjs  (empresa B de qa/seed-cinco.mjs; só localhost)
 */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { call, ok, db, Report } from './lib.mjs';

const S = JSON.parse(fs.readFileSync(process.env.QA_CINCO ?? 'qa/.cinco.json', 'utf8'));
const R = new Report('kwanza-compra');
const CODE = 'grossista-kuanza-qa', K = '/kwanza', AK = '/ecommerce/kwanza';
const login = async (email) => { const r = await ok('POST', '/auth/login', { body: { email, password: S.pass } }); return r.tokens?.accessToken ?? r.accessToken; };
const adm = await login(S.B.email);
const c = await db(S.B.schema);
const tag = String(Date.now()).slice(-7);
const P = S.B.products[60 + (Number(tag) % 60)];
const geo = { geoLat: -8.8383, geoLng: 13.2344, geoAccuracy: 8, geoConsent: true };
const device = randomUUID();

await ok('POST', '/erp/stock/entry', { token: adm, body: { productId: P.id, warehouseId: S.B.storeId, quantity: 20, unitCost: P.cost } });
await ok('PATCH', `${AK}/products/${P.code}`, { token: adm, body: { published: true, percent: 10, mode: 'OPEN', allowMarkup: false, maxMarkupPct: null, materials: [] } });

// 1. associado cria conta e associa-se ao produto
const a = await ok('POST', `${K}/auth/register`, { body: { name: 'Associado Percurso', phone: `91${tag}`, password: 'segredo123' } });
const af = await call('POST', `${K}/me/affiliations`, { token: a.token, body: { companyCode: CODE, productCode: P.code } });
R.check('KP-1', 'associado cria conta e associa-se ao produto (afiliação aberta → aprovada)', af.status < 300 && af.body.status === 'APPROVED', `${af.status} ${JSON.stringify(af.body)}`);
const listing = (await ok('GET', `${K}/market`, { token: a.token })).find((l) => l.companyCode === CODE && l.productCode === P.code);
const viaLink = await call('GET', `${K}/listing/${CODE}/${P.code}?a=${a.associate.code}`);
const noLink = await call('GET', `${K}/listing/${CODE}/${P.code}?a=ZZZZZZ`);
const gone = await call('GET', `${K}/listing/${CODE}/NAO-EXISTE`);
R.check('KP-1b', 'cliente sem conta abre a ligação do associado (sem publicação) e vê o produto com o associado', viaLink.status === 200 && viaLink.body.associate?.code === a.associate.code && noLink.status === 200 && !noLink.body.associate && gone.status === 404, `${viaLink.status} ${viaLink.body?.associate?.code} ${noLink.status} ${gone.status}`);
const dash = async () => ok('GET', `${K}/me/dashboard`, { token: a.token });
const d0 = await dash();
const bal0 = d0.companies.find((x) => x.companyCode === CODE)?.balance ?? 0;

// 2. cliente sem conta compra no LPS Kwanza
const body = { companyCode: CODE, associateCode: a.associate.code, lines: [{ productCode: P.code, quantity: 2 }], name: 'Cliente do Associado', phone: `+244 92${tag.slice(0, 1)} ${tag.slice(1, 4)} ${tag.slice(4)}`, address: 'Rua 21 de Janeiro, Talatona', deliveryMethod: 'DELIVERY', paymentMethod: 'CASH', device };
const noGps = await call('POST', `${K}/checkout`, { body });
const noConsent = await call('POST', `${K}/checkout`, { body: { ...body, ...geo, geoConsent: false } });
R.check('KP-2', 'compra sem GPS (ou sem consentimento) é recusada', noGps.status === 400 && noConsent.status === 400 && /GPS/.test(JSON.stringify(noConsent.body)), `${noGps.status} ${noConsent.status}`);
const noAddr = await call('POST', `${K}/checkout`, { body: { ...body, ...geo, address: '' } });
R.check('KP-3', 'entrega sem morada é recusada', noAddr.status === 400, noAddr.status);
const notPub = await call('POST', `${K}/checkout`, { body: { ...body, ...geo, lines: [{ productCode: S.B.products[149].code, quantity: 1 }] } });
R.check('KP-4', 'produto que a empresa não publicou no LPS Kwanza é recusado', notPub.status === 400, `${notPub.status} ${notPub.body?.message}`);
const buy = await call('POST', `${K}/checkout`, { body: { ...body, ...geo } });
R.check('KP-5', 'cliente sem conta compra no LPS Kwanza e recebe o código para acompanhar', buy.status < 300 && /^[A-Za-z0-9_-]{20,}$/.test(buy.body?.token ?? '') && !!buy.body.orderNumber, `${buy.status} ${JSON.stringify(buy.body).slice(0, 200)}`);
const o = (await c.query('SELECT * FROM web_orders WHERE id=$1', [buy.body.orderId])).rows[0];
R.check('KP-6', 'a encomenda nasce na empresa com o associado, o telefone e a localização GPS exata', o && o.affiliate_code === a.associate.code && o.customer_phone?.endsWith(tag.slice(1)) && Number(o.geo_lat) === geo.geoLat && o.status === 'PENDING', JSON.stringify({ aff: o?.affiliate_code, phone: o?.customer_phone, lat: o?.geo_lat, st: o?.status }));
R.check('KP-7', 'total = 2 × preço do marketplace', Math.abs(Number(o.gross_total) - 2 * listing.grossPrice) < 0.02, `${o.gross_total} vs ${2 * listing.grossPrice}`);
const notes = await ok('GET', '/notifications', { token: adm });
R.check('KP-8', 'a empresa é avisada (LPS Kwanza, GPS, associado)', notes.items.some((n) => n.title.includes(buy.body.orderNumber) && /associado/.test(n.body ?? '')), notes.items[0]?.title);

// 3. associado acompanha: comprou
let d1 = await dash(); let s = d1.sales.find((x) => x.orderNumber === buy.body.orderNumber);
const expected = Math.round(2 * listing.grossPrice * 10) / 100;
R.check('KP-9', 'o associado vê a venda logo: encomenda feita, comissão em processo', s && s.orderStatus === 'PENDING' && s.state === 'PENDING' && Math.abs(s.amount - expected) < 0.02, JSON.stringify(s));
const an = await ok('GET', `${K}/me/notifications`, { token: a.token });
R.check('KP-10', 'o associado é notificado da venda', an.items.some((n) => n.kind === 'SALE'), an.items[0]?.title);

// 4. cliente acompanha a sua compra
const mine = await ok('POST', `${K}/orders/list`, { body: { tokens: [buy.body.token, 'x'.repeat(30)] } });
R.check('KP-11', 'o cliente vê as suas compras (código guardado no aparelho)', mine.length === 1 && mine[0].orderNumber === buy.body.orderNumber && mine[0].items[0].quantity === 2 && mine[0].phone === undefined, JSON.stringify(mine[0] ?? null).slice(0, 200));
const found = await call('POST', `${K}/orders/find`, { body: { phone: `92${tag}`, orderNumber: buy.body.orderNumber.toLowerCase() } });
const wrong = await call('POST', `${K}/orders/find`, { body: { phone: '929999999', orderNumber: buy.body.orderNumber } });
R.check('KP-12', 'recuperar noutro aparelho com telefone + n.º; telefone errado → 404', found.status < 300 && found.body.token === buy.body.token && wrong.status === 404, `${found.status} ${wrong.status}`);
const loc = await call('POST', `${K}/orders/${buy.body.token}/location`, { body: { lat: -8.84, lng: 13.24, accuracy: 5 } });
const o2 = (await c.query('SELECT geo_lat FROM web_orders WHERE id=$1', [buy.body.orderId])).rows[0];
const guess = await call('POST', `${K}/orders/${'A'.repeat(24)}/location`, { body: { lat: 1, lng: 1 } });
R.check('KP-13', 'o cliente envia a localização em tempo real; código inventado → 404', loc.status < 300 && Number(o2.geo_lat) === -8.84 && guess.status === 404, `${loc.status} ${o2.geo_lat} ${guess.status}`);

// 5. cliente envia comprovativo → associado vê "pagamento enviado"
await call('POST', `/store/${CODE}/orders/${buy.body.orderId}/proof`, { body: { methodType: 'BANK_TRANSFER', amount: Number(o.gross_total), reference: 'TRF123', fileName: 'c.png', fileMime: 'image/png', fileData: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' } });
d1 = await dash(); s = d1.sales.find((x) => x.orderNumber === buy.body.orderNumber);
R.check('KP-14', 'comprovativo enviado: o associado vê "pagamento enviado" (ainda não paga)', s.paymentClaimed === true && s.state === 'PENDING', JSON.stringify(s));

// 6. empresa marca paga → saldo sobe
const pay = await call('POST', `/ecommerce/orders/${buy.body.orderId}/pay`, { token: adm });
d1 = await dash(); s = d1.sales.find((x) => x.orderNumber === buy.body.orderNumber);
const bal1 = d1.companies.find((x) => x.companyCode === CODE)?.balance ?? 0;
R.check('KP-15', 'a empresa marca paga: estado "paga", comissão disponível e o saldo sobe na hora', pay.status < 300 && s.orderStatus === 'PAID' && s.state === 'AVAILABLE' && Math.abs(bal1 - bal0 - expected) < 0.02, `pagar ${pay.status} ${s.orderStatus}/${s.state} saldo ${bal0}→${bal1}`);
const v1 = await ok('GET', `${K}/orders/${buy.body.token}`);
R.check('KP-16', 'o cliente vê a compra paga', v1.status === 'PAID', v1.status);

// 7. entrega
const ship = await call('POST', `/ecommerce/orders/${buy.body.orderId}/ship`, { token: adm });
d1 = await dash(); s = d1.sales.find((x) => x.orderNumber === buy.body.orderNumber);
const v2 = await ok('GET', `${K}/orders/${buy.body.token}`);
R.check('KP-17', 'a empresa sai para entrega: associado e cliente veem "em entrega"', ship.status < 300 && s.orderStatus === 'SHIPPED' && v2.status === 'SHIPPED', `${ship.status} ${s.orderStatus} ${v2.status}`);
const dl = await call('POST', `/ecommerce/orders/${buy.body.orderId}/deliver`, { token: adm });
d1 = await dash(); s = d1.sales.find((x) => x.orderNumber === buy.body.orderNumber);
const loc2 = await call('POST', `${K}/orders/${buy.body.token}/location`, { body: { lat: 1, lng: 1 } });
const o3 = (await c.query('SELECT geo_lat FROM web_orders WHERE id=$1', [buy.body.orderId])).rows[0];
R.check('KP-18', 'entregue: associado vê "entregue"; a localização deixa de ser seguida', dl.status < 300 && s.orderStatus === 'DELIVERED' && s.state === 'AVAILABLE' && Number(o3.geo_lat) !== 1, `${dl.status} ${s.orderStatus} loc ${loc2.status} lat ${o3.geo_lat}`);

// 8. saque
await ok('POST', `${K}/me/accounts`, { token: a.token, body: { method: 'Multicaixa Express', holder: 'Associado Percurso', details: `92${tag}` } });
const acc = (await ok('GET', `${K}/me/accounts`, { token: a.token }))[0];
const wd = await call('POST', `${K}/me/withdrawals`, { token: a.token, body: { companyCode: CODE, amount: bal1, accountId: acc.id } });
const d2 = await dash();
R.check('KP-19', 'o associado pede o saque de todo o saldo; o saldo disponível fica a 0', wd.status < 300 && (d2.companies.find((x) => x.companyCode === CODE)?.balance ?? 0) === 0, `${wd.status} ${JSON.stringify(wd.body).slice(0, 100)}`);

// 9. sem comissão das próprias compras; cancelamento
const self = await ok('POST', `${K}/checkout`, { body: { ...body, ...geo, phone: `91${tag}`, device: randomUUID() } });
const selfRow = (await c.query('SELECT affiliate_code FROM web_orders WHERE id=$1', [self.orderId])).rows[0];
d1 = await dash();
R.check('KP-20', 'compra feita pelo próprio associado não gera comissão', !selfRow.affiliate_code && !d1.sales.some((x) => x.orderNumber === self.orderNumber), `aff=${selfRow.affiliate_code}`);
const b2 = await ok('POST', `${K}/checkout`, { body: { ...body, ...geo, device: randomUUID() } });
await call('POST', `/ecommerce/orders/${b2.orderId}/cancel`, { token: adm, body: { reason: 'QA' } });
d1 = await dash(); s = d1.sales.find((x) => x.orderNumber === b2.orderNumber);
R.check('KP-21', 'encomenda cancelada: o associado vê "cancelada" e não ganha comissão', s?.orderStatus === 'CANCELLED' && s.state === 'CANCELLED', JSON.stringify(s));
const noAssoc = await ok('POST', `${K}/checkout`, { body: { ...body, ...geo, associateCode: undefined, device: randomUUID() } });
R.check('KP-22', 'compra direta no marketplace (sem associado) também funciona', !!noAssoc.orderNumber, noAssoc.orderNumber);

await c.end();
const sum = R.summary(); fs.mkdirSync('qa/out', { recursive: true }); fs.writeFileSync('qa/out/kwanza-compra.json', JSON.stringify(sum, null, 1));
console.log(`\n${sum.passed}/${sum.total} passaram; ${sum.failed} falharam`);
