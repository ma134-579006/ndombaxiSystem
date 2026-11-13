/**
 * QA — teste real das regras de saque do LPS Kwanza (só localhost/staging).
 *
 * 3 empresas, 8 associados, dezenas de clientes sem conta a comprar pelas ligações:
 *  • B (Grossista Kuanza)  — CUMPRE: paga todos os saques dentro do prazo.
 *  • C (Tecno Mussulo)     — ATRASA mas RESPEITA o Super Admin: não paga no prazo, os
 *                            associados reclamam, o Super Admin avisa (+24 h) e a empresa paga.
 *  • E (Loja Welwitschia)  — NÃO PAGA: reclamação, aviso, 24 h extra passam, o Super Admin
 *                            bane a empresa e reembolsa os associados (fica a dívida).
 * Em cada passo confere: painéis dos associados (em processo, disponível, levantado, pedido,
 * saldo), painel da empresa, contadores do Super Admin, notificações de todos, concorrência
 * (avisos e banimentos em simultâneo só passam uma vez) e que o resto do marketplace continua.
 * Os prazos são antecipados na base (o mesmo que esperar as 24 h).
 *
 * Uso: QA_LOG=<registo da API> node qa/saques-real.mjs
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes } from 'node:crypto';
import { call, ok, db, Report, sleep } from './lib.mjs';

const require = createRequire(import.meta.url);
const S = JSON.parse(fs.readFileSync(process.env.QA_CINCO ?? 'qa/.cinco.json', 'utf8'));
const R = new Report('saques-real');
const K = '/kwanza', AK = '/ecommerce/kwanza';
const tag = String(Date.now()).slice(-6);
const geo = { geoLat: -8.8383, geoLng: 13.2344, geoAccuracy: 8, geoConsent: true };
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const near = (a, b) => Math.abs(a - b) < 0.05;
const tok = (r) => r?.tokens?.accessToken ?? r?.accessToken;

/* ── empresas ── */
const CO = [
  { k: 'B', role: 'cumpre' },
  { k: 'C', role: 'respeita' },
  { k: 'E', role: 'nao-paga' },
];
const pub = await db();
for (const co of CO) {
  co.adm = tok(await ok('POST', '/auth/login', { body: { email: S[co.k].email, password: S.pass } }));
  co.db = await db(S[co.k].schema);
  co.id = S[co.k].tenantId;
  // Empresa que tenha ficado banida de corridas antigas volta ao marketplace.
  await pub.query('DELETE FROM nexus_public.kwanza_bans WHERE "companyId" = $1', [co.id]);
  const base = 5 + (Number(tag) % 20);
  co.prods = [S[co.k].products[base], S[co.k].products[base + 1]].filter(Boolean);
  for (const p of co.prods) {
    await ok('POST', '/erp/stock/entry', { token: co.adm, body: { productId: p.id, warehouseId: S[co.k].storeId, quantity: 300, unitCost: p.cost } });
    await ok('PATCH', `${AK}/products/${p.code}`, { token: co.adm, body: { published: true, percent: 12, mode: 'OPEN', allowMarkup: false, maxMarkupPct: null, materials: [] } });
  }
  await ok('PUT', `${AK}/banks`, { token: co.adm, body: { banks: co.k === 'B' ? ['BFA', 'BAI'] : co.k === 'C' ? ['BIC'] : ['BAI', 'Banco Sol'] } });
  co.code = (await ok('GET', `${K}/market`)).find((l) => co.prods.some((p) => p.code === l.productCode))?.companyCode;
  if (!co.code) {
    const reg = await ok('POST', `${K}/auth/register`, { body: { name: `Sonda ${co.k}${tag}`, phone: `94${tag}${co.k.charCodeAt(0) % 10}`.slice(0, 9), password: 'segredo123' } });
    co.code = (await ok('GET', `${K}/market`, { token: reg.token })).find((l) => co.prods.some((p) => p.code === l.productCode))?.companyCode;
  }
}
R.check('RE-0', '3 empresas com produtos publicados e bancos definidos', CO.every((c) => c.code && c.prods.length === 2), CO.map((c) => c.code).join(' '));

