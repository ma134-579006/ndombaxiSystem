/**
 * QA — Loja dos associados (/<loja>/associados), casos-limite (missão QA, fase 7). Só localhost.
 *
 * Complementa qa/associados-real.mjs (fluxo feliz, saldo, saque acima do saldo, saques em
 * simultâneo). Aqui:
 *   X1  quem não é associado aprovado (sem sessão, NONE, PENDING, REJECTED) não entra em nada
 *   X2  máquina de estados: pedir 2×, recusar, pedir de novo, aprovar, revogar
 *   X3  5 contas de saque em simultâneo → nunca mais de 3
 *   X4  isolamento: apagar / sacar para a conta de outro associado → recusado
 *   X5  valores inválidos no saque (0, negativo, texto, 3 casas) → recusados ou arredondados
 *   X6  associado revogado: a ligação deixa de dar comissão; ao ser reaprovado o saldo volta intacto
 *   X7  saques seguidos do saldo inteiro (não simultâneos) → o 2.º é recusado
 *   X8  isolamento entre empresas: o gestor de E não aprova/revoga membros de B
 *
 * Uso: QA_CINCO=<.cinco.json> node qa/associados-loja-extra.mjs
 */
import fs from 'node:fs';
import { call, ok, db, Report } from './lib.mjs';

const S = JSON.parse(fs.readFileSync(process.env.QA_CINCO ?? 'qa/.cinco.json', 'utf8'));
const R = new Report('associados-loja-extra');
const tag = String(Date.now()).slice(-6);
const geo = { geoLat: -8.8383, geoLng: 13.2344, geoAccuracy: 8, geoConsent: true };
const near = (a, b) => Math.abs(a - b) < 0.02;
const login = async (email) => { const r = await ok('POST', '/auth/login', { body: { email, password: S.pass } }); return r.tokens?.accessToken ?? r.accessToken; };

const B = { k: 'B', code: 'grossista-kuanza-qa' };
const E = { k: 'E', code: 'loja-welwitschia-qa' };
for (const co of [B, E]) { co.adm = await login(S[co.k].email); co.db = await db(S[co.k].schema); co.sch = S[co.k].schema; }
const st = (p) => `/store/${B.code}${p}`;

let n = 0;
async function cliente(nome) {
  n++;
  const email = `lx${tag}${n}@x.qa.test`;
  const q = await ok('POST', st('/auth/quick'), { body: { name: `${nome} ${n}`, email, phone: `93${tag}${n}`.slice(0, 9) } });
  return { email, tk: q.token ?? q.accessToken ?? q.tokens?.accessToken };
}
const rows = (r) => (Array.isArray(r) ? r : r.rows);
const estado = async (c) => (await ok('GET', st('/my/membership'), { token: c.tk })).status;
const membroId = async (c) => rows(await B.db.query('SELECT id FROM customers WHERE lower(email) = $1', [c.email]))[0].id;
const ROTAS = [['GET', '/members/catalog'], ['GET', '/members/banners'], ['GET', '/members/market'], ['GET', '/members/affiliate'], ['GET', '/members/accounts'],
  ['POST', '/members/accounts', { method: 'Multicaixa Express', holder: 'Teste', details: '923000000' }], ['POST', '/members/withdrawals', { amount: 1, method: 'Multicaixa Express', details: '923000000' }]];
const bloqueado = async (tk) => Promise.all(ROTAS.map(async ([m, p, body]) => [p, (await call(m, st(p), { token: tk, body })).status]));

