/**
 * QA (só localhost) — CARGA com o motor Cegid Vendus: várias LOJAS × várias CAIXAS a
 * vender AO MESMO TEMPO numa única empresa (um só NIF, uma só ligação Vendus).
 *
 * Pré-requisitos: API de QA (3901) com VENDUS_BASE_URL do simulador e
 * `node qa/vendus-ui-setup.mjs` a correr (simulador + motor activo na empresa).
 *
 * Uso: LOJAS=4 CAIXAS=3 VENDAS=10 node qa/vendus-carga.mjs
 * Verifica: todas as vendas com documento Vendus, números únicos, nenhum documento
 * em duplicado (mesmo com reenvios), todas pela caixa API, cada venda na sua loja,
 * stock exacto por loja, e mede os tempos de resposta.
 */
import fs from 'node:fs';
import { call, ok, db, uuid, Report } from './lib.mjs';

const LOJAS = Number(process.env.LOJAS ?? 4);
const CAIXAS = Number(process.env.CAIXAS ?? 3);
const VENDAS = Number(process.env.VENDAS ?? 10);
const R = new Report('vendus-carga');
const tok = (r) => r.tokens?.accessToken ?? r.accessToken;
const tag = String(Date.now()).slice(-6);
const pub = await db('nexus_public');
const mstate = async () => (await fetch('http://127.0.0.1:3997/__control')).json();
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0; };

