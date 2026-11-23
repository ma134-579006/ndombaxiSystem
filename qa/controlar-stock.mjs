/**
 * QA (só localhost) — "Controlar stock: Não" (paridade Vendus): serviço/artigo sem
 * controlo vende sempre, não abate stock e a anulação não o repõe; com controlo
 * (por omissão) continua a bloquear sem stock.
 * Uso: node qa/controlar-stock.mjs  (API de QA na 3901)
 */
import fs from 'node:fs';
import { call, ok, db, uuid, Report } from './lib.mjs';

const R = new Report('controlar-stock');
const tok = (r) => r.tokens?.accessToken ?? r.accessToken;
const tag = String(Date.now()).slice(-6);
const pub = await db('nexus_public');
try {
  const plan = (await ok('GET', '/public/landing')).plans?.[0]?.tier ?? 'STARTER';
  const email = `qa-cs-${tag}@qa.test`;
  await ok('POST', '/onboarding/register-simple', { body: { email, password: 'QaTeste#2026x', planTier: plan, nif: `55${tag}01` } });
  let A = tok(await ok('POST', '/auth/login', { body: { email, password: 'QaTeste#2026x' } }));
  await ok('POST', '/onboarding/complete-setup', { token: A, body: { name: `QA Stock ${tag} Lda`, nif: `55${tag}01`, address: 'Rua 1', city: 'Luanda' } });
  A = tok(await ok('POST', '/auth/login', { body: { email, password: 'QaTeste#2026x' } }));
  const schema = (await pub.query(`SELECT "schemaName" FROM nexus_public.companies WHERE "responsibleEmail" = $1`, [email])).rows[0].schemaName;
  const sch = await db(schema);
  await call('POST', '/cashbox/session/open', { token: A, body: { openingFloat: 0 } });

  const srv = await ok('POST', '/pos/products', { token: A, body: { code: `SRV${tag}`, name: 'Corte de cabelo', ivaCode: 'NOR', unitPrice: 2000, costPrice: 0, stockQty: 0, trackStock: false } });
  const art = await ok('POST', '/pos/products', { token: A, body: { code: `ART${tag}`, name: 'Champô', ivaCode: 'NOR', unitPrice: 1500, costPrice: 0, stockQty: 0 } });
  const list = await ok('GET', '/pos/products', { token: A });
  const ls = (Array.isArray(list) ? list : list.items ?? []).find((p) => p.code === `SRV${tag}`);
  const la = (Array.isArray(list) ? list : list.items ?? []).find((p) => p.code === `ART${tag}`);
  R.check('CS-1', 'produto criado com "Controlar stock: Não" e listado assim (o normal fica "Sim")', srv && ls?.track_stock === false && la?.track_stock === true, JSON.stringify({ srv: ls?.track_stock, art: la?.track_stock }));

  const sell = (code, q) => call('POST', '/pos/invoices', { token: A, body: { docType: 'FT', paymentType: 'CASH', clientOpId: uuid(), lines: [{ productCode: code, quantity: q }] } });
  const s1 = await sell(`SRV${tag}`, 5);
  const st1 = (await sch.query(`SELECT stock_qty::numeric AS q FROM products WHERE code = $1`, [`SRV${tag}`])).rows[0].q;
  const mv1 = Number((await sch.query(`SELECT COUNT(*)::int AS n FROM stock_movements m JOIN products p ON p.id = m.product_id WHERE p.code = $1`, [`SRV${tag}`])).rows[0].n);
  R.check('CS-2', 'sem controlo: vende 5 com stock 0, sem baixa nem movimento de stock', s1.status < 300 && Number(st1) === 0 && mv1 === 0, `${s1.status} stock=${st1} movimentos=${mv1} ${s1.status >= 300 ? JSON.stringify(s1.body).slice(0, 160) : ''}`);

  const s2 = await sell(`ART${tag}`, 1);
  R.check('CS-3', 'com controlo (omissão): stock 0 continua a recusar a venda', s2.status === 400 && /Stock insuficiente/.test(JSON.stringify(s2.body)), `${s2.status}`);

  const nc = s1.status < 300 ? await call('POST', `/pos/invoices/${s1.body.id}/cancel`, { token: A, body: { reason: 'Teste QA anulação serviço' } }) : { status: 0 };
  const st2 = (await sch.query(`SELECT stock_qty::numeric AS q FROM products WHERE code = $1`, [`SRV${tag}`])).rows[0].q;
  R.check('CS-4', 'anular a venda do serviço não repõe stock (continua 0)', nc.status < 300 && Number(st2) === 0, `${nc.status} stock=${st2}`);

  await ok('PATCH', `/pos/products/${art.id}`, { token: A, body: { trackStock: false } });
  const s3 = await sell(`ART${tag}`, 2);
  await ok('PATCH', `/pos/products/${art.id}`, { token: A, body: { trackStock: true } });
  const s4 = await sell(`ART${tag}`, 1);
  R.check('CS-5', 'editar o produto liga/desliga o controlo (desligado vende; ligado volta a bloquear)', s3.status < 300 && s4.status === 400, `${s3.status} ${s4.status}`);
  await sch.end();
} catch (e) {
  R.check('CS-ERRO', 'cenário terminou sem exceção', false, e instanceof Error ? e.stack?.slice(0, 400) : String(e));
} finally {
  await pub.end();
}
fs.mkdirSync('qa/out', { recursive: true });
const sum = R.summary();
console.log(`\n${sum.passed}/${sum.total} passaram; ${sum.failed} falharam`);
process.exit(sum.failed ? 1 : 0);