// ── X1 + X2 ──────────────────────────────────────────────────────────────────
{
  const semSessao = await bloqueado(undefined);
  const c = await cliente('Estados');
  const none = await bloqueado(c.tk);
  const e0 = await estado(c);
  await ok('POST', st('/my/membership/request'), { token: c.tk, body: { note: 'quero' } });
  const r2 = await call('POST', st('/my/membership/request'), { token: c.tk, body: { note: 'outra vez' } });
  const pend = await bloqueado(c.tk);
  const e1 = await estado(c);
  const id = await membroId(c);
  await ok('POST', `/ecommerce/members/${id}/reject`, { token: B.adm });
  const rej = await bloqueado(c.tk);
  const e2 = await estado(c);
  await ok('POST', st('/my/membership/request'), { token: c.tk, body: { note: 'reconsiderem' } });
  const e3 = await estado(c);
  await ok('POST', `/ecommerce/members/${id}/approve`, { token: B.adm });
  const e4 = await estado(c);
  const aprov = await Promise.all(ROTAS.slice(0, 5).map(async ([m, p]) => [p, (await call(m, st(p), { token: c.tk })).status]));
  await ok('POST', `/ecommerce/members/${id}/revoke`, { token: B.adm });
  const e5 = await estado(c);
  const rev = await bloqueado(c.tk);
  const negado = (l) => l.every(([, s]) => s >= 400 && s < 500);
  const fmt = (l) => [...new Set(l.map(([, s]) => s))].join('/');
  R.check('X1a', 'Sem sessão: as 7 rotas da área de associados são recusadas (4xx)', negado(semSessao), fmt(semSessao));
  R.check('X1b', 'Cliente NONE, PENDING, REJECTED e revogado: as 7 rotas são recusadas (4xx)', [none, pend, rej, rev].every(negado), [none, pend, rej, rev].map(fmt).join(' | '));
  R.check('X1c', 'Recusa com 403 (proibido), não 400 (pedido inválido)', [none, pend, rej, rev].every((l) => l.every(([, s]) => s === 403)), [none, pend, rej, rev].map(fmt).join(' | '));
  R.check('X2a', 'Estados: NONE → pedir → PENDING; pedir 2.ª vez não muda nada', e0 === 'NONE' && e1 === 'PENDING' && r2.status < 300, `${e0} → ${e1} (2.º pedido ${r2.status})`);
  R.check('X2b', 'Recusar → REJECTED; pedir de novo → PENDING; aprovar → APPROVED (as 5 leituras abrem); revogar → NONE', e2 === 'REJECTED' && e3 === 'PENDING' && e4 === 'APPROVED' && aprov.every(([, s]) => s < 300) && e5 === 'NONE', `${e2} → ${e3} → ${e4} (${fmt(aprov)}) → ${e5}`);
}

// ── X3 + X4 + X5 ─────────────────────────────────────────────────────────────
const aprovar = async (c) => { await ok('POST', st('/my/membership/request'), { token: c.tk, body: {} }); await ok('POST', `/ecommerce/members/${await membroId(c)}/approve`, { token: B.adm }); };
{
  const a = await cliente('Contas A'); const b = await cliente('Contas B');
  await aprovar(a); await aprovar(b);
  const add = await Promise.all([0, 1, 2, 3, 4].map((i) => call('POST', st('/members/accounts'), { token: a.tk, body: { method: 'Transferência bancária', bank: 'BAI', holder: 'Contas A', details: `AO06 0040 0000 ${1000 + i}` } })));
  const contas = await ok('GET', st('/members/accounts'), { token: a.tk });
  R.check('X3', '5 contas de saque em simultâneo → no máximo 3 gravadas', contas.length <= 3, `${add.filter((r) => r.status < 300).length} aceites, ${contas.length} gravadas`);

  // Mesmo caso no LPS Kwanza (associado do marketplace).
  const kr = await ok('POST', '/kwanza/auth/register', { body: { name: `Kwanza contas ${tag}`, phone: `96${tag}0`.slice(0, 9), password: 'segredo123' } });
  await Promise.all([0, 1, 2, 3, 4].map((i) => call('POST', '/kwanza/me/accounts', { token: kr.token, body: { method: 'Transferência bancária', bank: 'BFA', holder: 'Kwanza contas', details: `AO06 0006 0000 ${2000 + i}` } })));
  const kc = await ok('GET', '/kwanza/me/accounts', { token: kr.token });
  R.check('X3b', 'LPS Kwanza: 5 contas de saque em simultâneo → no máximo 3 gravadas', kc.length <= 3, `${kc.length} gravadas`);

  const delOutro = await call('POST', st(`/members/accounts/${contas[0].id}/delete`), { token: b.tk });
  const sacOutro = await call('POST', st('/members/withdrawals'), { token: b.tk, body: { amount: 1, accountId: contas[0].id } });
  const ainda = await ok('GET', st('/members/accounts'), { token: a.tk });
  R.check('X4', 'Associado B não apaga nem saca para a conta de A', delOutro.status >= 400 && sacOutro.status >= 400 && ainda.length === contas.length, `apagar ${delOutro.status}, sacar ${sacOutro.status}`);

  const vals = await Promise.all([0, -5, 'abc', null, 1e12].map(async (v) => [v, (await call('POST', st('/members/withdrawals'), { token: a.tk, body: { amount: v, accountId: contas[0].id } })).status]));
  R.check('X5', 'Saque com 0, negativo, texto, vazio ou acima do saldo → recusado (4xx)', vals.every(([, s]) => s >= 400 && s < 500), vals.map(([v, s]) => `${v}:${s}`).join(' '));
}

