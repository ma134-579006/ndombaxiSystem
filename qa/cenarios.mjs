/**
 * QA — cenários de negócio e invariantes (API local + Postgres de teste).
 *
 * Cada verificação compara o que a API devolve com o que ficou NA BASE:
 * numeração fiscal sem saltos, cadeia de hash, totais das faturas, stock
 * reconciliado com os movimentos, fecho de caixa reconciliado com o dinheiro
 * que o simulador entregou, idempotência, concorrência e permissões.
 *
 * Uso: node qa/cenarios.mjs   (depois de qa/seed-empresa.mjs)
 * Saída: qa/out/cenarios.json
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { call, ok, db, uuid, Report, round2, jwtPayload } from './lib.mjs';

const S = JSON.parse(fs.readFileSync(process.env.QA_STATE ?? 'qa/.state.json', 'utf8'));
const R = new Report('cenarios');
let A = S.A.token;

async function login(nick) {
  const email = `${nick}@grupo-kwanza.qa.test`;
  const r = await ok('POST', '/auth/login', { body: { email, password: S.pass } });
  const token = r.tokens?.accessToken ?? r.accessToken;
  return { token, user: S.users[email], jwt: jwtPayload(token) };
}

async function stockOf(c, productId, storeId) {
  const r = await c.query('SELECT quantity FROM stock_items WHERE product_id=$1 AND warehouse_id=$2', [productId, storeId]);
  return Number(r.rows[0]?.quantity ?? 0);
}

async function main() {
  // O token guardado expira (15 min): entra de novo como administrador.
  const al = await ok('POST', '/auth/login', { body: { email: 'admin@grupo-kwanza.qa.test', password: S.pass } });
  A = al.tokens?.accessToken ?? al.accessToken; S.A.token = A;
  const bl = await ok('POST', '/auth/login', { body: { email: 'admin@kwanza-servicos.qa.test', password: S.pass } });
  S.B.token = bl.tokens?.accessToken ?? bl.accessToken;
  const c = await db(S.A.schema);
  const P = S.products;
  const cx = await login('caixa1');       // SUP1
  const cx2 = await login('caixa7');      // SUP1 (pick cycles a cada 6)
  const sup = await login('supervisor-sup1');
  const ger = await login('gerente-sup1');
  const att = await login('limitado');
  const sup1 = S.stores.SUP1;
  R.check('ENV-1', 'caixas da mesma loja (SUP1)', cx.jwt.storeId === sup1 && cx2.jwt.storeId === sup1, `${cx.jwt.storeId} ${cx2.jwt.storeId}`);

  // ── Turnos ────────────────────────────────────────────────
  for (const u of [cx, cx2]) {
    await call('POST', '/cashbox/session/close', { token: u.token, body: { countedCash: 0 } }); // limpa turno antigo de outra execução
    await ok('POST', '/cashbox/session/open', { token: u.token, body: { openingFloat: 10000 } });
  }
  const dupOpen = await Promise.all([1, 2, 3].map(() => call('POST', '/cashbox/session/open', { token: cx.token, body: { openingFloat: 5 } })));
  R.check('CX-1', 'abrir turno com turno já aberto é recusado (3 cliques)', dupOpen.every((r) => r.status === 400), dupOpen.map((r) => r.status).join(','));

  // Ledger do simulador: o dinheiro que deve estar na gaveta do caixa1.
  let drawer = 10000;
  const prod = (i) => P[i];

  // ── Vendas ────────────────────────────────────────────────
  // V1 numerário com troco
  const st0 = await stockOf(c, prod(0).id, sup1);
  const v1 = await call('POST', '/pos/invoices', { token: cx.token, body: { lines: [{ productCode: prod(0).code, quantity: 2 }], paymentType: 'CASH', tendered: 1e6, clientOpId: uuid() } });
  R.check('V-1', 'venda a numerário emitida', v1.status < 300, v1.status + ' ' + (v1.body?.number ?? JSON.stringify(v1.body).slice(0, 200)));
  if (v1.status < 300) drawer += Number(v1.body.grossTotal);
  const st1 = await stockOf(c, prod(0).id, sup1);
  R.check('V-2', 'stock da loja baixa a quantidade vendida', st0 - st1 === 2, `${st0} → ${st1}`);

  // V3 total coerente com preço × IVA
  if (v1.status < 300) {
    const items = (await c.query('SELECT * FROM invoice_items WHERE invoice_id=$1', [v1.body.id])).rows;
    const inv = (await c.query('SELECT * FROM invoices WHERE id=$1', [v1.body.id])).rows[0];
    const rate = Number(items[0].iva_rate);
    const expNet = round2(prod(0).price * 2);
    R.check('V-3', 'total = preço × qtd + IVA', Math.abs(Number(inv.net_total) - expNet) <= 0.01 && Math.abs(Number(inv.gross_total) - round2(expNet * (1 + rate / 100))) <= 0.02, `net ${inv.net_total} esperado ${expNet}, gross ${inv.gross_total}, iva ${rate}%`);
  }

  // V4 valor entregue insuficiente
  const v4 = await call('POST', '/pos/invoices', { token: cx.token, body: { lines: [{ productCode: prod(1).code, quantity: 1 }], paymentType: 'CASH', tendered: 1 } });
  R.check('V-4', 'valor entregue inferior ao total é recusado', v4.status === 400, v4.status);

  // V5 crédito sem cliente
  const v5 = await call('POST', '/pos/invoices', { token: cx.token, body: { lines: [{ productCode: prod(1).code, quantity: 1 }], paymentType: 'CREDIT' } });
  R.check('V-5', 'venda a crédito sem cliente é recusada', v5.status === 400, v5.status);

  // V6 crédito com cliente → conta a receber
  const cust = S.customers[0];
  const v6 = await call('POST', '/pos/invoices', { token: cx.token, body: { lines: [{ productCode: prod(2).code, quantity: 3 }], paymentType: 'CREDIT', customerId: cust } });
  R.check('V-6', 'venda a crédito com cliente emitida', v6.status < 300, v6.status + ' ' + JSON.stringify(v6.body).slice(0, 150));
  if (v6.status < 300) {
    const rec = (await c.query('SELECT * FROM receivables WHERE invoice_id=$1', [v6.body.id])).rows[0];
    R.check('V-7', 'crédito gera conta a receber com o valor da fatura', rec && Math.abs(Number(rec.original_amount) - Number(v6.body.grossTotal)) <= 0.01, rec ? `${rec.original_amount} vs ${v6.body.grossTotal}` : 'sem conta a receber');
    // Pagamento parcial
    if (rec) {
      const half = round2(Number(rec.original_amount) / 2);
      const pp = await call('POST', `/receivables/${rec.id}/payment`, { token: ger.token, body: { amount: half, method: 'CASH' } });
      const after = (await c.query('SELECT * FROM receivables WHERE id=$1', [rec.id])).rows[0];
      R.check('V-8', 'pagamento parcial não dá a dívida por paga', pp.status < 300 && Number(after.paid_amount) === half && after.status !== 'PAID', `${pp.status} paid=${after.paid_amount} status=${after.status}`);
      const over = await call('POST', `/receivables/${rec.id}/payment`, { token: ger.token, body: { amount: Number(rec.original_amount) * 5, method: 'CASH' } });
      const after2 = (await c.query('SELECT * FROM receivables WHERE id=$1', [rec.id])).rows[0];
      R.check('V-9', 'pagamento acima da dívida é recusado (ou limitado ao em falta)', over.status >= 400 || Number(after2.paid_amount) <= Number(after2.original_amount) + 0.01, `${over.status} paid=${after2.paid_amount}/${after2.original_amount}`);
    }
  }

  // V10 pagamento misto (numerário + TPA)
  const mixLines = [{ productCode: prod(3).code, quantity: 1 }, { productCode: prod(4).code, quantity: 2 }];
  const quote = mixLines.reduce((s, l) => s, 0);
  const vMixProbe = await call('POST', '/pos/invoices', { token: cx.token, body: { lines: mixLines, paymentType: 'CARD' } });
  R.check('V-10', 'venda a cartão emitida', vMixProbe.status < 300, vMixProbe.status);
  if (vMixProbe.status < 300) {
    const g = Number(vMixProbe.body.grossTotal);
    const cash = round2(g / 3);
    const vMix = await call('POST', '/pos/invoices', { token: cx.token, body: { lines: mixLines, paymentType: 'CASH', payments: [{ type: 'CASH', amount: cash }, { type: 'CARD', amount: round2(g - cash) }], tendered: cash } });
    R.check('V-11', 'pagamento misto numerário+TPA emitido', vMix.status < 300, vMix.status + ' ' + JSON.stringify(vMix.body).slice(0, 200));
    if (vMix.status < 300) drawer += cash;
    const vBad = await call('POST', '/pos/invoices', { token: cx.token, body: { lines: mixLines, payments: [{ type: 'CASH', amount: 1 }, { type: 'CARD', amount: 1 }] } });
    R.check('V-12', 'pagamento misto que não soma o total é recusado', vBad.status === 400, vBad.status);
    void quote;
  }

  // V13 desconto manual sem aprovação (caixa) / com PIN de supervisor
  const d1 = await call('POST', '/pos/invoices', { token: cx.token, body: { lines: [{ productCode: prod(5).code, quantity: 1, discountRate: 0.5 }], paymentType: 'CARD' } });
  R.check('V-13', 'desconto manual de 50% pelo caixa sem PIN é recusado', d1.status === 403, d1.status);
  const supPin = sup.user?.pin;
  const d2 = await call('POST', '/pos/invoices', { token: cx.token, body: { lines: [{ productCode: prod(5).code, quantity: 1, discountRate: 0.1 }], paymentType: 'CARD', approvalPin: supPin } });
  R.check('V-14', 'desconto com PIN do supervisor é aceite e auditado', d2.status < 300, `${d2.status} pin=${supPin ? 'sim' : 'não'} ${JSON.stringify(d2.body).slice(0, 120)}`);
  const d3 = await call('POST', '/pos/invoices', { token: cx.token, body: { lines: [{ productCode: prod(5).code, quantity: 1, discountRate: 0.1 }], paymentType: 'CARD', approvalPin: '000000' } });
  R.check('V-15', 'desconto com PIN errado é recusado', d3.status === 403, d3.status);
  const d4 = await call('POST', '/pos/invoices', { token: cx.token, body: { lines: [{ productCode: prod(5).code, quantity: 1, discountRate: 1 }], paymentType: 'CARD', approvalPin: supPin } });
  R.check('V-16', 'desconto de 100% é recusado pela validação', d4.status === 400, d4.status);

  // V17 quantidade negativa / zero, produto inexistente, preço imposto
  const neg = await call('POST', '/pos/invoices', { token: cx.token, body: { lines: [{ productCode: prod(6).code, quantity: -3 }] } });
  R.check('V-17', 'quantidade negativa recusada', neg.status === 400, neg.status);
  const ghost = await call('POST', '/pos/invoices', { token: cx.token, body: { lines: [{ productCode: 'NAO-EXISTE', quantity: 1 }] } });
  R.check('V-18', 'produto inexistente recusado', ghost.status === 400, ghost.status);
  const forced = await call('POST', '/pos/invoices', { token: cx.token, body: { lines: [{ productCode: prod(6).code, quantity: 1, unitPrice: 1 }], paymentType: 'CARD' } });
  R.check('V-19', 'preço imposto pelo cliente é recusado (whitelist)', forced.status === 400 || (forced.status < 300 && Number(forced.body.grossTotal) > 1), `${forced.status} ${forced.body?.grossTotal}`);
  const nc = await call('POST', '/pos/invoices', { token: cx.token, body: { docType: 'NC', lines: [{ productCode: prod(6).code, quantity: 1 }], paymentType: 'CARD' } });
  R.check('V-20', 'NC pedida pelo caixa sai como FT (não repõe stock nem estorna)', nc.status >= 400 || String(nc.body.number ?? '').startsWith('FT'), `${nc.status} ${nc.body?.number}`);

  // V21 idempotência: o mesmo clientOpId 6× em simultâneo
  const op = uuid();
  const before = Number((await c.query('SELECT count(*) n FROM invoices')).rows[0].n);
  const dup = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/pos/invoices', { token: cx.token, body: { lines: [{ productCode: prod(7).code, quantity: 1 }], paymentType: 'CASH', tendered: 1e6, clientOpId: op } })));
  const afterN = Number((await c.query('SELECT count(*) n FROM invoices')).rows[0].n);
  const nums = new Set(dup.filter((r) => r.status < 300).map((r) => r.body.number));
  R.check('V-21', 'duplo clique / reenvio (6× o mesmo clientOpId) cria UMA fatura', afterN - before === 1 && nums.size === 1, `+${afterN - before} faturas, números ${[...nums].join(',')}, estados ${dup.map((r) => r.status).join(',')}`);
  if (afterN - before >= 1) drawer += Number(dup.find((r) => r.status < 300)?.body.grossTotal ?? 0);

  // V22 duas caixas vendem a ÚLTIMA unidade ao mesmo tempo
  const last = P[1400];
  await ok('POST', '/erp/stock/entry', { token: A, body: { productId: last.id, warehouseId: sup1, quantity: 1, unitCost: last.cost } });
  const s0 = await stockOf(c, last.id, sup1);
  const race = await Promise.all([cx, cx2].map((u) => call('POST', '/pos/invoices', { token: u.token, body: { lines: [{ productCode: last.code, quantity: s0 }], paymentType: 'CARD' } })));
  const won = race.filter((r) => r.status < 300).length;
  const sEnd = await stockOf(c, last.id, sup1);
  R.check('V-22', 'duas caixas, última unidade: só UMA venda passa e o stock não fica negativo', won === 1 && sEnd === 0, `stock ${s0}→${sEnd}, vendas ok=${won}, estados ${race.map((r) => r.status).join(',')}`);

  // V23 sem stock (online) é recusado; offline é registado
  const noStock = await call('POST', '/pos/invoices', { token: cx.token, body: { lines: [{ productCode: last.code, quantity: 1 }], paymentType: 'CARD' } });
  R.check('V-23', 'venda sem stock (online) é recusada', noStock.status === 400, noStock.status);

  // ── Anulação e devolução ─────────────────────────────────
  if (v1.status < 300) {
    const byCx = await call('POST', `/pos/invoices/${v1.body.id}/cancel`, { token: cx.token, body: { reason: 'teste' } });
    R.check('A-1', 'caixa não pode anular venda', byCx.status === 403, byCx.status);
    const stB = await stockOf(c, prod(0).id, sup1);
    const canc = await call('POST', `/pos/invoices/${v1.body.id}/cancel`, { token: ger.token, body: { reason: 'Erro de registo (QA)' } });
    const stA = await stockOf(c, prod(0).id, sup1);
    R.check('A-2', 'gerente anula: emite NC e repõe o stock', canc.status < 300 && stA - stB === 2, `${canc.status} stock ${stB}→${stA} ${JSON.stringify(canc.body).slice(0, 120)}`);
    const again = await call('POST', `/pos/invoices/${v1.body.id}/cancel`, { token: ger.token, body: { reason: 'de novo' } });
    R.check('A-3', 'anular duas vezes é recusado', again.status === 400, again.status);
    const ret = await call('POST', `/pos/invoices/${v1.body.id}/return`, { token: sup.token, body: { items: [{ productCode: prod(0).code, quantity: 1 }], reason: 'x' } });
    R.check('A-4', 'devolução de fatura já anulada é recusada', ret.status === 400, ret.status);
    // O dinheiro da anulação sai da gaveta do gerente (quem anula) ou do caixa? Regista o que aconteceu.
    const refund = (await c.query("SELECT cs.opened_by, cm.amount, cm.payment_type FROM cash_movements cm JOIN cash_sessions cs ON cs.id=cm.session_id WHERE cm.type='REFUND' AND cm.reference_id=$1", [v1.body.id])).rows;
    R.check('A-5', 'estorno em numerário da anulação sai do turno da venda original', refund.length === 1 && refund[0].opened_by === cx.jwt.sub && Math.abs(Number(refund[0].amount) - Number(v1.body.grossTotal)) < 0.01, JSON.stringify(refund));
    if (refund.length === 1 && refund[0].opened_by === cx.jwt.sub && refund[0].payment_type === 'CASH') drawer -= Number(refund[0].amount);
  }
  if (v6.status < 300) {
    const stB = await stockOf(c, prod(2).id, sup1);
    const r1 = await call('POST', `/pos/invoices/${v6.body.id}/return`, { token: sup.token, body: { items: [{ productCode: prod(2).code, quantity: 1 }], reason: 'avariado (QA)', clientOpId: uuid() } });
    const stA = await stockOf(c, prod(2).id, sup1);
    R.check('D-1', 'devolução parcial repõe só o devolvido', r1.status < 300 && stA - stB === 1, `${r1.status} ${stB}→${stA} ${JSON.stringify(r1.body).slice(0, 150)}`);
    const r2 = await call('POST', `/pos/invoices/${v6.body.id}/return`, { token: sup.token, body: { items: [{ productCode: prod(2).code, quantity: 5 }], reason: 'demais' } });
    R.check('D-2', 'devolver mais do que o vendido é recusado', r2.status === 400, r2.status);
    const opR = uuid();
    const rr = await Promise.all([1, 2, 3].map(() => call('POST', `/pos/invoices/${v6.body.id}/return`, { token: sup.token, body: { items: [{ productCode: prod(2).code, quantity: 1 }], reason: 'repetida', clientOpId: opR } })));
    const stR = await stockOf(c, prod(2).id, sup1);
    R.check('D-3', 'devolução repetida (mesmo clientOpId) só repõe uma vez', stR - stA === 1, `${stA}→${stR} ${rr.map((r) => r.status).join(',')}`);
    const rec = (await c.query('SELECT * FROM receivables WHERE invoice_id=$1', [v6.body.id])).rows[0];
    R.check('D-4', 'devolução de venda a crédito reduz a dívida', rec && Number(rec.original_amount) < Number(v6.body.grossTotal), rec ? `dívida ${rec.original_amount} pago ${rec.paid_amount} fatura ${v6.body.grossTotal}` : 'sem conta');
    // 3 unidades a crédito, metade paga, 2 devolvidas → o cliente pagou mais do que
    // os artigos que ficou: o excedente tem de lhe ser devolvido (numerário).
    const ncs = (await c.query("SELECT COALESCE(sum(gross_total),0) s FROM invoices WHERE doc_type='NC' AND source_invoice_id=$1", [v6.body.id])).rows[0];
    const cashBack = (await c.query("SELECT COALESCE(sum(amount),0) s FROM cash_movements WHERE type='REFUND' AND payment_type='CASH' AND reference_id=$1", [v6.body.id])).rows[0];
    const kept = round2(Number(v6.body.grossTotal) - Number(ncs.s));
    const expectBack = round2(Math.max(0, Number(rec?.paid_amount ?? 0) - kept));
    R.check('D-5', 'crédito pago a mais é devolvido ao cliente (dívida + estorno = NC)', Math.abs(Number(cashBack.s) - expectBack) < 0.01 && Math.abs(Number(rec.original_amount) - Math.max(kept, Number(rec.paid_amount))) < 0.01, `NC ${ncs.s}, artigos ficados ${kept}, pago ${rec?.paid_amount}, estorno numerário ${cashBack.s} (esperado ${expectBack}), dívida ${rec?.original_amount}`);
    drawer -= Number(cashBack.s);
  }

  // ── Reforço / sangria / fecho ────────────────────────────
  await ok('POST', '/cashbox/session/movement', { token: cx.token, body: { type: 'CASH_IN', amount: 5000, reference: 'reforço QA' } });
  await ok('POST', '/cashbox/session/movement', { token: cx.token, body: { type: 'CASH_OUT', amount: 3000, reference: 'sangria QA' } });
  drawer += 2000;
  const x = await ok('GET', '/cashbox/report/x', { token: cx.token });
  const close = await ok('POST', '/cashbox/session/close', { token: cx.token, body: { countedCash: round2(drawer) } });
  R.check('C-1', 'fecho: esperado do servidor = dinheiro que o simulador meteu na gaveta', Math.abs(Number(close.expected) - drawer) <= 0.01, `esperado ${close.expected}, simulador ${round2(drawer)}, diferença ${close.difference}, X ${x.expectedCash}`);
  const sess = (await c.query("SELECT * FROM cash_sessions WHERE opened_by=$1 ORDER BY opened_at DESC LIMIT 1", [cx.jwt.sub])).rows[0];
  const mv = (await c.query("SELECT type, payment_type, sum(amount) s FROM cash_movements WHERE session_id=$1 GROUP BY 1,2", [sess.id])).rows;
  const sum = (t, p) => mv.filter((m) => m.type === t && (!p || (m.payment_type ?? 'CASH') === p)).reduce((s, m) => s + Number(m.s), 0);
  const recon = round2(Number(sess.opening_float) + sum('SALE', 'CASH') + sum('CASH_IN') - sum('CASH_OUT') - sum('REFUND', 'CASH'));
  R.check('C-2', 'fecho gravado reconcilia com os movimentos do turno', Math.abs(recon - Number(sess.expected_cash)) <= 0.01, `recalc ${recon} gravado ${sess.expected_cash} ${JSON.stringify(mv)}`);
  await call('POST', '/cashbox/session/close', { token: cx2.token, body: { countedCash: 0 } });

  // ── Invariantes globais na base ──────────────────────────
  const gaps = (await c.query(`SELECT doc_type, series, year, count(*) n, max(sequence) mx, count(DISTINCT sequence) d, count(DISTINCT number) dn
                                 FROM invoices GROUP BY 1,2,3`)).rows;
  R.check('F-1', 'numeração por série sem saltos nem repetidos', gaps.every((g) => Number(g.n) === Number(g.mx) && Number(g.d) === Number(g.n) && Number(g.dn) === Number(g.n)), JSON.stringify(gaps));
  const fs1 = (await c.query('SELECT doc_type, series, year, last_sequence FROM fiscal_series')).rows;
  R.check('F-2', 'fiscal_series.last_sequence = última fatura emitida', fs1.every((f) => { const g = gaps.find((x) => x.doc_type === f.doc_type && x.series === f.series && x.year === f.year); return !g || Number(g.mx) === Number(f.last_sequence); }), JSON.stringify(fs1));
  // Cadeia: cada documento encadeia com o anterior da mesma série.
  const chain = (await c.query('SELECT doc_type, series, year, sequence, number, invoice_date, system_entry_date, gross_total, previous_hash, hash, signable_string, signature FROM invoices ORDER BY doc_type, series, year, sequence')).rows;
  let brokenLink = 0, badHash = 0, unsigned = 0;
  for (let i = 0; i < chain.length; i++) {
    const d = chain[i];
    const prev = i > 0 && chain[i - 1].doc_type === d.doc_type && chain[i - 1].series === d.series && chain[i - 1].year === d.year ? chain[i - 1] : null;
    if (prev && d.previous_hash !== prev.hash && d.previous_hash !== '') brokenLink++;
    if (!d.signature) unsigned++;
    // Modo legado (sem chave da plataforma): hash = SHA-256 da signable string.
    if (!d.signature && d.signable_string && createHash('sha256').update(d.signable_string, 'utf8').digest('hex') !== d.hash) badHash++;
    if (d.signable_string && !d.signable_string.includes(`;${d.number};`)) badHash++;
  }
  R.check('F-3', 'cadeia de hash íntegra (cada documento aponta ao anterior da série)', brokenLink === 0 && badHash === 0, `${chain.length} docs, elos partidos ${brokenLink}, hashes errados ${badHash}`);
  R.check('F-4', 'documentos emitidos COM assinatura AGT (RSA)', unsigned === 0, `${unsigned}/${chain.length} sem assinatura — chave da plataforma não configurada neste ambiente`);
  const tot = (await c.query(`SELECT i.number, i.net_total, i.iva_total, i.gross_total, sum(ii.net_amount) sn, sum(ii.iva_amount) si, sum(ii.gross_amount) sg
                                FROM invoices i JOIN invoice_items ii ON ii.invoice_id=i.id GROUP BY i.id`)).rows;
  const badTot = tot.filter((t) => Math.abs(Number(t.net_total) + Number(t.iva_total) - Number(t.gross_total)) > 0.011 || Math.abs(Number(t.sg) - Number(t.gross_total)) > 0.05 || Math.abs(Number(t.sn) - Number(t.net_total)) > 0.05);
  R.check('F-5', 'totais das faturas = soma das linhas (líquido + IVA = bruto)', badTot.length === 0, `${tot.length} docs, divergentes ${badTot.length} ${JSON.stringify(badTot.slice(0, 3))}`);
  // Stock: saldo = último balance_after dos movimentos; produto = soma das lojas.
  // Stock: saldo de cada loja = soma de TODOS os movimentos (entradas +, saídas −).
  const badStk = (await c.query(`SELECT si.product_id, si.warehouse_id, si.quantity, COALESCE(sum(m.quantity),0) s
                                   FROM stock_items si LEFT JOIN stock_movements m ON m.product_id=si.product_id AND m.warehouse_id=si.warehouse_id
                                  GROUP BY si.id HAVING abs(si.quantity - COALESCE(sum(m.quantity),0)) > 0.0001`)).rows;
  const nStk = Number((await c.query('SELECT count(*) n FROM stock_items')).rows[0].n);
  R.check('S-1', 'saldo de stock por loja = soma dos movimentos (inicial + entradas − saídas + ajustes)', badStk.length === 0, `${nStk} saldos, divergentes ${badStk.length} ${JSON.stringify(badStk.slice(0, 3))}`);
  const mvTypes = (await c.query('SELECT type, sign(quantity) sg, count(*) n FROM stock_movements GROUP BY 1,2 ORDER BY 1')).rows;
  const agg = (await c.query(`SELECT p.code, p.stock_qty, COALESCE(sum(si.quantity),0) s FROM products p LEFT JOIN stock_items si ON si.product_id=p.id GROUP BY p.id HAVING abs(p.stock_qty - COALESCE(sum(si.quantity),0)) > 0.0001`)).rows;
  R.check('S-2', 'stock do produto = soma do stock das lojas', agg.length === 0, `${agg.length} produtos divergentes ${JSON.stringify(agg.slice(0, 3))} tipos ${JSON.stringify(mvTypes)}`);
  const negs = (await c.query('SELECT count(*) n FROM stock_items WHERE quantity < 0')).rows[0].n;
  R.check('S-3', 'sem stock negativo após vendas online', Number(negs) === 0, `${negs} saldos negativos`);

  // ── Isolamento entre empresas ────────────────────────────
  if (v6.status < 300) {
    const cross = await call('GET', `/pos/invoices/${v6.body.id}`, { token: S.B.token });
    R.check('T-1', 'empresa B não vê a fatura da empresa A pelo id', cross.status === 404 || cross.status === 400 || (cross.status === 200 && !cross.body?.number), `${cross.status} ${JSON.stringify(cross.body).slice(0, 120)}`);
  }
  const [h, p, sig] = A.split('.');
  const forged = Buffer.from(JSON.stringify({ ...jwtPayload(A), tenantSchema: S.B.schema, tenantId: jwtPayload(S.B.token).tenantId })).toString('base64url');
  const fx = await call('GET', '/pos/invoices', { token: `${h}.${forged}.${sig}` });
  R.check('T-2', 'JWT adulterado (troca de empresa) é recusado', fx.status === 401, fx.status);
  const none = await call('GET', '/pos/invoices', { token: `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${p}.` });
  R.check('T-3', 'JWT com alg=none é recusado', none.status === 401, none.status);

  // ── Permissões do utilizador limitado (ATTENDANT) ────────
  const attempts = [
    ['POST', '/pos/invoices', { lines: [{ productCode: prod(9).code, quantity: 1 }] }],
    ['POST', '/pos/products', { name: 'x', ivaCode: 'NOR' }],
    ['PATCH', `/pos/products/${prod(9).id}`, { unitPrice: 1 }],
    ['POST', '/erp/stock/adjust', { productId: prod(9).id, warehouseId: sup1, quantity: 9999, reason: 'x' }],
    ['POST', '/staff/users', { name: 'x', email: 'x@x.qa.test', role: 'COMPANY_ADMIN' }],
    ['POST', '/cashbox/session/open', { openingFloat: 1 }],
    ['POST', `/pos/invoices/${v6.body?.id ?? uuid()}/cancel`, { reason: 'x' }],
    ['POST', '/receivables', { customerName: 'x', amount: 1 }],
    ['GET', '/pos/saft?year=2026&month=11', undefined],
    ['POST', '/pos/fiscal/signing-key', {}],
  ];
  for (const [m, u, b] of attempts) {
    const r = await call(m, u, { token: att.token, body: b });
    R.check(`P-${m}-${u.split('?')[0].replace(/[0-9a-f-]{36}/, ':id')}`, `ATTENDANT: ${m} ${u.split('?')[0]} recusado`, r.status === 403, r.status);
  }
  // Caixa não pode subir de papel nem mexer em preços.
  for (const [m, u, b] of [
    ['PATCH', `/pos/products/${prod(9).id}`, { unitPrice: 1 }],
    ['POST', '/staff/users', { name: 'x', email: 'y@x.qa.test', role: 'COMPANY_ADMIN', password: 'Abcdefgh1!' }],
    ['POST', '/erp/stock/adjust', { productId: prod(9).id, warehouseId: sup1, quantity: 9999, reason: 'x' }],
  ]) {
    const r = await call(m, u, { token: cx.token, body: b });
    R.check(`P-CX-${m}-${u.replace(/[0-9a-f-]{36}/, ':id')}`, `CASHIER: ${m} ${u.replace(/[0-9a-f-]{36}/, ':id')} recusado`, r.status === 403, r.status);
  }
  // Gerente não cria administrador.
  const esc = await call('POST', '/staff/users', { token: ger.token, body: { name: 'x', email: 'z@x.qa.test', role: 'COMPANY_ADMIN', password: 'Abcdefgh1!' } });
  R.check('P-ESC', 'STORE_MANAGER não cria COMPANY_ADMIN (escalada)', esc.status === 403, esc.status);

  // ── Injeção ──────────────────────────────────────────────
  for (const q of ["' OR 1=1--", "'; DROP TABLE products;--", '%\' UNION SELECT password_hash FROM users--', '<script>alert(1)</script>']) {
    const r = await call('GET', `/pos/products?q=${encodeURIComponent(q)}&limit=5`, { token: cx.token });
    R.check(`I-${q.slice(0, 10)}`, `pesquisa com "${q}" não rebenta nem vaza`, r.status === 200 && Array.isArray(r.body?.items ?? r.body) && !JSON.stringify(r.body).includes('argon2'), r.status);
  }
  const still = Number((await c.query('SELECT count(*) n FROM products')).rows[0].n);
  R.check('I-INT', 'tabela de produtos intacta após tentativas de injeção', still >= P.length, still);

  await c.end();
  fs.mkdirSync('qa/out', { recursive: true });
  fs.writeFileSync('qa/out/cenarios.json', JSON.stringify(R.summary(), null, 1));
  const s = R.summary();
  console.log(`\n${s.passed}/${s.total} verificações passaram, ${s.failed} falharam`);
}

main().catch((e) => { console.error(e); process.exit(1); });