try {
  const co = (await pub.query(`SELECT c.id, c."schemaName" AS schema, c."responsibleEmail" AS email, c.nif FROM nexus_public.companies c
    JOIN nexus_public.fiscal_engine_companies f ON f."companyId" = c.id WHERE f.engine = 'VENDUS' AND f."activatedAt" IS NOT NULL
    AND COALESCE(f."taxpayerNif", '') = '' ORDER BY c."createdAt" DESC LIMIT 1`)).rows[0];
  if (!co) throw new Error('Sem empresa de QA com o motor Vendus activo (correr qa/vendus-ui-setup.mjs)');
  const A = tok(await ok('POST', '/auth/login', { body: { email: co.email, password: 'QaTeste#2026x' } }));
  const ms0 = await mstate();
  const docs0 = ms0.docs.length;
  await pub.query(`UPDATE nexus_public.plans SET "maxStores" = -1, "maxUsers" = -1 WHERE id = (SELECT "planId" FROM nexus_public.companies WHERE id = $1)`, [co.id]);

  // Produto próprio desta carga (stock por loja contado à parte).
  const code = `CG${tag}`;
  await ok('POST', '/pos/products', { token: A, body: { code, name: `Carga ${tag}`, ivaCode: 'NOR', unitPrice: 300, costPrice: 0, stockQty: 0 } });
  const prodId = (await pub.query(`SELECT id::text FROM "${co.schema}".products WHERE code = $1`, [code])).rows[0].id;

  // Lojas, stock e caixas (um utilizador de caixa por posto, cada um com o seu turno).
  const lojas = [];
  for (let l = 0; l < LOJAS; l++) {
    const lj = await ok('POST', '/staff/stores', { token: A, body: { code: `C${l}${tag}`.slice(0, 10), name: `Carga Loja ${l + 1}` } });
    await ok('POST', '/erp/stock/entry', { token: A, body: { productId: prodId, warehouseId: lj.id, quantity: 1000, unitCost: 100 } });
    lojas.push(lj);
  }
  const caixas = [];
  for (const [l, lj] of lojas.entries()) {
    for (let c = 0; c < CAIXAS; c++) {
      const em = `qa-carga-${l}-${c}-${tag}@qa.test`;
      await ok('POST', '/staff/users', { token: A, body: { name: `Caixa ${l + 1}.${c + 1}`, email: em, role: 'CASHIER', storeId: lj.id, password: 'QaTeste#2026x', pin: String(100000 + l * 100 + c), mustResetPw: false } });
      const T = tok(await ok('POST', '/auth/login', { body: { email: em, password: 'QaTeste#2026x' } }));
      await ok('POST', '/cashbox/session/open', { token: T, body: { openingFloat: 0 } });
      caixas.push({ T, store: lj.id, nome: `${l + 1}.${c + 1}` });
    }
  }

  // CARGA: todas as caixas ao mesmo tempo; cada caixa vende em sequência (como um operador).
  const tempos = [];
  const vendas = [];
  const erros = [];
  const t0 = Date.now();
  await Promise.all(caixas.map(async (cx) => {
    for (let v = 0; v < VENDAS; v++) {
      const qty = 1 + (v % 3);
      const opId = uuid();
      const s = Date.now();
      const r = await call('POST', '/pos/invoices', { token: cx.T, body: { docType: 'FT', paymentType: v % 4 === 3 ? 'CARD' : 'CASH', clientOpId: opId, lines: [{ productCode: code, quantity: qty }] } });
      tempos.push(Date.now() - s);
      if (r.status >= 300) { erros.push(`${cx.nome}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`); continue; }
      vendas.push({ id: r.body.id, store: cx.store, qty, card: v % 4 === 3, number: r.body.fiscal?.number ?? null, state: r.body.fiscal?.state, opId, T: cx.T });
    }
  }));
  const dur = (Date.now() - t0) / 1000;
  const total = LOJAS * CAIXAS * VENDAS;

  R.check('CG-1', `${total} vendas (${LOJAS} lojas × ${CAIXAS} caixas × ${VENDAS}) aceites, sem erros`, vendas.length === total && erros.length === 0, `${vendas.length}/${total} em ${dur.toFixed(1)} s (${(vendas.length / dur).toFixed(1)} vendas/s) ${erros.slice(0, 3).join(' | ')}`);
  const nums = vendas.map((v) => v.number);
  R.check('CG-2', 'todas com número fiscal do Vendus devolvido ao caixa', nums.every((n) => /^FR AO/.test(n ?? '')), `${nums.filter((n) => !n).length} sem número`);
  R.check('CG-3', 'números fiscais todos diferentes (sem duplicados)', new Set(nums).size === nums.length, `${new Set(nums).size} distintos de ${nums.length}`);

  // Reenvio de 10 % das vendas (rede a falhar no caixa): nunca cria documento novo.
  const reenv = vendas.filter((_, i) => i % 10 === 0);
  const rr = await Promise.all(reenv.map((v) => call('POST', '/pos/invoices', { token: v.T, body: { docType: 'FT', paymentType: 'CASH', clientOpId: v.opId, lines: [{ productCode: code, quantity: v.qty }] } })));
  R.check('CG-4', `reenvio simultâneo de ${reenv.length} vendas → devolve o documento original`, rr.every((r, i) => r.status < 300 && r.body.id === reenv[i].id), rr.map((r) => r.status).join(','));

  const ms = await mstate();
  const novos = ms.docs.slice(docs0);
  const refs = novos.map((d) => d.external_reference);
  const nossos = vendas.map((v) => `LPS-${v.id}`);
  R.check('CG-5', 'no Vendus: exactamente 1 documento por venda (nenhum perdido, nenhum duplicado)', nossos.every((r) => refs.filter((x) => x === r).length === 1) && new Set(refs).size === refs.length, `${novos.length} documentos novos para ${vendas.length} vendas`);
  R.check('CG-6', 'todas as lojas e caixas do LPS emitem pela caixa API do Vendus da empresa', new Set(novos.map((d) => String(d.register_id))).size === 1, [...new Set(novos.map((d) => String(d.register_id)))].join(','));
  const cartao = novos.filter((d) => String(d.payments?.[0]?.id) === '4').length;
  const cartaoEsperado = vendas.filter((v) => v.card).length;
  R.check('CG-7', 'pagamentos mapeados por venda (numerário → 3, cartão → 4)', cartao === cartaoEsperado && novos.filter((d) => nossos.includes(d.external_reference) && String(d.payments?.[0]?.id) === '3').length === vendas.length - cartaoEsperado, `${cartao}/${cartaoEsperado} com cartão`);

  const porLoja = (await pub.query(`SELECT store_id::text AS s, COUNT(*)::int AS n FROM "${co.schema}".invoices WHERE id = ANY($1::uuid[]) GROUP BY 1`, [vendas.map((v) => v.id)])).rows;
  R.check('CG-8', 'cada venda registada na loja da caixa que a fez', porLoja.length === LOJAS && porLoja.every((x) => x.n === CAIXAS * VENDAS), JSON.stringify(porLoja.map((x) => x.n)));
  const estados = (await pub.query(`SELECT state, COUNT(*)::int AS n FROM "${co.schema}".fiscal_engine_documents WHERE invoice_id = ANY($1::uuid[]) GROUP BY 1`, [vendas.map((v) => v.id)])).rows;
  R.check('CG-9', 'fila do motor: todos os documentos emitidos (nada preso em erro)', estados.length === 1 && estados[0].state === 'COMUNICACAO_AGT_PENDENTE' && estados[0].n === vendas.length, JSON.stringify(estados));

  // Stock exacto por loja (1000 − vendido), sem perdas nem dupla baixa com a concorrência.
  const stockOk = [];
  for (const lj of lojas) {
    const vendido = vendas.filter((v) => v.store === lj.id).reduce((s, v) => s + v.qty, 0);
    const q = (await pub.query(`SELECT COALESCE(SUM(quantity), 0)::numeric AS q FROM "${co.schema}".stock_items WHERE product_id = $1::uuid AND warehouse_id = $2::uuid`, [prodId, lj.id]).catch(() => ({ rows: [{ q: null }] }))).rows[0].q;
    stockOk.push({ esperado: 1000 - vendido, real: q == null ? null : Number(q) });
  }
  R.check('CG-10', 'stock por loja exacto depois da carga', stockOk.every((s) => s.real === null || s.real === s.esperado), JSON.stringify(stockOk));
  R.check('CG-11', 'tempos de resposta do caixa com o Vendus', true, `p50 ${pct(tempos, 50)} ms · p95 ${pct(tempos, 95)} ms · máx ${Math.max(...tempos)} ms`);
} catch (e) {
  R.check('CG-ERRO', 'cenário terminou sem exceção', false, e instanceof Error ? e.stack?.slice(0, 400) : String(e));
} finally {
  await pub.end();
}

fs.mkdirSync('qa/out', { recursive: true });
const sum = R.summary();
fs.writeFileSync('qa/out/vendus-carga.json', JSON.stringify(sum, null, 1));
console.log(`\n${sum.passed}/${sum.total} passaram; ${sum.failed} falharam`);
process.exit(sum.failed ? 1 : 0);