// ── X6 + X7 ──────────────────────────────────────────────────────────────────
{
  const P = S.B.products[45 + (Number(tag) % 15)];
  await ok('POST', '/erp/stock/entry', { token: B.adm, body: { productId: P.id, warehouseId: S.B.storeId, quantity: 50, unitCost: P.cost } });
  await B.db.query('UPDATE products SET show_online = TRUE, affiliate_percent = 10 WHERE id = $1', [P.id]);
  const c = await cliente('Revogado'); await aprovar(c);
  const code = (await ok('GET', st('/members/affiliate'), { token: c.tk })).code;
  const comprar = async (i) => ok('POST', st('/checkout'), { body: { lines: [{ productCode: P.code, quantity: 1 }], customerName: `Comprador ${i}`, customerPhone: `92${tag}${i}`.slice(0, 9), deliveryMethod: 'PICKUP', paymentMethod: 'CASH', ...geo, affiliateCode: code } });
  const o1 = await comprar(1); await ok('POST', `/ecommerce/orders/${o1.orderId ?? o1.id}/pay`, { token: B.adm });
  const s1 = await ok('GET', st('/members/affiliate'), { token: c.tk });
  const id = await membroId(c);
  await ok('POST', `/ecommerce/members/${id}/revoke`, { token: B.adm });
  const o2 = await comprar(2);
  const com2 = rows(await B.db.query('SELECT COUNT(*)::int AS n FROM affiliate_commissions WHERE order_id = $1', [o2.orderId ?? o2.id]))[0].n;
  await ok('POST', st('/my/membership/request'), { token: c.tk, body: {} });
  await ok('POST', `/ecommerce/members/${id}/approve`, { token: B.adm });
  const s2 = await ok('GET', st('/members/affiliate'), { token: c.tk });
  R.check('X6', 'Revogado: a ligação deixa de dar comissão; reaprovado: mesmo código e o saldo volta intacto', s1.balance > 0 && com2 === 0 && s2.code === code && near(s2.balance, s1.balance), `saldo ${s1.balance} → ${s2.balance}, comissões na compra pós-revogação ${com2}, código ${code}/${s2.code}`);

  const w1 = await call('POST', st('/members/withdrawals'), { token: c.tk, body: { amount: s2.balance, method: 'Multicaixa Express', details: '923000001' } });
  const w2 = await call('POST', st('/members/withdrawals'), { token: c.tk, body: { amount: s2.balance, method: 'Multicaixa Express', details: '923000001' } });
  const s3 = await ok('GET', st('/members/affiliate'), { token: c.tk });
  R.check('X7', 'Dois saques seguidos do saldo inteiro → o 2.º é recusado; saldo 0 e pedido = saldo', w1.status < 300 && w2.status >= 400 && s3.balance === 0 && near(s3.requested, s2.balance), `${w1.status}/${w2.status}, saldo ${s3.balance}, pedido ${s3.requested}`);
}

// ── X8 ───────────────────────────────────────────────────────────────────────
{
  const c = await cliente('Isolamento');
  await ok('POST', st('/my/membership/request'), { token: c.tk, body: {} });
  const id = await membroId(c);
  const ap = await call('POST', `/ecommerce/members/${id}/approve`, { token: E.adm });
  const rv = await call('POST', `/ecommerce/members/${id}/revoke`, { token: E.adm });
  const lista = await ok('GET', '/ecommerce/members', { token: E.adm });
  const e = await estado(c);
  R.check('X8', 'Gestor da empresa E não aprova, não revoga nem vê membros da empresa B', ap.status >= 400 && rv.status >= 400 && !lista.some((m) => m.email === c.email) && e === 'PENDING', `aprovar ${ap.status}, revogar ${rv.status}, estado ${e}`);
}

for (const co of [B, E]) await co.db.end();
fs.mkdirSync('qa/out', { recursive: true });
const s = R.summary();
fs.writeFileSync('qa/out/associados-loja-extra.json', JSON.stringify(s, null, 1));
console.log(`\n${s.passed}/${s.total} PASS`);
process.exit(s.failed ? 1 : 0);
