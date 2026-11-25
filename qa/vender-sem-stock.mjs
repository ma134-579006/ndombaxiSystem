/**
 * QA (só localhost) — "Permitir vender produtos sem stock" (paridade Vendus:
 * Configurações → Stock). Desligado por omissão: a falta de stock bloqueia a
 * Caixa, a loja online e a publicação no LPS Kwanza. Ligado pelo gestor: tudo
 * vende com stock nulo e o saldo fica negativo. Desligar volta a bloquear.
 * Uso: node qa/vender-sem-stock.mjs  (API de QA na 3901)
 */
import fs from 'node:fs';
import { call, ok, db, uuid, Report } from './lib.mjs';

const R = new Report('vender-sem-stock');
const tok = (r) => r.tokens?.accessToken ?? r.accessToken;
const tag = String(Date.now()).slice(-6);
const pub = await db('nexus_public');
try {
  const plan = (await ok('GET', '/public/landing')).plans?.[0]?.tier ?? 'STARTER';
  const email = `qa-vss-${tag}@qa.test`;
  const pass = 'QaTeste#2026x';
  await ok('POST', '/onboarding/register-simple', { body: { email, password: pass, planTier: plan, nif: `56${tag}01` } });
  let A = tok(await ok('POST', '/auth/login', { body: { email, password: pass } }));
  await ok('POST', '/onboarding/complete-setup', { token: A, body: { name: `QA Sem Stock ${tag} Lda`, nif: `56${tag}01`, address: 'Rua 1', city: 'Luanda' } });
  const lg = await ok('POST', '/auth/login', { body: { email, password: pass } });
  A = tok(lg);
  const comp = (await pub.query(`SELECT "schemaName", code FROM nexus_public.companies WHERE "responsibleEmail" = $1`, [email])).rows[0];
  const code = lg.companyCode ?? comp.code;
  const sch = await db(comp.schemaName);
  await call('POST', '/cashbox/session/open', { token: A, body: { openingFloat: 0 } });

  const pc = `VSS${tag}`;
  await ok('POST', '/pos/products', { token: A, body: { code: pc, name: 'Garrafa de água', ivaCode: 'NOR', unitPrice: 500, costPrice: 200, stockQty: 0, showOnline: true } });
  const stockOf = async () => Number((await sch.query(`SELECT stock_qty::numeric AS q FROM products WHERE code = $1`, [pc])).rows[0].q);
  const sell = (q) => call('POST', '/pos/invoices', { token: A, body: { docType: 'FT', paymentType: 'CASH', clientOpId: uuid(), lines: [{ productCode: pc, quantity: q }] } });
  const geo = { geoLat: -8.83, geoLng: 13.23, geoAccuracy: 10, geoConsent: true };
  const buyer = async () => (await ok('POST', `/store/${code}/auth/quick`, { body: { name: 'Comprador QA', phone: `93${tag}1`.slice(0, 9) } })).token;
  const catItem = async () => { const c = await call('GET', `/store/${code}/catalog`); const list = Array.isArray(c.body) ? c.body : c.body?.products ?? c.body?.items ?? []; return list.find((p) => p.code === pc); };
  const publish = () => call('PATCH', `/ecommerce/kwanza/products/${pc}`, { token: A, body: { published: true, percent: 10, mode: 'OPEN', allowMarkup: false, maxMarkupPct: null, materials: [] } });

  const s0 = await ok('GET', '/site/settings', { token: A });
  R.check('VSS-1', 'por omissão a opção está DESLIGADA', s0.allow_sell_without_stock === false, JSON.stringify({ v: s0.allow_sell_without_stock }));

  const v1 = await sell(1);
  R.check('VSS-2', 'desligada: a Caixa recusa vender com stock 0', v1.status === 400 && /Stock insuficiente/.test(JSON.stringify(v1.body)), `${v1.status}`);
  const c1 = await catItem();
  R.check('VSS-3', 'desligada: a loja online mostra o produto esgotado', c1 && c1.inStock === false, JSON.stringify(c1 ?? null).slice(0, 160));
  const b = await buyer();
  const o1 = await call('POST', `/store/${code}/checkout`, { token: b, body: { lines: [{ productCode: pc, quantity: 1 }], ...geo } });
  R.check('VSS-4', 'desligada: a encomenda online é recusada', o1.status === 400, `${o1.status} ${JSON.stringify(o1.body).slice(0, 120)}`);
  const k1 = await publish();
  R.check('VSS-5', 'desligada: não publica no LPS Kwanza sem stock', k1.status === 400, `${k1.status}`);

  await ok('PATCH', '/site/settings', { token: A, body: { allowSellWithoutStock: true } });
  const s1 = await ok('GET', '/site/settings', { token: A });
  const id1 = await ok('GET', '/fiscal/document-identity', { token: A });
  R.check('VSS-6', 'o gestor liga a opção e a Caixa recebe-a (document-identity)', s1.allow_sell_without_stock === true && id1.sellWithoutStock === true, JSON.stringify({ s: s1.allow_sell_without_stock, id: id1.sellWithoutStock }));

  const v2 = await sell(3);
  const st2 = await stockOf();
  R.check('VSS-7', 'ligada: a Caixa vende 3 com stock 0 e o stock fica -3', v2.status < 300 && st2 === -3, `${v2.status} stock=${st2} ${v2.status >= 300 ? JSON.stringify(v2.body).slice(0, 160) : ''}`);
  const c2 = await catItem();
  R.check('VSS-8', 'ligada: a loja online mostra disponível e sem limite de quantidade', c2 && c2.inStock === true && c2.stockQty === undefined, JSON.stringify(c2 ?? null).slice(0, 160));
  const o2 = await call('POST', `/store/${code}/checkout`, { token: b, body: { lines: [{ productCode: pc, quantity: 2 }], ...geo } });
  R.check('VSS-9', 'ligada: a encomenda online é aceite', o2.status < 300 && !!o2.body?.id, `${o2.status} ${JSON.stringify(o2.body).slice(0, 160)}`);
  const k2 = await publish();
  R.check('VSS-10', 'ligada: publica no LPS Kwanza (loja dos associados) sem stock', k2.status < 300, `${k2.status} ${JSON.stringify(k2.body).slice(0, 120)}`);

  await ok('PATCH', '/site/settings', { token: A, body: { allowSellWithoutStock: false } });
  const v3 = await sell(1);
  const c3 = await catItem();
  R.check('VSS-11', 'desligar volta a bloquear a Caixa e a loja online', v3.status === 400 && c3 && c3.inStock === false, `${v3.status} inStock=${c3?.inStock}`);
  await sch.end();
} catch (e) {
  R.check('VSS-ERRO', 'cenário terminou sem exceção', false, e instanceof Error ? e.stack?.slice(0, 400) : String(e));
} finally {
  await pub.end();
}
fs.mkdirSync('qa/out', { recursive: true });
const sum = R.summary();
console.log(`\n${sum.passed}/${sum.total} passaram; ${sum.failed} falharam`);
process.exit(sum.failed ? 1 : 0);