/* ── 8 associados, contas em bancos diferentes, afiliados às 3 empresas ── */
const BANKS = ['BFA', 'BIC', 'BAI', 'Banco Sol'];
const A = [];
for (let i = 0; i < 8; i++) {
  const phone = `96${tag}${i}`.slice(0, 9);
  const r = await ok('POST', `${K}/auth/register`, { body: { name: `Associado Real ${i + 1} ${tag}`, phone, password: 'segredo123' } });
  await ok('POST', `${K}/me/accounts`, { token: r.token, body: { method: 'Transferência bancária', bank: BANKS[i % 4], holder: `Associado Real ${i + 1}`, details: `AO06 0040 0000 ${tag}${i}` } });
  const acc = (await ok('GET', `${K}/me/accounts`, { token: r.token }))[0].id;
  for (const co of CO) for (const p of co.prods) await ok('POST', `${K}/me/affiliations`, { token: r.token, body: { companyCode: co.code, productCode: p.code } });
  A.push({ i, token: r.token, code: r.associate.code, phone, acc, bank: BANKS[i % 4] });
}
R.check('RE-1', '8 associados com conta bancária e afiliados aos produtos das 3 empresas', A.length === 8);

/* ── clientes sem conta compram pelas ligações ── */
const exp = new Map(); // `${assoc}|${co}` → { pending, available, withdrawn, requested }
const E = (a, co) => { const k = `${a.code}|${co.code}`; if (!exp.has(k)) exp.set(k, { pending: 0, available: 0, withdrawn: 0, requested: 0 }); return exp.get(k); };
const orders = [];
let n = 0;
async function checkout(body) { for (;;) { const r = await call('POST', `${K}/checkout`, { body }); if (r.status !== 429) return r; await sleep(15000); } }
for (const co of CO) {
  for (const a of A) {
    const buys = 1 + (a.i % 3);
    for (let b = 0; b < buys; b++) {
      const p = co.prods[b % 2];
      const r = await checkout({ companyCode: co.code, associateCode: a.code, lines: [{ productCode: p.code, quantity: 1 + ((a.i + b) % 3) }], name: `Cliente Real ${++n}`, phone: `92${tag}${String(n).padStart(2, '0')}`.slice(0, 9), address: 'Rua Rainha Ginga, Luanda', deliveryMethod: 'DELIVERY', paymentMethod: 'CASH', device: randomUUID(), ...geo });
      if (r.status >= 300) { R.check('RE-V', `compra em ${co.code}`, false, `${r.status} ${JSON.stringify(r.body).slice(0, 150)}`); continue; }
      const k = (await pub.query('SELECT COALESCE(SUM(amount),0)::float s FROM nexus_public.kwanza_commissions WHERE "orderId" = $1', [r.body.orderId])).rows[0].s;
      orders.push({ a, co, id: r.body.orderId, amount: k });
      E(a, co).pending = r2(E(a, co).pending + k);
    }
  }
}
R.check('RE-2', `${orders.length} compras reais de clientes sem conta pelas ligações dos 8 associados`, orders.length >= 40 && orders.every((o) => o.amount > 0), orders.length);

// As empresas marcam as encomendas pagas (os clientes pagaram na entrega).
for (const o of orders) {
  await ok('POST', `/ecommerce/orders/${o.id}/pay`, { token: o.co.adm });
  const e = E(o.a, o.co); e.pending = r2(e.pending - o.amount); e.available = r2(e.available + o.amount);
}
const panels = async (id, label) => {
  const bad = [];
  for (const a of A) {
    const d = await ok('GET', `${K}/me/dashboard`, { token: a.token });
    for (const co of CO) {
      const e = E(a, co), g = d.companies.find((c) => c.companyCode === co.code) ?? { pending: 0, available: 0, withdrawn: 0, requested: 0, balance: 0 };
      const bal = r2(Math.max(0, e.available - e.withdrawn - e.requested));
      if (!near(g.pending, e.pending) || !near(g.available, e.available) || !near(g.withdrawn, e.withdrawn) || !near(g.requested, e.requested) || !near(g.balance, bal)) bad.push(`${a.code}@${co.k} esp d${e.available}/l${e.withdrawn}/r${e.requested}/s${bal} painel d${g.available}/l${g.withdrawn}/r${g.requested}/s${g.balance}`);
    }
  }
  R.check(id, label, bad.length === 0, bad.slice(0, 2).join(' | ') || 'todos certos');
};
await panels('RE-3', 'painéis dos 8 associados certos depois de as empresas marcarem as compras pagas');
{
  const d = await ok('GET', `${K}/me/dashboard`, { token: A[0].token });
  const banks = Object.fromEntries(d.companies.map((c) => [c.companyCode, c.banks]));
  R.check('RE-4', 'o associado vê os bancos de cada empresa', JSON.stringify(banks[CO[0].code]) === '["BFA","BAI"]' && JSON.stringify(banks[CO[1].code]) === '["BIC"]', JSON.stringify(banks));
}

