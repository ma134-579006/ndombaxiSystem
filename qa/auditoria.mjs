/**
 * QA — auditoria alargada sobre as cinco empresas de qa/seed-cinco.mjs (só localhost).
 * Cálculo financeiro contra aritmética decimal EXATA (BigInt), valores extremos, caixa,
 * concorrência de stock, idempotência, numeração fiscal, isolamento entre empresas,
 * validação de entradas e compras. Saída: qa/out/auditoria.json
 * Uso: node qa/auditoria.mjs [bloco,bloco…]   (fin,ext,caixa,stock,fiscal,iso,input,compras)
 */
import fs from 'node:fs';
import { call, ok, db, uuid, Report, sleep } from './lib.mjs';

const S = JSON.parse(fs.readFileSync(process.env.QA_CINCO ?? 'qa/.cinco.json', 'utf8'));
const R = new Report('auditoria');
const ONLY = (process.argv[2] ?? '').split(',').filter(Boolean);
const run = (b) => !ONLY.length || ONLY.includes(b);
const tokens = {};
async function tk(k, nick) {
  const email = nick ? S[k].users[nick].email : S[k].email;
  if (!tokens[email]) {
    const r = await ok('POST', '/auth/login', { body: { email, password: S.pass } });
    tokens[email] = r.tokens?.accessToken ?? r.accessToken;
  }
  return tokens[email];
}

// ── aritmética exata: cêntimos em BigInt, meio para cima ─────────────────────
const big = (n, scale) => BigInt(Math.round(Number(n) * 10 ** scale));
const divHalfUp = (a, b) => (a * 2n + b) / (b * 2n);
function exactLine(qty, price, disc, rate) {
  const net = divHalfUp(big(qty, 3) * big(price, 2) * (10000n - big(disc, 4)), 1000n * 10000n); // cêntimos
  const iva = divHalfUp(net * big(rate, 2), 10000n);
  return { net, iva, gross: net + iva };
}
const cents = (v) => BigInt(Math.round(Number(v) * 100));
const kz = (c) => (Number(c) / 100).toFixed(2);

async function invoiceRows(c, id) {
  const inv = (await c.query('SELECT * FROM invoices WHERE id=$1', [id])).rows[0];
  const items = (await c.query('SELECT * FROM invoice_items WHERE invoice_id=$1 ORDER BY line_number', [id])).rows;
  return { inv, items };
}

/** Compara uma fatura emitida (API + base) com o cálculo exato. Devolve '' ou a divergência. */
async function checkInvoice(c, body) {
  const { inv, items } = await invoiceRows(c, body.id);
  let net = 0n, iva = 0n;
  for (const it of items) {
    const e = exactLine(it.quantity, it.unit_price, it.discount_rate, it.iva_rate);
    if (cents(it.net_amount) !== e.net || cents(it.iva_amount) !== e.iva || cents(it.gross_amount) !== e.gross) {
      return `linha ${it.product_code} q=${it.quantity} p=${it.unit_price} d=${it.discount_rate} r=${it.iva_rate}: base ${it.net_amount}/${it.iva_amount}/${it.gross_amount} vs exato ${kz(e.net)}/${kz(e.iva)}/${kz(e.gross)}`;
    }
    net += e.net; iva += e.iva;
  }
  if (cents(inv.net_total) !== net || cents(inv.iva_total) !== iva || cents(inv.gross_total) !== net + iva) return `totais base ${inv.net_total}/${inv.iva_total}/${inv.gross_total} vs exato ${kz(net)}/${kz(iva)}/${kz(net + iva)}`;
  if (cents(body.netTotal) !== net || cents(body.grossTotal) !== net + iva) return `API ${body.netTotal}/${body.grossTotal} vs base ${inv.net_total}/${inv.gross_total}`;
  return '';
}

