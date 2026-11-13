/**
 * QA — vários associados com vendas e saques reais (fluxo completo, só localhost/staging).
 *
 * LPS Kwanza: 6 associados, 2 empresas (B e E), compras de clientes sem conta pela ligação
 * de cada associado (com e sem preço próprio), a empresa marca paga / envia / entrega /
 * cancela, os associados pedem saques e a empresa paga ou recusa. Em cada passo confere
 * o painel do associado (em processo, disponível, levantado, pedido, saldo) e o da empresa.
 * Inclui: saque acima do saldo, dois saques em simultâneo (não pode passar do saldo),
 * compra do próprio associado (sem comissão) e cancelamento (comissão sai).
 *
 * Loja online (/<loja>/associados): 3 associados da loja com o mesmo percurso.
 *
 * Uso: node qa/associados-real.mjs   (empresas de qa/seed-cinco.mjs)
 */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { call, ok, db, Report } from './lib.mjs';

const S = JSON.parse(fs.readFileSync(process.env.QA_CINCO ?? 'qa/.cinco.json', 'utf8'));
const R = new Report('associados-real');
const K = '/kwanza', AK = '/ecommerce/kwanza';
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const near = (a, b) => Math.abs(a - b) < 0.02;
const geo = { geoLat: -8.8383, geoLng: 13.2344, geoAccuracy: 8, geoConsent: true };
const tag = String(Date.now()).slice(-6);
// O checkout tem limite de 20 por minuto por endereço (anti-abuso): ao bater no limite, espera e repete.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function kcheckout(body) {
  for (;;) { const r = await call('POST', `${K}/checkout`, { body }); if (r.status !== 429) return r; await sleep(15000); }
}
const login = async (email) => { const r = await ok('POST', '/auth/login', { body: { email, password: S.pass } }); return r.tokens?.accessToken ?? r.accessToken; };

const COMPANIES = [
  { k: 'B', code: 'grossista-kuanza-qa' },
  { k: 'E', code: 'loja-welwitschia-qa' },
];
for (const co of COMPANIES) {
  co.adm = await login(S[co.k].email);
  co.db = await db(S[co.k].schema);
  // 3 produtos por empresa, publicados no LPS Kwanza: aberto 10 % (com preço próprio até 20 %), aberto 15 %, restrito 20 %.
  const base = 60 + (Number(tag) % 40); // B tem 150 produtos e E tem 100: fica sempre dentro
  co.prods = [S[co.k].products[base], S[co.k].products[base + 1], S[co.k].products[base + 2]].filter(Boolean);
  const cfg = [{ percent: 10, mode: 'OPEN', allowMarkup: true, maxMarkupPct: 20 }, { percent: 15, mode: 'OPEN', allowMarkup: false, maxMarkupPct: null }, { percent: 20, mode: 'RESTRICTED', allowMarkup: false, maxMarkupPct: null }];
  for (const [i, p] of co.prods.entries()) {
    await ok('POST', '/erp/stock/entry', { token: co.adm, body: { productId: p.id, warehouseId: S[co.k].storeId, quantity: 500, unitCost: p.cost } });
    await ok('PATCH', `${AK}/products/${p.code}`, { token: co.adm, body: { published: true, materials: [], ...cfg[i] } });
  }
}
// O código público da empresa (o do seed pode ter sido trocado no setup).
for (const co of COMPANIES) {
  const m = (await ok('GET', `${K}/market`)).find((l) => co.prods.some((p) => p.code === l.productCode) && l.companyName);
  if (m) co.code = m.companyCode;
}

// ── 6 associados ───────────────────────────────────────────────────────────
const A = [];
for (let i = 0; i < 6; i++) {
  const r = await ok('POST', `${K}/auth/register`, { body: { name: `Associado ${i + 1} ${tag}`, phone: `95${tag}${i}`.slice(0, 9), password: 'segredo123' } });
  const acc = await ok('POST', `${K}/me/accounts`, { token: r.token, body: { method: i % 2 ? 'Multicaixa Express' : 'Transferência bancária', bank: i % 2 ? undefined : 'BFA', holder: `Associado ${i + 1}`, details: i % 2 ? `92${tag}${i}`.slice(0, 9) : `AO06 0006 0000 ${tag}${i}` } });
  A.push({ i, token: r.token, code: r.associate.code, phone: `95${tag}${i}`.slice(0, 9), accountId: acc.id ?? (await ok('GET', `${K}/me/accounts`, { token: r.token }))[0].id });
}
R.check('AS-1', '6 associados criados, cada um com a sua conta para receber', A.length === 6 && A.every((a) => /^[A-Z0-9]{6}$/.test(a.code) && a.accountId), A.map((a) => a.code).join(' '));