/* ── todos os associados pedem saque a todas as empresas (metade do saldo) ── */
const W = []; // { a, co, id, amount }
for (const a of A) {
  for (const co of CO) {
    const d = await ok('GET', `${K}/me/dashboard`, { token: a.token });
    const bal = d.companies.find((c) => c.companyCode === co.code)?.balance ?? 0;
    if (bal < 2) continue;
    const v = r2(Math.floor(bal * 50) / 100);
    await ok('POST', `${K}/me/withdrawals`, { token: a.token, body: { companyCode: co.code, amount: v, accountId: a.acc } });
    const w = (await ok('GET', `${K}/me/dashboard`, { token: a.token })).withdrawals.find((x) => x.companyCode === co.code && x.status === 'REQUESTED' && near(x.amount, v));
    W.push({ a, co, id: w.id, amount: v });
    E(a, co).requested = r2(E(a, co).requested + v);
  }
}
R.check('RE-5', `${W.length} pedidos de saque (8 associados × 3 empresas), todos com prazo`, W.length >= 20 && W.every((w) => w.id), W.length);
await panels('RE-6', 'painéis certos com os saques em análise');
{
  const lists = await Promise.all(CO.map((co) => ok('GET', `${AK}/withdrawals`, { token: co.adm })));
  const okDue = CO.every((co, j) => W.filter((w) => w.co === co).every((w) => lists[j].some((x) => x.id === w.id && x.dueAt && x.code === w.a.code)));
  R.check('RE-7', 'cada empresa vê os seus pedidos com prazo e código do associado (e só os seus)', okDue && !lists[0].some((x) => W.some((w) => w.co !== CO[0] && w.id === x.id)));
}

/* ── B cumpre: paga tudo dentro do prazo ── */
for (const w of W.filter((x) => x.co.k === 'B')) {
  await ok('POST', `${AK}/withdrawals/${w.id}/pay`, { token: w.co.adm, body: { note: `TRF B ${tag}` } });
  const e = E(w.a, w.co); e.requested = r2(e.requested - w.amount); e.withdrawn = r2(e.withdrawn + w.amount);
}
await panels('RE-8', 'empresa B paga dentro do prazo: saldo levantado sobe, pedidos zeram');
{
  const early = await call('POST', `${K}/me/withdrawals/${W.find((x) => x.co.k === 'C').id}/complain`, { token: W.find((x) => x.co.k === 'C').a.token, body: {} });
  R.check('RE-9', 'antes do prazo ninguém consegue reclamar', early.status === 400, early.body?.message);
}

/* ── o prazo de C e E passa ── */
const late = W.filter((x) => x.co.k !== 'B');
await pub.query(`UPDATE nexus_public.kwanza_withdrawals SET "dueAt" = now() - interval '3 hours' WHERE id = ANY($1::uuid[])`, [late.map((w) => w.id)]);

// Super Admin de teste (só para esta corrida)
const argon2 = require('../apps/api/node_modules/argon2');
const saEmail = `qa-real-${tag}@qa.test`, saPass = randomBytes(9).toString('base64url');
await pub.query(`INSERT INTO nexus_public.platform_users (id, email, "passwordHash", name, role, "isActive", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'QA Real', 'SUPER_ADMIN', true, now(), now())`, [saEmail, await argon2.hash(saPass, { type: argon2.argon2id })]);
const SA = tok(await ok('POST', '/auth/super-admin/login', { body: { email: saEmail, password: saPass } }));

