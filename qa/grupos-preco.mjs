/**
 * QA (só localhost) — GRUPOS DE PREÇO (paridade Vendus): o cliente de um grupo
 * compra ao preço do grupo (decidido no servidor); sem grupo ou sem preço no
 * grupo vale o preço normal; apagar o grupo deixa o cliente sem grupo.
 * Uso: node qa/grupos-preco.mjs  (API de QA na 3901)
 */
import fs from 'node:fs';
import { call, ok, db, uuid, Report } from './lib.mjs';

const R = new Report('grupos-preco');
const tok = (r) => r.tokens?.accessToken ?? r.accessToken;
const tag = String(Date.now()).slice(-6);
const pub = await db('nexus_public');
try {
  const plan = (await ok('GET', '/public/landing')).plans?.[0]?.tier ?? 'STARTER';
  const email = `qa-gp-${tag}@qa.test`;
  await ok('POST', '/onboarding/register-simple', { body: { email, password: 'QaTeste#2026x', planTier: plan, nif: `56${tag}01` } });
  let A = tok(await ok('POST', '/auth/login', { body: { email, password: 'QaTeste#2026x' } }));
  await ok('POST', '/onboarding/complete-setup', { token: A, body: { name: `QA Grupos ${tag} Lda`, nif: `56${tag}01`, address: 'Rua 1', city: 'Luanda' } });
  A = tok(await ok('POST', '/auth/login', { body: { email, password: 'QaTeste#2026x' } }));
  await call('POST', '/cashbox/session/open', { token: A, body: { openingFloat: 0 } });

  const p1 = await ok('POST', '/pos/products', { token: A, body: { code: `GP1${tag}`, name: 'Creme', ivaCode: 'NOR', unitPrice: 1000, costPrice: 0, stockQty: 100 } });
  const p2 = await ok('POST', '/pos/products', { token: A, body: { code: `GP2${tag}`, name: 'Sabonete', ivaCode: 'NOR', unitPrice: 500, costPrice: 0, stockQty: 100 } });
  const g = await ok('POST', '/pos/price-groups', { token: A, body: { name: 'Revendedores' } });
  const dup = await call('POST', '/pos/price-groups', { token: A, body: { name: 'Revendedores' } });
  R.check('GP-1', 'cria grupo de preço; nome repetido recusado', !!g.id && dup.status === 409, `${dup.status}`);

  await ok('PUT', `/pos/price-groups/${g.id}/prices`, { token: A, body: { prices: [{ productId: p1.id, unitPrice: 800 }] } });
  const pr = await ok('GET', `/pos/price-groups/${g.id}/prices`, { token: A });
  R.check('GP-2', 'preço do grupo guardado (só o produto com preço próprio)', pr.length === 1 && Number(pr[0].unit_price) === 800 && Number(pr[0].base_price) === 1000, JSON.stringify(pr));

  const cust = await ok('POST', '/pos/customers', { token: A, body: { name: 'Revendedora Ana', priceGroupId: g.id } });
  const plain = await ok('POST', '/pos/customers', { token: A, body: { name: 'Cliente Normal' } });
  R.check('GP-3', 'cliente criado no grupo', cust.price_group_id === g.id && !plain.price_group_id, JSON.stringify({ a: cust.price_group_id, b: plain.price_group_id }));

  const sell = (customerId) => call('POST', '/pos/invoices', { token: A, body: { docType: 'FT', paymentType: 'CASH', clientOpId: uuid(), customerId, lines: [{ productCode: `GP1${tag}`, quantity: 2 }, { productCode: `GP2${tag}`, quantity: 1 }] } });
  const s1 = await sell(cust.id);
  const s2 = await sell(plain.id);
  const s3 = await sell(undefined);
  R.check('GP-4', 'cliente do grupo paga 2×800 + 1×500 (líquido 2100); outros pagam 2×1000 + 500 (2500)', Number(s1.body.netTotal) === 2100 && Number(s2.body.netTotal) === 2500 && Number(s3.body.netTotal) === 2500, `${s1.body.netTotal} ${s2.body.netTotal} ${s3.body.netTotal}`);

  await ok('PATCH', `/pos/customers/${plain.id}`, { token: A, body: { priceGroupId: g.id } });
  const s4 = await sell(plain.id);
  await ok('PATCH', `/pos/customers/${plain.id}`, { token: A, body: { priceGroupId: '' } });
  const s5 = await sell(plain.id);
  R.check('GP-5', 'mudar o cliente de grupo muda o preço da venda seguinte (entra 2100, sai 2500)', Number(s4.body.netTotal) === 2100 && Number(s5.body.netTotal) === 2500, `${s4.body.netTotal} ${s5.body.netTotal}`);

  await ok('PUT', `/pos/price-groups/${g.id}/prices`, { token: A, body: { prices: [{ productId: p1.id, unitPrice: null }] } });
  const s6 = await sell(cust.id);
  R.check('GP-6', 'retirar o preço do grupo → volta o preço normal', Number(s6.body.netTotal) === 2500, `${s6.body.netTotal}`);

  await ok('DELETE', `/pos/price-groups/${g.id}`, { token: A });
  const list = await ok('GET', '/pos/customers', { token: A });
  const after = (Array.isArray(list) ? list : list.items ?? []).find((c) => c.id === cust.id);
  R.check('GP-7', 'apagar o grupo deixa o cliente sem grupo', after && !after.price_group_id, JSON.stringify(after?.price_group_id));
  void p2;
} catch (e) {
  R.check('GP-ERRO', 'cenário terminou sem exceção', false, e instanceof Error ? e.stack?.slice(0, 400) : String(e));
} finally {
  await pub.end();
}
fs.mkdirSync('qa/out', { recursive: true });
const sum = R.summary();
console.log(`\n${sum.passed}/${sum.total} passaram; ${sum.failed} falharam`);
process.exit(sum.failed ? 1 : 0);