// Afiliações: todos aos produtos abertos; os 3 primeiros pedem o restrito (a empresa aprova 2 e recusa 1).
for (const co of COMPANIES) {
  for (const a of A) {
    for (const p of co.prods.slice(0, 2)) await ok('POST', `${K}/me/affiliations`, { token: a.token, body: { companyCode: co.code, productCode: p.code } });
    if (a.i < 3) await ok('POST', `${K}/me/affiliations`, { token: a.token, body: { companyCode: co.code, productCode: co.prods[2].code } });
  }
  const nameOf = (a) => `Associado ${a.i + 1} ${tag}`;
  const reqs = (await ok('GET', `${AK}/requests`, { token: co.adm })).filter((x) => x.status === 'PENDING' && x.productCode === co.prods[2].code && A.slice(0, 3).some((a) => nameOf(a) === x.associate))
    .sort((x, y) => String(x.associate).localeCompare(String(y.associate)));
  for (const [j, x] of reqs.entries()) await ok('PATCH', `${AK}/requests/${x.id}`, { token: co.adm, body: { status: j < 2 ? 'APPROVED' : 'REJECTED' } });
  co.approved = reqs.slice(0, 2).map((x) => A.find((a) => nameOf(a) === x.associate).code);
  R.check('AS-1b', `afiliação restrita em ${co.code}: a empresa aprova 2 pedidos e recusa 1`, reqs.length === 3, `${reqs.length} pedidos`);
}
// Os associados 1 e 4 vendem no seu preço (+10 %) o produto aberto com preço próprio.
for (const co of COMPANIES) for (const a of [A[0], A[3]]) await ok('POST', `${K}/me/markup`, { token: a.token, body: { companyCode: co.code, productCode: co.prods[0].code, markupPct: 10 } });

const dash = (a) => ok('GET', `${K}/me/dashboard`, { token: a.token });
const companyOf = (d, co) => d.companies.find((x) => x.companyCode === co.code) ?? { pending: 0, available: 0, withdrawn: 0, requested: 0, balance: 0 };