{
  const over = await ok('GET', '/super-admin/kwanza/withdrawals?status=overdue', { token: SA });
  const mine = over.rows.filter((r) => late.some((w) => w.id === r.id));
  R.check('RE-10', 'Super Admin vê os saques fora do prazo (ainda sem reclamação)', mine.length === late.length, `${mine.length}/${late.length}`);
}
// Todos os associados de C e E reclamam ao mesmo tempo (e alguns carregam duas vezes).
const comp = await Promise.all(late.flatMap((w) => [
  call('POST', `${K}/me/withdrawals/${w.id}/complain`, { token: w.a.token, body: { text: `Sem pagamento da ${w.co.k} (${w.a.code})` } }),
  ...(w.a.i % 2 ? [call('POST', `${K}/me/withdrawals/${w.id}/complain`, { token: w.a.token, body: {} })] : []),
]));
const compOk = comp.filter((r) => r.status === 200).length;
R.check('RE-11', 'reclamações em simultâneo: uma por saque (repetidas recusadas)', compOk === late.length, `${compOk} aceites / ${comp.length} pedidos`);
{
  const one = late[0];
  const byCode = await ok('GET', `/super-admin/kwanza/withdrawals?q=${one.a.code}`, { token: SA });
  R.check('RE-12', 'Super Admin encontra cada reclamação pelo código do associado', byCode.rows.some((r) => r.id === one.id && r.escalation === 'OPEN' && r.complaint?.includes(one.a.code)), byCode.rows.length);
  const rej = await call('POST', `${AK}/withdrawals/${one.id}/reject`, { token: one.co.adm, body: { note: 'não' } });
  R.check('RE-13', 'empresa com reclamação aberta já não consegue recusar o saque', rej.status === 400);
}

/* ── Super Admin avisa C e E (+24 h); cliques duplos em simultâneo ── */
const nt = await Promise.all(late.flatMap((w) => [call('POST', `/super-admin/kwanza/withdrawals/${w.id}/notify`, { token: SA, body: { note: 'Pague nas próximas 24 h.' } }), call('POST', `/super-admin/kwanza/withdrawals/${w.id}/notify`, { token: SA, body: {} })]));
R.check('RE-14', 'aviso às empresas: cada saque avisado uma só vez (duplo clique recusado)', nt.filter((r) => r.status === 200).length === late.length, `${nt.filter((r) => r.status === 200).length}/${late.length}`);
for (const co of CO.filter((c) => c.k !== 'B')) {
  const nWarn = (await co.db.query(`SELECT count(*)::int n FROM admin_notifications WHERE kind = 'KWANZA_WITHDRAWAL_WARNING' AND created_at > now() - interval '10 minutes'`)).rows[0].n;
  R.check(`RE-15${co.k}`, `empresa ${co.k} recebe um aviso por saque, com o prazo final`, nWarn >= late.filter((w) => w.co === co).length, nWarn);
}
{
  const notes = await pub.query(`SELECT count(*)::int n FROM nexus_public.kwanza_notifications n JOIN nexus_public.kwanza_associates a ON a.id = n."associateId" WHERE a.code = ANY($1) AND n.kind = 'WITHDRAWAL_ESCALATED'`, [late.map((w) => w.a.code)]);
  R.check('RE-16', 'cada associado é informado de que a empresa foi avisada', notes.rows[0].n >= late.length, notes.rows[0].n);
  const banEarly = await call('POST', `/super-admin/kwanza/withdrawals/${late.find((w) => w.co.k === 'E').id}/ban-refund`, { token: SA, body: { refundRef: 'X-1' } });
  R.check('RE-17', 'dentro das 24 h extra não se pode banir', banEarly.status === 400, banEarly.body?.message);
}