async function main() {
  const cA = await db(S.A.schema);
  const A = await tk('A'); const ger = await tk('A', 'gerente'); const cx1 = await tk('A', 'caixa1');
  const P = S.A.products;
  const gerPin = S.A.users.gerente.pin;

  // ── FIN: 150 vendas aleatórias com descontos, comparadas ao cêntimo ────────
  if (run('fin')) {
    let bad = 0, done = 0, first = '';
    let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 150; i++) {
      const n = 1 + Math.floor(rnd() * 6);
      const lines = Array.from({ length: n }, () => ({ productCode: P[Math.floor(rnd() * 300)].code, quantity: [1, 2, 3, 0.5, 1.25, 0.333, 7, 12, 2.005][Math.floor(rnd() * 9)], ...(rnd() < 0.4 ? { discountRate: [0.05, 0.1, 0.125, 0.3333, 0.5, 0.0001][Math.floor(rnd() * 6)] } : {}) }));
      // linhas com o mesmo produto somam-se: evita duplicados para a comparação por linha
      const seen = new Set(); const uniq = lines.filter((l) => !seen.has(l.productCode) && seen.add(l.productCode));
      const r = await call('POST', '/pos/invoices', { token: ger, body: { lines: uniq, paymentType: pick(['CASH', 'CARD', 'TRANSFER'], i), approvalPin: gerPin } });
      if (r.status >= 300) { if (!first) first = `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`; bad++; continue; }
      done++;
      const d = await checkInvoice(cA, r.body);
      if (d) { bad++; if (!first) first = d; }
    }
    R.check('FIN-1', '150 vendas aleatórias (quantidades fracionadas e descontos): linhas e totais iguais ao cálculo decimal exato', bad === 0, `${done} emitidas, ${bad} divergências ${first}`);

    // API ↔ relatório de documentos
    const sum = (await cA.query("SELECT COALESCE(SUM(gross_total),0) g, COUNT(*) n FROM invoices WHERE doc_type IN ('FT','FR','FS') AND status<>'CANCELLED'")).rows[0];
    const li = (await cA.query("SELECT COALESCE(SUM(ii.gross_amount),0) g FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.doc_type IN ('FT','FR','FS') AND i.status<>'CANCELLED'")).rows[0];
    R.check('FIN-2', 'soma dos totais das faturas = soma das linhas (base)', cents(sum.g) === cents(li.g), `${sum.g} vs ${li.g} em ${sum.n} documentos`);
  }

  // ── EXT: valores extremos ────────────────────────────────────────────────
  if (run('ext')) {
    const mk = async (code, price, iva = 'NOR') => {
      const r = await call('POST', '/pos/products', { token: A, body: { code, name: `Extremo ${code}`, ivaCode: iva, ...(iva === 'ISE' ? { exemptionCode: 'M10' } : {}), unitPrice: price, costPrice: 0, stockQty: 0 } });
      if (r.status < 300) await call('POST', '/erp/stock/entry', { token: A, body: { productId: r.body.id, warehouseId: S.A.storeId, quantity: 10000000, unitCost: 0.01 } });
      return r;
    };
    const tag = String(Date.now()).slice(-6);
    for (const [price, qty] of [[0.01, 1], [0.01, 3], [0.05, 1], [0.1, 7], [0.99, 0.5], [0.01, 0.001], [99999999.99, 1], [1234567.89, 999], [0.03, 0.333]]) {
      const code = `X${tag}${String(price).replace('.', '')}`.slice(0, 20) + qty;
      const p = await mk(code, price);
      if (p.status >= 300 && p.status !== 409) { R.check('EXT', `produto a ${price} Kz criado`, false, `${p.status} ${JSON.stringify(p.body).slice(0, 150)}`); continue; }
      const r = await call('POST', '/pos/invoices', { token: ger, body: { lines: [{ productCode: code, quantity: qty }], paymentType: 'CARD' } });
      if (r.status >= 300) { R.check(`EXT ${price}×${qty}`, 'venda com valor extremo: aceite ou recusada com mensagem clara (nunca 5xx)', r.status < 500, `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); continue; }
      const d = await checkInvoice(cA, r.body);
      R.check(`EXT ${price}×${qty}`, 'venda com valor extremo bate com o cálculo exato', !d, d || `total ${r.body.grossTotal}`);
    }
    // preço com mais de 2 casas: o que fica guardado?
    const p3 = await mk(`X${tag}D3`, 10.005);
    const st = (await cA.query('SELECT unit_price FROM products WHERE code=$1', [`X${tag}D3`])).rows[0];
    R.check('EXT-3D', 'preço com 3 casas decimais (10,005) guardado arredondado meio para cima (10,01)', p3.status < 300 && String(st?.unit_price) === '10.01', `${p3.status} guardado=${st?.unit_price}`);
    // desconto máximo
    const dm = await call('POST', '/pos/invoices', { token: ger, body: { lines: [{ productCode: P[3].code, quantity: 1, discountRate: 0.9999 }], paymentType: 'CARD', approvalPin: gerPin } });
    R.check('EXT-DESC', 'desconto de 99,99 % calcula sem erro', dm.status < 300 && !(await checkInvoice(cA, dm.body)), `${dm.status} ${JSON.stringify(dm.body).slice(0, 150)}`);
    for (const [name, body] of [
      ['quantidade negativa', { lines: [{ productCode: P[3].code, quantity: -1 }] }],
      ['quantidade zero', { lines: [{ productCode: P[3].code, quantity: 0 }] }],
      ['desconto 100 %', { lines: [{ productCode: P[3].code, quantity: 1, discountRate: 1 }], approvalPin: gerPin }],
      ['desconto negativo', { lines: [{ productCode: P[3].code, quantity: 1, discountRate: -0.5 }], approvalPin: gerPin }],
      ['sem linhas', { lines: [] }],
      ['preço imposto pelo cliente', { lines: [{ productCode: P[3].code, quantity: 1, unitPrice: 0.01 }] }],
      ['quantidade 1e308', { lines: [{ productCode: P[3].code, quantity: 1e308 }] }],
    ]) {
      const r = await call('POST', '/pos/invoices', { token: ger, body: { ...body, paymentType: 'CARD' } });
      R.check('EXT-NEG', `${name} é recusada (4xx)`, r.status >= 400 && r.status < 500, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    }
    // troco e pagamento insuficiente
    const price = P[10].price; const iva = P[10].iva === 'NOR' ? 14 : 0;
    const tot = Number(kz(exactLine(1, price, 0, iva).gross));
    const short = await call('POST', '/pos/invoices', { token: ger, body: { lines: [{ productCode: P[10].code, quantity: 1 }], paymentType: 'CASH', tendered: tot - 2 } });
    R.check('EXT-TROCO-1', 'numerário entregue inferior ao total é recusado', short.status >= 400 && short.status < 500, `${short.status} total ${tot}`);
    const mixBad = await call('POST', '/pos/invoices', { token: ger, body: { lines: [{ productCode: P[10].code, quantity: 1 }], payments: [{ type: 'CASH', amount: tot + 50 }, { type: 'CARD', amount: 1 }] } });
    R.check('EXT-MISTO', 'pagamento misto acima do total é recusado', mixBad.status === 400, mixBad.status);
  }

  // ── CAIXA ────────────────────────────────────────────────────────────────
  if (run('caixa')) {
    const cx2 = await tk('A', 'caixa2');
    // fecha sessões abertas de execuções anteriores
    for (const t of [cx1, cx2]) { const cur = await call('GET', '/cashbox/session/current', { token: t }); if (cur.body?.id) await call('POST', '/cashbox/session/close', { token: t, body: { countedCash: Number(cur.body.expectedCash ?? cur.body.expected_cash ?? 0) } }); }
    const before = (await cA.query("SELECT COUNT(*) n FROM cash_movements")).rows[0].n;
    const noSess = await call('POST', '/pos/invoices', { token: cx2, body: { lines: [{ productCode: P[20].code, quantity: 1 }], paymentType: 'CASH', tendered: 100000 } });
    const after = (await cA.query("SELECT COUNT(*) n FROM cash_movements")).rows[0].n;
    R.check('CX-0', 'venda em numerário SEM turno aberto: recusada, ou o dinheiro fica registado', noSess.status >= 400 || Number(after) > Number(before), `estado ${noSess.status}; movimentos de caixa ${before}→${after}`);

    const open = await call('POST', '/cashbox/session/open', { token: cx1, body: { openingFloat: 10000 } });
    R.check('CX-1', 'abrir turno com fundo de 10 000', open.status < 300, open.status + ' ' + JSON.stringify(open.body).slice(0, 120));
    const open2 = await call('POST', '/cashbox/session/open', { token: cx1, body: { openingFloat: 5 } });
    R.check('CX-2', 'segundo turno do mesmo operador é recusado ou devolve o mesmo', open2.status >= 400 || open2.body?.id === open.body?.id, `${open2.status} ${JSON.stringify(open2.body).slice(0, 100)}`);
    let drawer = 10000n * 100n;
    for (let i = 0; i < 8; i++) {
      const code = P[30 + i].code; const e = exactLine(2, P[30 + i].price, 0, P[30 + i].iva === 'NOR' ? 14 : 0);
      const tend = Math.ceil(Number(e.gross) / 100 / 500) * 500;
      const r = await call('POST', '/pos/invoices', { token: cx1, body: { lines: [{ productCode: code, quantity: 2 }], paymentType: 'CASH', tendered: tend } });
      if (r.status < 300) drawer += cents(r.body.grossTotal);
      else R.check('CX-V', 'venda no turno', false, `${r.status} ${JSON.stringify(r.body).slice(0, 150)}`);
    }
    const card = await call('POST', '/pos/invoices', { token: cx1, body: { lines: [{ productCode: P[40].code, quantity: 1 }], paymentType: 'CARD' } });
    const mixE = exactLine(3, P[41].price, 0, P[41].iva === 'NOR' ? 14 : 0).gross;
    const mix = await call('POST', '/pos/invoices', { token: cx1, body: { lines: [{ productCode: P[41].code, quantity: 3 }], payments: [{ type: 'CASH', amount: 100 }, { type: 'CARD', amount: Number(kz(mixE - 10000n)) }], tendered: 100 } });
    if (mix.status < 300) drawer += 10000n;
    R.check('CX-3', 'venda a cartão e venda mista emitidas', card.status < 300 && mix.status < 300, `${card.status} ${mix.status} ${JSON.stringify(mix.body).slice(0, 150)}`);
    const out = await call('POST', '/cashbox/session/movement', { token: cx1, body: { type: 'CASH_OUT', amount: 2500.5, reference: 'Sangria QA' } });
    const inn = await call('POST', '/cashbox/session/movement', { token: cx1, body: { type: 'CASH_IN', amount: 1000.25, reference: 'Reforço QA' } });
    if (out.status < 300) drawer -= 250050n; if (inn.status < 300) drawer += 100025n;
    R.check('CX-4', 'sangria e reforço registados', out.status < 300 && inn.status < 300, `${out.status} ${inn.status}`);
    const huge = await call('POST', '/cashbox/session/movement', { token: cx1, body: { type: 'CASH_OUT', amount: 99999999, reference: 'Sangria maior que a gaveta' } });
    R.check('CX-5', 'sangria superior ao dinheiro em caixa é recusada', huge.status >= 400, `${huge.status} ${JSON.stringify(huge.body).slice(0, 120)}`);
    if (huge.status < 300) drawer -= 9999999900n;
    const zero = await call('POST', '/cashbox/session/movement', { token: cx1, body: { type: 'CASH_OUT', amount: 0, reference: 'zero' } });
    R.check('CX-6', 'movimento de 0 Kz é recusado', zero.status >= 400, zero.status);
    const x = await call('GET', '/cashbox/report/x', { token: cx1 });
    const exp = x.body?.expectedCash ?? x.body?.expected_cash ?? x.body?.session?.expectedCash;
    R.check('CX-7', 'relatório X: dinheiro esperado = fundo + numerário − sangrias + reforços', exp != null && cents(exp) === drawer, `X=${exp} simulador=${kz(drawer)} ${exp == null ? JSON.stringify(x.body).slice(0, 300) : ''}`);
    // fecho simultâneo com venda
    const [cl, late] = await Promise.all([
      call('POST', '/cashbox/session/close', { token: cx1, body: { countedCash: Number(kz(drawer)) - 150 } }),
      call('POST', '/pos/invoices', { token: cx1, body: { lines: [{ productCode: P[42].code, quantity: 1 }], paymentType: 'CASH', tendered: 500000 } }),
    ]);
    const sess = (await cA.query('SELECT * FROM cash_sessions WHERE id=$1', [open.body.id])).rows[0];
    const mv = (await cA.query("SELECT COALESCE(SUM(CASE WHEN type IN ('CASH_OUT','REFUND') THEN -amount ELSE amount END),0) s FROM cash_movements WHERE session_id=$1 AND (payment_type IS NULL OR payment_type='CASH' OR type IN ('CASH_IN','CASH_OUT','REFUND'))", [open.body.id])).rows[0];
    R.check('CX-8', 'fecho: diferença = contado − esperado (−150 ou coerente com a venda simultânea)', cl.status < 300 && sess && cents(sess.difference) === cents(sess.counted_cash) - cents(sess.expected_cash), `fecho ${cl.status} venda ${late.status} esperado=${sess?.expected_cash} contado=${sess?.counted_cash} dif=${sess?.difference} movimentos=${mv.s}`);
    R.check('CX-9', 'esperado no fecho = fundo + movimentos em numerário do turno', sess && cents(sess.expected_cash) === cents(sess.opening_float) + cents(mv.s), `esperado ${sess?.expected_cash} vs ${Number(sess?.opening_float) + Number(mv.s)}`);
    const again = await call('POST', '/cashbox/session/close', { token: cx1, body: { countedCash: 1 } });
    R.check('CX-10', 'fechar duas vezes é recusado', again.status >= 400, again.status);
  }

  // ── STOCK / concorrência ─────────────────────────────────────────────────
  if (run('stock')) {
    const tag = String(Date.now()).slice(-6);
    const code = `S${tag}`;
    const p = await ok('POST', '/pos/products', { token: A, body: { code, name: 'Últimas unidades', ivaCode: 'NOR', unitPrice: 100, costPrice: 50, stockQty: 0 } });
    await ok('POST', '/erp/stock/entry', { token: A, body: { productId: p.id, warehouseId: S.A.storeId, quantity: 5, unitCost: 50 } });
    const rs = await Promise.all(Array.from({ length: 25 }, (_, i) => call('POST', '/pos/invoices', { token: i % 2 ? cx1 : ger, body: { lines: [{ productCode: code, quantity: 1 }], paymentType: 'CARD' } })));
    const okN = rs.filter((r) => r.status < 300).length; const s5 = rs.filter((r) => r.status >= 500).length;
    const q = (await cA.query('SELECT quantity FROM stock_items WHERE product_id=$1 AND warehouse_id=$2', [p.id, S.A.storeId])).rows[0];
    const mv = (await cA.query('SELECT COALESCE(SUM(quantity),0) s FROM stock_movements WHERE product_id=$1', [p.id])).rows[0];
    R.check('ST-1', '25 vendas simultâneas das últimas 5 unidades: exatamente 5 passam, stock = 0', okN === 5 && Number(q.quantity) === 0, `${okN} vendidas, stock ${q.quantity}, 5xx=${s5}, recusas: ${[...new Set(rs.filter((r) => r.status >= 400).map((r) => r.status))].join(',')}`);
    R.check('ST-2', 'stock = soma dos movimentos', Number(q.quantity) === Number(mv.s), `${q.quantity} vs ${mv.s}`);
    const more = await call('POST', '/pos/invoices', { token: ger, body: { lines: [{ productCode: code, quantity: 1 }], paymentType: 'CARD' } });
    R.check('ST-3', 'venda sem stock é recusada com mensagem', more.status === 400 || more.status === 409, `${more.status} ${JSON.stringify(more.body).slice(0, 120)}`);
    // idempotência
    const op = uuid();
    const body = { lines: [{ productCode: P[50].code, quantity: 1 }], paymentType: 'CARD', clientOpId: op };
    const dup = await Promise.all([1, 2, 3, 4].map(() => call('POST', '/pos/invoices', { token: ger, body })));
    const n = (await cA.query('SELECT COUNT(*) n FROM invoices WHERE client_op_id=$1', [op])).rows[0].n;
    R.check('ST-4', 'a mesma operação repetida 4× em simultâneo cria UMA fatura', Number(n) === 1 && dup.every((r) => r.status < 500), `${n} faturas; estados ${dup.map((r) => r.status).join(',')}`);
    // devolução: stock volta; devolver mais do que o vendido é recusado
    const v = await ok('POST', '/pos/invoices', { token: ger, body: { lines: [{ productCode: P[51].code, quantity: 4 }], paymentType: 'CARD' } });
    const q0 = Number((await cA.query('SELECT quantity FROM stock_items WHERE product_id=$1 AND warehouse_id=$2', [P[51].id, S.A.storeId])).rows[0].quantity);
    const ret = await call('POST', `/pos/invoices/${v.id}/return`, { token: ger, body: { items: [{ productCode: P[51].code, quantity: 1.5 }], reason: 'QA devolução parcial' } });
    const q1 = Number((await cA.query('SELECT quantity FROM stock_items WHERE product_id=$1 AND warehouse_id=$2', [P[51].id, S.A.storeId])).rows[0].quantity);
    R.check('ST-5', 'devolução parcial de 1,5: stock sobe 1,5', ret.status < 300 && Math.abs(q1 - q0 - 1.5) < 0.0005, `${ret.status} ${q0}→${q1}`);
    const over = await call('POST', `/pos/invoices/${v.id}/return`, { token: ger, body: { items: [{ productCode: P[51].code, quantity: 3 }], reason: 'QA mais do que resta' } });
    R.check('ST-6', 'devolver mais do que resta da fatura é recusado', over.status >= 400 && over.status < 500, over.status);
    const two = await Promise.all([1, 2].map(() => call('POST', `/pos/invoices/${v.id}/return`, { token: ger, body: { items: [{ productCode: P[51].code, quantity: 2.5 }], reason: 'QA dupla' } })));
    const q2 = Number((await cA.query('SELECT quantity FROM stock_items WHERE product_id=$1 AND warehouse_id=$2', [P[51].id, S.A.storeId])).rows[0].quantity);
    R.check('ST-7', 'duas devoluções simultâneas do resto: só uma passa', two.filter((r) => r.status < 300).length === 1 && Math.abs(q2 - q1 - 2.5) < 0.0005, `${two.map((r) => r.status).join(',')} stock ${q1}→${q2}`);
    const neg = (await cA.query('SELECT COUNT(*) n FROM stock_items WHERE quantity < 0')).rows[0].n;
    R.check('ST-8', 'nenhum stock negativo na empresa', Number(neg) === 0, `${neg} artigos`);
    const drift = (await cA.query('SELECT COUNT(*) n FROM (SELECT si.product_id, si.warehouse_id, si.quantity, COALESCE((SELECT SUM(m.quantity) FROM stock_movements m WHERE m.product_id=si.product_id AND m.warehouse_id=si.warehouse_id),0) s FROM stock_items si) x WHERE x.quantity <> x.s')).rows[0].n;
    R.check('ST-9', 'todos os saldos de stock = soma dos movimentos', Number(drift) === 0, `${drift} divergentes`);
    const adj = await call('POST', '/erp/stock/adjust', { token: A, body: { productId: P[52].id, warehouseId: S.A.storeId, newQuantity: -5, reason: 'negativo' } });
    R.check('ST-10', 'ajuste para quantidade negativa é recusado', adj.status >= 400 && adj.status < 500, adj.status);
  }

  // ── FISCAL: sequência, cadeia, imutabilidade ─────────────────────────────
  if (run('fiscal')) {
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => call('POST', '/pos/invoices', { token: i % 2 ? cx1 : ger, body: { lines: [{ productCode: P[60 + i].code, quantity: 1 }], paymentType: 'CARD' } })));
    R.check('FI-1', '30 emissões simultâneas sem erro', rs.every((r) => r.status < 300), rs.filter((r) => r.status >= 300).map((r) => `${r.status} ${JSON.stringify(r.body).slice(0, 80)}`).slice(0, 2).join(' | '));
    const gaps = (await cA.query('SELECT doc_type, series, year, COUNT(*) n, MIN(sequence) mn, MAX(sequence) mx, COUNT(DISTINCT sequence) d FROM invoices GROUP BY 1,2,3')).rows;
    R.check('FI-2', 'numeração sem saltos nem repetições por tipo/série/ano', gaps.every((g) => Number(g.n) === Number(g.d) && Number(g.mx) - Number(g.mn) + 1 === Number(g.n)), gaps.map((g) => `${g.doc_type} ${g.series}${g.year}: ${g.n} docs ${g.mn}..${g.mx}`).join('; '));
    const chain = (await cA.query('SELECT doc_type, series, year, sequence, hash, previous_hash FROM invoices ORDER BY doc_type, series, year, sequence')).rows;
    let broken = 0; for (let i = 1; i < chain.length; i++) { const a = chain[i - 1], b = chain[i]; if (a.doc_type === b.doc_type && a.series === b.series && a.year === b.year && b.previous_hash !== a.hash) broken++; }
    R.check('FI-3', 'cadeia de hash contínua em cada série', broken === 0, `${broken} quebras em ${chain.length} documentos`);
    const dates = (await cA.query('SELECT COUNT(*) n FROM invoices a JOIN invoices b ON a.doc_type=b.doc_type AND a.series=b.series AND a.year=b.year AND b.sequence=a.sequence+1 WHERE b.system_entry_date < a.system_entry_date')).rows[0].n;
    R.check('FI-4', 'datas de registo não recuam dentro da série', Number(dates) === 0, `${dates} inversões`);
    const one = rs[0].body.id;
    for (const [m, u] of [['PATCH', `/pos/invoices/${one}`], ['PUT', `/pos/invoices/${one}`], ['DELETE', `/pos/invoices/${one}`]]) {
      const r = await call(m, u, { token: A, body: { grossTotal: 1 } });
      R.check('FI-5', `${m} numa fatura emitida não existe/é recusado`, r.status >= 400, r.status);
    }
    const can = await call('POST', `/pos/invoices/${one}/cancel`, { token: ger, body: { reason: 'QA anulação' } });
    const can2 = await call('POST', `/pos/invoices/${one}/cancel`, { token: ger, body: { reason: 'QA anulação repetida' } });
    const ncs = (await cA.query("SELECT COUNT(*) n, COALESCE(SUM(gross_total),0) g FROM invoices WHERE source_invoice_id=$1 AND doc_type='NC'", [one])).rows[0];
    const orig = (await cA.query('SELECT gross_total, status FROM invoices WHERE id=$1', [one])).rows[0];
    R.check('FI-6', 'anular gera UMA nota de crédito do valor total; repetir é recusado', can.status < 300 && can2.status >= 400 && Number(ncs.n) === 1 && cents(ncs.g) === cents(orig.gross_total), `${can.status}/${can2.status} NC=${ncs.n} ${ncs.g} vs ${orig.gross_total} estado=${orig.status}`);
    const retC = await call('POST', `/pos/invoices/${one}/return`, { token: ger, body: { items: [{ productCode: P[60].code, quantity: 1 }], reason: 'devolver anulada' } });
    R.check('FI-7', 'devolução de fatura já anulada é recusada', retC.status >= 400 && retC.status < 500, retC.status);
    const caixaCancel = await call('POST', `/pos/invoices/${rs[1].body.id}/cancel`, { token: cx1, body: { reason: 'caixa anula' } });
    R.check('FI-8', 'operador de caixa não anula faturas', caixaCancel.status === 403, caixaCancel.status);
    const saft = await call('GET', `/pos/saft?year=${new Date().getFullYear()}&month=${new Date().getMonth() + 1}`, { token: A });
    const xml = typeof saft.body === 'string' ? saft.body : JSON.stringify(saft.body);
    const nInv = (xml.match(/<Invoice>/g) ?? []).length;
    const nDb = (await cA.query("SELECT COUNT(*) n FROM invoices WHERE doc_type IN ('FT','FR','FS','NC','ND') AND date_trunc('month', invoice_date)=date_trunc('month', now())")).rows[0].n;
    R.check('FI-9', 'SAF-T do mês contém todos os documentos da base', saft.status < 300 && nInv === Number(nDb), `${saft.status} xml=${nInv} base=${nDb} ${saft.status >= 300 ? xml.slice(0, 200) : ''}`);
  }

  // ── ISO: isolamento entre empresas ───────────────────────────────────────
  if (run('iso')) {
    const B = await tk('B'); const cB = await db(S.B.schema);
    const invA = (await cA.query('SELECT id FROM invoices LIMIT 1')).rows[0].id;
    const custA = S.A.customers[0]; const prodA = P[0];
    const probes = [
      ['GET', `/pos/invoices/${invA}`], ['POST', `/pos/invoices/${invA}/cancel`, { reason: 'x' }], ['POST', `/pos/invoices/${invA}/return`, { items: [{ productCode: prodA.code, quantity: 1 }], reason: 'x' }],
      ['PATCH', `/pos/products/${prodA.id}`, { unitPrice: 1 }], ['DELETE', `/pos/products/${prodA.id}`], ['PATCH', `/pos/customers/${custA}`, { name: 'Roubado' }], ['DELETE', `/pos/customers/${custA}`],
      ['POST', '/erp/stock/adjust', { productId: prodA.id, warehouseId: S.A.storeId, newQuantity: 0, reason: 'x' }], ['POST', '/erp/stock/entry', { productId: prodA.id, warehouseId: S.A.storeId, quantity: 1, unitCost: 1 }],
      ['POST', '/pos/products/bulk-delete', { ids: [prodA.id] }], ['DELETE', `/staff/users/${S.A.users.caixa1.id}`], ['POST', `/staff/users/${S.A.users.caixa1.id}/set-pin`, { pin: '111111' }],
      ['GET', `/ecommerce/orders/${invA}`], ['GET', `/receivables/${invA}`],
    ];
    const before = (await cA.query('SELECT unit_price, is_active FROM products WHERE id=$1', [prodA.id])).rows[0];
    let leaks = [];
    for (const [m, u, b] of probes) { const r = await call(m, u, { token: B, body: b }); if (r.status < 300 && !(m === 'POST' && u.includes('bulk-delete') && JSON.stringify(r.body).includes('0'))) leaks.push(`${m} ${u.replace(/[0-9a-f-]{36}/g, ':id')} → ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`); }
    const afterP = (await cA.query('SELECT unit_price, is_active FROM products WHERE id=$1', [prodA.id])).rows[0];
    const custName = (await cA.query('SELECT name FROM customers WHERE id=$1', [custA])).rows[0];
    const userA = (await cA.query('SELECT id FROM users WHERE id=$1', [S.A.users.caixa1.id])).rows[0];
    R.check('ISO-1', 'empresa B não lê nem altera faturas, produtos, clientes, stock ou utilizadores da empresa A', afterP && String(afterP.unit_price) === String(before.unit_price) && afterP.is_active === before.is_active && custName?.name !== 'Roubado' && !!userA && !leaks.filter((l) => !l.includes('bulk-delete')).length, leaks.join(' | ') || 'todas recusadas');
    const lists = [];
    for (const u of ['/pos/products?q=A0000', '/pos/customers?q=Cliente A', '/pos/invoices', '/notifications', '/ecommerce/orders', '/ecommerce/kwanza/products', '/erp/suppliers']) {
      const r = await call('GET', u, { token: B }); const s = JSON.stringify(r.body);
      if (/Cliente A \d|"A0000\d"|Fornecedor A /.test(s)) lists.push(u);
    }
    R.check('ISO-2', 'listagens da empresa B não mostram dados da empresa A', lists.length === 0, lists.join(', '));
    // token adulterado: trocar o schema no payload
    const parts = B.split('.'); const pl = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); pl.tenantSchema = S.A.schema; pl.tenantId = S.A.tenantId;
    const forged = `${parts[0]}.${Buffer.from(JSON.stringify(pl)).toString('base64url')}.${parts[2]}`;
    const f = await call('GET', '/pos/invoices', { token: forged });
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(pl)).toString('base64url')}.`;
    const f2 = await call('GET', '/pos/invoices', { token: none });
    R.check('ISO-3', 'token com a empresa trocada ou alg=none é recusado', f.status === 401 && f2.status === 401, `${f.status} ${f2.status}`);
    const hdr = await call('GET', '/pos/invoices', { token: B, headers: { 'x-tenant-id': S.A.tenantId, 'x-company-code': S.A.code ?? '', 'x-tenant-schema': S.A.schema } });
    const nB = (await cB.query('SELECT COUNT(*) n FROM invoices')).rows[0].n;
    const got = Array.isArray(hdr.body) ? hdr.body.length : (hdr.body?.items?.length ?? hdr.body?.total ?? 0);
    R.check('ISO-4', 'cabeçalhos de empresa forjados não mudam o âmbito', hdr.status < 300 ? Number(got) <= Number(nB) : true, `${hdr.status} devolveu ${got}; B tem ${nB}`);
    await cB.end();
    // perfis dentro da empresa
    const at = await tk('A', 'atendente');
    const denied = [];
    for (const [m, u] of [['GET', '/hr/employees'], ['GET', '/hr/payroll'], ['GET', '/profit'], ['GET', '/expenses'], ['GET', '/erp/suppliers'], ['GET', '/staff/users'], ['GET', '/reports/sales'], ['GET', '/cashflow'], ['GET', '/payables'], ['GET', '/backup']]) {
      for (const [who, t] of [['caixa', cx1], ['atendente', at]]) { const r = await call(m, u, { token: t }); if (r.status < 300) denied.push(`${who} ${u} ${r.status}`); }
    }
    R.check('ISO-5', 'caixa e atendente não consultam salários, lucros, despesas, fornecedores, equipa nem backups', denied.length === 0, denied.join(' | '));
  }

  // ── INPUT: validação de entradas ─────────────────────────────────────────
  if (run('input')) {
    const tag = String(Date.now()).slice(-6);
    const long = 'Ç'.repeat(200);
    const cases = [
      ['acentos e emoji', { code: `I${tag}1`, name: 'Pão de Ló — açúcar 🍞 “especial” Ñ', ivaCode: 'NOR', unitPrice: 10 }, 201],
      ['nome com 200 caracteres', { code: `I${tag}2`, name: long, ivaCode: 'NOR', unitPrice: 10 }, 201],
      ['nome com 201 caracteres', { code: `I${tag}3`, name: long + 'x', ivaCode: 'NOR', unitPrice: 10 }, 400],
      ['nome vazio', { code: `I${tag}4`, name: '', ivaCode: 'NOR', unitPrice: 10 }, 400],
      ['preço negativo', { code: `I${tag}5`, name: 'neg', ivaCode: 'NOR', unitPrice: -1 }, 400],
      ['custo negativo', { code: `I${tag}6`, name: 'neg', ivaCode: 'NOR', unitPrice: 1, costPrice: -1 }, 400],
      ['IVA inválido', { code: `I${tag}7`, name: 'iva', ivaCode: 'XXX', unitPrice: 1 }, 400],
      ['isento sem motivo', { code: `I${tag}8`, name: 'ise', ivaCode: 'ISE', unitPrice: 1 }, 400],
      ['preço acima do campo (1e13)', { code: `I${tag}A`, name: 'big', ivaCode: 'NOR', unitPrice: 1e13 }, 400],
      ['campo desconhecido (tenant_id)', { code: `I${tag}B`, name: 'extra', ivaCode: 'NOR', unitPrice: 1, tenantId: 'x', isAdmin: true }, 400],
      ['script no nome', { code: `I${tag}C`, name: '<script>alert(1)</script><img src=x onerror=alert(1)>', ivaCode: 'NOR', unitPrice: 1 }, 201],
    ];
    for (const [name, body, want] of cases) {
      const r = await call('POST', '/pos/products', { token: A, body });
      R.check('IN-P', `produto: ${name} → ${want}`, want === 201 ? r.status < 300 : r.status >= 400 && r.status < 500, `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
    }
    const stored = (await cA.query('SELECT name FROM products WHERE code=$1', [`I${tag}1`])).rows[0];
    R.check('IN-1', 'acentos e emoji guardados sem corrupção', stored?.name === 'Pão de Ló — açúcar 🍞 “especial” Ñ', stored?.name);
    const dupe = await call('POST', '/pos/products', { token: A, body: { code: `I${tag}1`, name: 'duplicado', ivaCode: 'NOR', unitPrice: 1 } });
    R.check('IN-2', 'código de produto duplicado é recusado (409/400)', dupe.status === 409 || dupe.status === 400, dupe.status);
    const dupB = await Promise.all([1, 2, 3].map(() => call('POST', '/pos/products', { token: A, body: { code: `I${tag}Z`, name: 'corrida', ivaCode: 'NOR', unitPrice: 1 } })));
    const nZ = (await cA.query('SELECT COUNT(*) n FROM products WHERE code=$1', [`I${tag}Z`])).rows[0].n;
    R.check('IN-3', 'três criações simultâneas do mesmo código: uma só fica, sem 5xx', Number(nZ) === 1 && dupB.every((r) => r.status < 500), `${nZ} na base; ${dupB.map((r) => r.status).join(',')}`);
    for (const q of ["' OR '1'='1", "'; DROP TABLE products;--", '%', '_', '\\', '\u0000', 'a'.repeat(5000), '<script>', '../../etc/passwd', '🍞']) {
      const r = await call('GET', `/pos/products?q=${encodeURIComponent(q)}`, { token: A });
      R.check('IN-Q', `pesquisa "${q.slice(0, 24).replace(/\u0000/, '\\0')}" não dá 5xx`, r.status < 500, r.status);
    }
    const cust = [
      ['NIF inválido', { name: 'NIF mau', taxId: 'abc' }, 400], ['e-mail inválido', { name: 'mail', email: 'nao-e-email' }, 400],
      ['nome só espaços', { name: '   ' }, 400], ['telefone enorme', { name: 'tel', phone: '9'.repeat(200) }, 400],
    ];
    for (const [name, body, want] of cust) { const r = await call('POST', '/pos/customers', { token: A, body }); R.check('IN-C', `cliente: ${name} → ${want}`, r.status >= 400 && r.status < 500, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`); }
    const c1 = await call('POST', '/pos/customers', { token: A, body: { name: 'Duplicado NIF', taxId: '5417000000' } });
    const c2 = await call('POST', '/pos/customers', { token: A, body: { name: 'Duplicado NIF 2', taxId: '5417000000' } });
    R.check('IN-4', 'dois clientes com o mesmo NIF: o segundo é recusado', c2.status >= 400 || c1.status >= 400, `${c1.status} ${c2.status} ${JSON.stringify(c2.body).slice(0, 100)}`);
    for (const [name, d] of [['data inválida', '2026-13-45'], ['data futura', '2099-01-01'], ['data muito antiga', '1900-01-01']]) {
      const r = await call('POST', '/pos/invoices', { token: ger, body: { lines: [{ productCode: P[70].code, quantity: 1 }], paymentType: 'CARD', operationDate: d } });
      R.check('IN-D', `fatura com ${name} (${d}) é recusada`, r.status >= 400 && r.status < 500, `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
    }
    const bigBody = await call('POST', '/pos/customers', { token: A, body: { name: 'x', address: 'a'.repeat(3_000_000) } });
    R.check('IN-5', 'corpo de 3 MB num campo de texto é recusado (4xx)', bigBody.status >= 400 && bigBody.status < 500, bigBody.status);
    const pag = await call('GET', '/pos/customers?limit=999999999&offset=-5', { token: A });
    R.check('IN-6', 'paginação absurda não dá 5xx', pag.status < 500, pag.status);
    const sup = (await cA.query('SELECT COUNT(*) n FROM suppliers')).rows[0].n;
    R.check('IN-7', 'fornecedores do seed criados (30)', Number(sup) >= 30, `${sup} na base`);
  }

  // ── COMPRAS ──────────────────────────────────────────────────────────────
  if (run('compras')) {
    const sups = await ok('GET', '/erp/suppliers', { token: A });
    let sup = (sups.items ?? sups)[0];
    if (!sup) { const r = await call('POST', '/erp/suppliers', { token: A, body: { code: 'FQA1', name: 'Fornecedor QA compras', nif: '5417000001' } }); sup = r.body; R.check('CO-0', 'criar fornecedor', r.status < 300, `${r.status} ${JSON.stringify(r.body).slice(0, 150)}`); }
    const pr = P[80];
    const s0 = (await cA.query('SELECT si.quantity, p.cost_price FROM stock_items si JOIN products p ON p.id=si.product_id WHERE si.product_id=$1 AND si.warehouse_id=$2', [pr.id, S.A.storeId])).rows[0];
    const po = await call('POST', '/erp/purchase-orders', { token: A, body: { supplierId: sup?.id, warehouseId: S.A.storeId, lines: [{ productCode: pr.code, quantity: 100, unitCost: pr.cost * 2 }] } });
    R.check('CO-1', 'criar pedido de compra de 100 unidades', po.status < 300, `${po.status} ${JSON.stringify(po.body).slice(0, 200)}`);
    if (po.status < 300) {
      const s1 = (await cA.query('SELECT quantity FROM stock_items WHERE product_id=$1 AND warehouse_id=$2', [pr.id, S.A.storeId])).rows[0];
      R.check('CO-2', 'pedido por receber não mexe no stock', Number(s1.quantity) === Number(s0.quantity), `${s0.quantity}→${s1.quantity}`);
      const cf = await call('POST', `/erp/purchase-orders/${po.body.id}/confirm`, { token: A });
      const rc = await call('POST', `/erp/purchase-orders/${po.body.id}/receive`, { token: A, body: {} });
      const rc2 = await call('POST', `/erp/purchase-orders/${po.body.id}/receive`, { token: A, body: {} });
      const s2 = (await cA.query('SELECT si.quantity, p.cost_price FROM stock_items si JOIN products p ON p.id=si.product_id WHERE si.product_id=$1 AND si.warehouse_id=$2', [pr.id, S.A.storeId])).rows[0];
      R.check('CO-3', 'receção: stock +100 uma única vez (segunda receção recusada)', rc.status < 300 && rc2.status >= 400 && Number(s2.quantity) === Number(s0.quantity) + 100, `confirma ${cf.status} recebe ${rc.status}/${rc2.status} stock ${s0.quantity}→${s2.quantity} ${rc.status >= 300 ? JSON.stringify(rc.body).slice(0, 150) : ''}`);
      const wavg = (Number(s0.quantity) * Number(s0.cost_price) + 100 * pr.cost * 2) / (Number(s0.quantity) + 100);
      R.check('CO-4', 'custo médio ponderado atualizado', Math.abs(Number(s2.cost_price) - wavg) <= 0.01, `custo ${s0.cost_price}→${s2.cost_price}; esperado ${wavg.toFixed(2)}`);
      const pay = (await cA.query("SELECT COUNT(*) n, COALESCE(SUM(original_amount),0) v FROM payables WHERE supplier_id=$1 AND created_at > now() - interval '2 minutes'", [sup?.id]).catch(() => ({ rows: [{ n: -1 }] }))).rows[0];
      R.check('CO-5', 'compra recebida gera conta a pagar ao fornecedor', Number(pay.n) >= 1, `contas a pagar: ${pay.n} valor ${pay.v ?? ''}`);
    }
  }

  await cA.end();
  fs.mkdirSync('qa/out', { recursive: true });
  const s = R.summary();
  fs.writeFileSync(`qa/out/auditoria${ONLY.length ? '-' + ONLY.join('-') : ''}.json`, JSON.stringify(s, null, 1));
  console.log(`\n${s.passed}/${s.total} passaram; ${s.failed} falharam`);
}
function pick(a, i) { return a[i % a.length]; }
main().catch((e) => { console.error(e); process.exit(1); });
void sleep;