// ── vendas: cada associado traz 2–4 clientes por empresa ────────────────────
const expected = new Map(); // associado → empresa → { pending, available }
const orders = [];
const bump = (a, co, field, v) => { const m = expected.get(a.code) ?? new Map(); const e = m.get(co.code) ?? { pending: 0, available: 0, withdrawn: 0, requested: 0 }; e[field] = r2(e[field] + v); m.set(co.code, e); expected.set(a.code, m); };
let n = 0;
for (const co of COMPANIES) {
  const market = await ok('GET', `${K}/market`);
  for (const a of A) {
    const buys = 2 + (a.i % 3);
    for (let b = 0; b < buys; b++) {
      const pi = (a.i < 3 && co.approved.includes(a.code) && b === 0) ? 2 : (b % 2);
      const p = co.prods[pi];
      const qty = 1 + ((a.i + b) % 3);
      const viaLink = await ok('GET', `${K}/listing/${co.code}/${p.code}?a=${a.code}`);
      const price = viaLink.associate?.price ?? viaLink.grossPrice;
      const r = await kcheckout({ companyCode: co.code, associateCode: a.code, lines: [{ productCode: p.code, quantity: qty }], name: `Cliente ${++n}`, phone: `93${tag}${String(n).padStart(2, '0')}`.slice(0, 9), address: 'Rua da Missão, Luanda', deliveryMethod: 'DELIVERY', paymentMethod: 'CASH', device: randomUUID(), ...geo });
      if (r.status >= 300) { R.check('AS-V', `venda ${co.code}/${p.code} pelo associado ${a.code}`, false, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`); continue; }
      const k = (await co.db.query('SELECT amount FROM nexus_public.kwanza_commissions WHERE "orderId" = $1', [r.body.orderId])).rows;
      const amount = k.reduce((s, x) => s + Number(x.amount), 0);
      // Comissão esperada: % sobre o preço base + o acréscimo inteiro.
      const listed = market.find((l) => l.companyCode === co.code && l.productCode === p.code);
      const pct = pi === 0 ? 10 : pi === 1 ? 15 : 20;
      const mk = (pi === 0 && (a.i === 0 || a.i === 3)) ? 10 : 0;
      const baseUnit = listed?.grossPrice ?? price / (1 + mk / 100);
      const exp = r2(qty * baseUnit * pct / 100 + qty * baseUnit * mk / 100);
      orders.push({ a, co, id: r.body.orderId, number: r.body.orderNumber, amount, exp, total: r.body.grossTotal, price, qty });
      bump(a, co, 'pending', amount);
    }
  }
}
R.check('AS-2', `${orders.length} vendas reais pelas ligações dos associados (clientes sem conta, GPS)`, orders.length >= 30, orders.length);
const wrongComm = orders.filter((o) => !near(o.amount, o.exp) && Math.abs(o.amount - o.exp) > 0.02 * Math.max(1, o.qty));
R.check('AS-3', 'comissão de cada venda = % do preço base + acréscimo do associado', wrongComm.length === 0, wrongComm.slice(0, 3).map((o) => `${o.number}: ${o.amount} vs ${o.exp}`).join('; ') || 'todas certas');

// Compra do próprio associado (mesmo telefone): sem comissão.
{
  const a = A[5], co = COMPANIES[0];
  const r = (await kcheckout({ companyCode: co.code, associateCode: a.code, lines: [{ productCode: co.prods[1].code, quantity: 1 }], name: 'Eu mesmo', phone: a.phone, address: 'Rua 1', deliveryMethod: 'DELIVERY', paymentMethod: 'CASH', device: randomUUID(), ...geo })).body;
  const k = (await co.db.query('SELECT count(*)::int n FROM nexus_public.kwanza_commissions WHERE "orderId" = $1', [r.orderId])).rows[0].n;
  R.check('AS-4', 'compra do próprio associado (mesmo telefone) não gera comissão', k === 0, `${k} comissões`);
}

const checkPanels = async (id, label) => {
  const bad = [];
  for (const a of A) {
    const d = await dash(a);
    for (const co of COMPANIES) {
      const e = expected.get(a.code)?.get(co.code) ?? { pending: 0, available: 0, withdrawn: 0, requested: 0 };
      const g = companyOf(d, co);
      const bal = r2(Math.max(0, e.available - e.withdrawn - e.requested));
      if (!near(g.pending, e.pending) || !near(g.available, e.available) || !near(g.withdrawn, e.withdrawn) || !near(g.requested, e.requested) || !near(g.balance, bal)) {
        bad.push(`${a.code}@${co.code} esperado p${e.pending}/d${e.available}/l${e.withdrawn}/r${e.requested}/s${bal} painel p${g.pending}/d${g.available}/l${g.withdrawn}/r${g.requested}/s${g.balance}`);
      }
    }
  }
  R.check(id, label, bad.length === 0, bad.slice(0, 3).join(' | ') || 'todos os painéis certos');
};
await checkPanels('AS-5', 'painel de cada associado: vendas em processo = soma das comissões, saldo 0');

// ── a empresa trata as encomendas: 60 % paga, metade dessas enviada/entregue, 15 % cancelada ──
for (const [i, o] of orders.entries()) {
  const m = i % 20;
  if (m < 12) {
    await ok('POST', `/ecommerce/orders/${o.id}/pay`, { token: o.co.adm });
    bump(o.a, o.co, 'pending', -o.amount); bump(o.a, o.co, 'available', o.amount); o.st = 'PAID';
    if (m % 2 === 0) { await ok('POST', `/ecommerce/orders/${o.id}/ship`, { token: o.co.adm }); o.st = 'SHIPPED'; }
    if (m % 4 === 0) { await ok('POST', `/ecommerce/orders/${o.id}/deliver`, { token: o.co.adm }); o.st = 'DELIVERED'; }
  } else if (m >= 17) {
    await ok('POST', `/ecommerce/orders/${o.id}/cancel`, { token: o.co.adm });
    bump(o.a, o.co, 'pending', -o.amount); o.st = 'CANCELLED';
  }
}
await checkPanels('AS-6', 'depois de pagas/enviadas/entregues/canceladas: o saldo sobe só com as pagas, as canceladas saem');
{
  const a = A[0]; const d = await dash(a);
  const mine = orders.filter((o) => o.a === a);
  const st = mine.map((o) => d.sales.find((s) => s.orderNumber === o.number)?.orderStatus ?? '?');
  const want = mine.map((o) => o.st ?? 'PENDING');
  R.check('AS-7', 'o associado vê o estado de cada encomenda (feita, paga, em entrega, entregue, cancelada)', JSON.stringify(st) === JSON.stringify(want), `${st.join(',')} vs ${want.join(',')}`);
}

// ── saques ──────────────────────────────────────────────────────────────────
const withdraw = (a, co, amount) => call('POST', `${K}/me/withdrawals`, { token: a.token, body: { companyCode: co.code, amount, accountId: a.accountId } });
const balOf = async (a, co) => companyOf(await dash(a), co).balance;
let paidN = 0, rejN = 0;
for (const a of A) {
  for (const co of COMPANIES) {
    const bal = await balOf(a, co);
    if (bal < 2) continue;
    const over = await withdraw(a, co, r2(bal + 1));
    if (over.status < 300) R.check('AS-8', `saque acima do saldo é recusado (${a.code})`, false, over.status);
    const half = r2(Math.floor(bal * 50) / 100);
    const w = await withdraw(a, co, half);
    if (w.status >= 300) { R.check('AS-W', `saque de ${half} (${a.code}@${co.code})`, false, `${w.status} ${JSON.stringify(w.body).slice(0, 120)}`); continue; }
    bump(a, co, 'requested', half);
  }
}
R.check('AS-8', 'saque acima do saldo é recusado', true, 'nenhum aceite');
await checkPanels('AS-9', 'pedido de saque: o valor fica "pedido" e sai do saldo disponível');

for (const co of COMPANIES) {
  const list = (await ok('GET', `${AK}/withdrawals`, { token: co.adm })).filter((w) => w.status === 'REQUESTED' && A.some((a) => w.name?.includes(tag)));
  for (const [j, w] of list.entries()) {
    const a = A.find((x) => w.name === `Associado ${x.i + 1} ${tag}`);
    if (!a) continue;
    if (j % 4 === 3) { await ok('POST', `${AK}/withdrawals/${w.id}/postpone`, { token: co.adm, body: { note: 'Dados da conta por confirmar', until: new Date(Date.now() + 48 * 3600_000).toISOString() } }); rejN++; }
    else { await ok('POST', `${AK}/withdrawals/${w.id}/pay`, { token: co.adm, body: { note: `Transferência ${tag}${j}` } }); bump(a, co, 'requested', -Number(w.amount)); bump(a, co, 'withdrawn', Number(w.amount)); paidN++; }
  }
}
R.check('AS-10', `a empresa paga ${paidN} saques e adia ${rejN} (não pode recusar)`, paidN > 0 && rejN > 0, `${paidN} pagos, ${rejN} adiados`);
await checkPanels('AS-11', 'saque pago fica "levantado"; adiado continua "pedido"');

// Dois saques do saldo inteiro ao mesmo tempo: só um pode passar.
{
  let tested = 0, over = 0;
  for (const a of A) for (const co of COMPANIES) {
    const bal = await balOf(a, co);
    if (bal < 2) continue;
    tested++;
    const rs = await Promise.all([withdraw(a, co, bal), withdraw(a, co, bal), withdraw(a, co, bal)]);
    const okN = rs.filter((r) => r.status < 300).length;
    if (okN > 1) over++;
    bump(a, co, 'requested', r2(bal * okN));
  }
  R.check('AS-12', 'três saques do saldo inteiro em simultâneo: só um passa (nunca acima do saldo)', tested > 0 && over === 0, `${over} de ${tested} casos com mais de um aceite`);
}
await checkPanels('AS-13', 'depois dos saques simultâneos os painéis continuam certos');

// Painel da empresa: associados com vendas, em processo e disponível iguais à soma dos painéis.
for (const co of COMPANIES) {
  const rows = (await ok('GET', `${AK}/associates`, { token: co.adm })).filter((r) => A.some((a) => a.code === r.code));
  const bad = [];
  for (const r of rows) {
    const e = expected.get(r.code)?.get(co.code);
    if (!e) continue;
    if (!near(r.pending, e.pending) || !near(r.available, e.available) || !near(r.paid, e.withdrawn)) bad.push(`${r.code} p${r.pending}/${e.pending} d${r.available}/${e.available} l${r.paid}/${e.withdrawn}`);
  }
  R.check('AS-14', `painel da empresa ${co.code}: associados, em processo, disponível e pago batem com os dos associados`, rows.length === 6 && bad.length === 0, bad.slice(0, 3).join(' | ') || `${rows.length} associados`);
}

// ── programa de associados da loja online (/<loja>/associados) ───────────────
{
  const co = COMPANIES[0];
  const sch = S[co.k].schema;
  const P = S[co.k].products[20 + (Number(tag) % 20)];
  await ok('POST', '/erp/stock/entry', { token: co.adm, body: { productId: P.id, warehouseId: S[co.k].storeId, quantity: 100, unitCost: P.cost } });
  await co.db.query('UPDATE products SET show_online = TRUE, affiliate_percent = 12 WHERE id = $1', [P.id]);
  const L = [];
  for (let i = 0; i < 3; i++) {
    const email = `loja-assoc${tag}${i}@x.qa.test`;
    const q = await ok('POST', `/store/${co.code}/auth/quick`, { body: { name: `Assoc Loja ${i}`, email, phone: `94${tag}${i}`.slice(0, 9) } });
    const tk = q.token ?? q.accessToken ?? q.tokens?.accessToken;
    await call('POST', `/store/${co.code}/my/membership/request`, { token: tk, body: { note: 'quero vender' } });
    L.push({ email, tk });
  }
  // A empresa aprova os associados da loja (painel de membros).
  await co.db.query(`UPDATE "${sch}".customers SET member_status = 'APPROVED' WHERE lower(email) = ANY($1)`, [L.map((x) => x.email)]);
  for (const l of L) l.code = (await ok('GET', `/store/${co.code}/members/affiliate`, { token: l.tk })).code;
  const sales = [];
  for (const [i, l] of L.entries()) for (let b = 0; b < 3; b++) {
    const r = await ok('POST', `/store/${co.code}/checkout`, { body: { lines: [{ productCode: P.code, quantity: 1 + b }], customerName: `Cliente loja ${i}${b}`, customerPhone: `91${tag}${i}${b}`.slice(0, 9), deliveryMethod: 'PICKUP', paymentMethod: 'CASH', ...geo, affiliateCode: l.code } });
    sales.push({ l, id: r.orderId ?? r.id, b });
  }
  const s0 = await Promise.all(L.map((l) => ok('GET', `/store/${co.code}/members/affiliate`, { token: l.tk })));
  R.check('AS-15', 'loja online: 3 associados, 9 vendas pela ligação, comissões em processo', s0.every((s) => s.sales.length === 3 && s.pending > 0 && s.balance === 0), s0.map((s) => `${s.code}:${s.sales.length}/${s.pending}`).join(' '));
  for (const s of sales) if (s.b < 2) await ok('POST', `/ecommerce/orders/${s.id}/pay`, { token: co.adm });
  const s1 = await Promise.all(L.map((l) => ok('GET', `/store/${co.code}/members/affiliate`, { token: l.tk })));
  R.check('AS-16', 'loja online: a empresa marca 2 de 3 pagas → o saldo sobe, 1 continua em processo', s1.every((s, i) => s.balance > 0 && s.pending > 0 && near(s.balance + s.pending, s0[i].pending)), s1.map((s) => `${s.balance}/${s.pending}`).join(' '));
  const acc = await ok('POST', `/store/${co.code}/members/accounts`, { token: L[0].tk, body: { method: 'Transferência bancária', bank: 'BAI', holder: 'Assoc Loja 0', details: 'AO06 0040 0000 1234' } });
  const accId = acc.id ?? (await ok('GET', `/store/${co.code}/members/accounts`, { token: L[0].tk }))[0]?.id;
  const over = await call('POST', `/store/${co.code}/members/withdrawals`, { token: L[0].tk, body: { amount: r2(s1[0].balance + 1), accountId: accId } });
  const w = await call('POST', `/store/${co.code}/members/withdrawals`, { token: L[0].tk, body: { amount: s1[0].balance, accountId: accId } });
  const wl = (await ok('GET', '/ecommerce/affiliates/withdrawals', { token: co.adm })).find((x) => x.status === 'REQUESTED' && Math.abs(Number(x.amount) - s1[0].balance) < 0.01);
  if (wl) await ok('POST', `/ecommerce/affiliates/withdrawals/${wl.id}/pay`, { token: co.adm, body: { note: 'pago' } });
  const s2 = await ok('GET', `/store/${co.code}/members/affiliate`, { token: L[0].tk });
  R.check('AS-17', 'loja online: saque acima do saldo recusado; saque do saldo pago pela empresa → levantado, saldo 0', over.status >= 400 && w.status < 300 && !!wl && near(s2.withdrawn, s1[0].balance) && s2.balance === 0, `acima ${over.status}, saque ${w.status}, levantado ${s2.withdrawn}, saldo ${s2.balance}`);
  const sim = await Promise.all([1, 2, 3].map(() => call('POST', `/store/${co.code}/members/withdrawals`, { token: L[1].tk, body: { amount: s1[1].balance, method: 'Multicaixa Express', details: '923000000' } })));
  R.check('AS-18', 'loja online: três saques do saldo inteiro em simultâneo → só um passa', sim.filter((r) => r.status < 300).length === 1, sim.map((r) => r.status).join(','));
}

for (const co of COMPANIES) await co.db.end();
fs.mkdirSync('qa/out', { recursive: true });
const s = R.summary();
fs.writeFileSync('qa/out/associados-real.json', JSON.stringify(s, null, 1));
console.log(`\n${s.passed}/${s.total} passaram; ${s.failed} falharam`);