/* ── C respeita o Super Admin: paga dentro das 24 h extra ── */
for (const w of late.filter((x) => x.co.k === 'C')) {
  await ok('POST', `${AK}/withdrawals/${w.id}/pay`, { token: w.co.adm, body: { note: `TRF C ${tag}` } });
  const e = E(w.a, w.co); e.requested = r2(e.requested - w.amount); e.withdrawn = r2(e.withdrawn + w.amount);
}
{
  const closed = await ok('GET', '/super-admin/kwanza/withdrawals?status=closed', { token: SA });
  const cRows = closed.rows.filter((r) => late.some((w) => w.co.k === 'C' && w.id === r.id));
  R.check('RE-18', 'empresa C paga depois do aviso: reclamações resolvidas, sem banimento', cRows.length === late.filter((w) => w.co.k === 'C').length && cRows.every((r) => r.escalation === 'RESOLVED' && r.status === 'PAID' && !r.company.banned), cRows.length);
  const paidNotes = await pub.query(`SELECT count(*)::int n FROM nexus_public.kwanza_notifications n JOIN nexus_public.kwanza_associates a ON a.id = n."associateId" WHERE a.code = ANY($1) AND n.kind = 'WITHDRAWAL_PAID'`, [late.filter((w) => w.co.k === 'C').map((w) => w.a.code)]);
  R.check('RE-19', 'associados de C notificados do pagamento', paidNotes.rows[0].n >= late.filter((w) => w.co.k === 'C').length, paidNotes.rows[0].n);
}
await panels('RE-20', 'painéis certos: C pagou depois do aviso; E continua em análise');

/* ── E não paga: as 24 h extra passam → banir e reembolsar ── */
const eW = late.filter((x) => x.co.k === 'E');
const debtBefore = (await pub.query(`SELECT COALESCE(SUM(amount),0)::float s FROM nexus_public.kwanza_withdrawals WHERE "companyId" = $1 AND escalation = 'REFUNDED'`, [CO.find((c) => c.k === 'E').id])).rows[0].s;
await pub.query(`UPDATE nexus_public.kwanza_withdrawals SET "extendedUntil" = now() - interval '5 minutes' WHERE id = ANY($1::uuid[])`, [eW.map((w) => w.id)]);
// O 1.º reembolso bane a empresa; dois cliques em simultâneo no mesmo saque só passam uma vez.
const first = eW[0];
const dup = await Promise.all([1, 2].map((x) => call('POST', `/super-admin/kwanza/withdrawals/${first.id}/ban-refund`, { token: SA, body: { refundRef: `REEMB-${tag}-0`, note: `clique ${x}` } })));
R.check('RE-21', 'banir e reembolsar em duplo clique: só um passa', dup.filter((r) => r.status === 200).length === 1, dup.map((r) => r.status).join('/'));
for (const [j, w] of eW.slice(1).entries()) await ok('POST', `/super-admin/kwanza/withdrawals/${w.id}/ban-refund`, { token: SA, body: { refundRef: `REEMB-${tag}-${j + 1}` } });
for (const w of eW) { const e = E(w.a, w.co); e.requested = r2(e.requested - w.amount); e.withdrawn = r2(e.withdrawn + w.amount); }
await panels('RE-22', 'associados de E reembolsados pela plataforma: valor como recebido, pedido zerado');
{
  const d = await ok('GET', `${K}/me/dashboard`, { token: first.a.token });
  const w = d.withdrawals.find((x) => x.id === first.id);
  R.check('RE-23', 'o associado vê "Reembolsado" com a referência da transferência', w?.status === 'REFUNDED' && w.refundRef === `REEMB-${tag}-0`, `${w?.status} ${w?.refundRef}`);
  const refNotes = await pub.query(`SELECT count(*)::int n FROM nexus_public.kwanza_notifications n JOIN nexus_public.kwanza_associates a ON a.id = n."associateId" WHERE a.code = ANY($1) AND n.kind = 'WITHDRAWAL_REFUNDED'`, [eW.map((x) => x.a.code)]);
  R.check('RE-24', 'cada associado de E é notificado do reembolso', refNotes.rows[0].n >= eW.length, refNotes.rows[0].n);
  const eco = CO.find((c) => c.k === 'E');
  const banN = (await eco.db.query(`SELECT count(*)::int n FROM admin_notifications WHERE kind = 'KWANZA_BANNED' AND created_at > now() - interval '10 minutes'`)).rows[0].n;
  R.check('RE-25', 'empresa E notificada do banimento', banN >= 1, banN);
}
{
  const eco = CO.find((c) => c.k === 'E');
  const guest = await ok('GET', `${K}/market`);
  const assoc = await ok('GET', `${K}/market`, { token: A[0].token });
  R.check('RE-26', 'E banida: sai do marketplace (cliente e associado); B e C continuam', !guest.some((l) => l.companyCode === eco.code) && !assoc.some((l) => l.companyCode === eco.code) && assoc.some((l) => l.companyCode === CO[0].code) && assoc.some((l) => l.companyCode === CO[1].code));
  const pubE = await call('PATCH', `${AK}/products/${eco.prods[0].code}`, { token: eco.adm, body: { published: true, percent: 12, mode: 'OPEN', allowMarkup: false, maxMarkupPct: null, materials: [] } });
  const buyE = await call('POST', `${K}/checkout`, { body: { companyCode: eco.code, associateCode: A[0].code, lines: [{ productCode: eco.prods[0].code, quantity: 1 }], name: 'Cliente Banida', phone: `92${tag}99`.slice(0, 9), address: 'Rua 1', deliveryMethod: 'DELIVERY', paymentMethod: 'CASH', device: randomUUID(), ...geo } });
  const banks = await ok('GET', `${AK}/banks`, { token: eco.adm });
  R.check('RE-27', 'E banida não publica, não recebe compras novas e vê o banimento no painel', pubE.status === 400 && buyE.status >= 400 && !!banks.banned, `${pubE.status}/${buyE.status}`);
  const stats = await ok('GET', '/super-admin/kwanza/withdrawals?status=closed', { token: SA });
  const debt = r2(debtBefore + eW.reduce((s, w) => s + w.amount, 0));
  const b = stats.bans.find((x) => x.code === eco.code);
  R.check('RE-28', 'Super Admin: E na lista de banidas com a dívida exata dos reembolsos (acumulada)', b && near(b.debt, debt), `${b?.debt} vs ${debt}`);
  // B e C continuam a funcionar: nova compra e saque normais.
  const okBuy = await checkout({ companyCode: CO[1].code, associateCode: A[1].code, lines: [{ productCode: CO[1].prods[0].code, quantity: 1 }], name: 'Cliente Depois', phone: `92${tag}98`.slice(0, 9), address: 'Rua 3', deliveryMethod: 'DELIVERY', paymentMethod: 'CASH', device: randomUUID(), ...geo });
  if (okBuy.status < 300) { const k = (await pub.query('SELECT COALESCE(SUM(amount),0)::float s FROM nexus_public.kwanza_commissions WHERE "orderId" = $1', [okBuy.body.orderId])).rows[0].s; E(A[1], CO[1]).pending = r2(E(A[1], CO[1]).pending + k); }
  R.check('RE-29', 'as empresas que cumprem continuam a vender normalmente', okBuy.status === 201 || okBuy.status === 200, okBuy.status);
  // Readmissão (deixa o QA limpo para as outras suítes)
  const lift = await call('POST', `/super-admin/kwanza/bans/${b.companyId}/lift`, { token: SA });
  await ok('PATCH', `${AK}/products/${eco.prods[0].code}`, { token: eco.adm, body: { published: true, percent: 12, mode: 'OPEN', allowMarkup: false, maxMarkupPct: null, materials: [] } });
  const back = (await ok('GET', `${K}/market`, { token: A[0].token })).some((l) => l.companyCode === eco.code);
  R.check('RE-30', 'Super Admin readmite a empresa: volta ao marketplace e o histórico mantém-se', lift.status === 200 && back && (await ok('GET', `${K}/me/dashboard`, { token: first.a.token })).withdrawals.some((x) => x.id === first.id && x.status === 'REFUNDED'));
}
await panels('RE-31', 'no fim: todos os painéis continuam certos (nada se perdeu)');

await pub.query('DELETE FROM nexus_public.platform_users WHERE email = $1', [saEmail]);
for (const co of CO) await co.db.end();
await pub.end();
const sum = R.summary();
console.log(`\n${sum.passed}/${sum.total} verificações passaram`);
process.exit(sum.failed ? 1 : 0);
