/**
 * QA — regras de emissão (Cenários D e I): cliente gravado na emissão (2.ª via
 * não muda quando se edita a ficha), NIF do cliente validado, emitente com NIF
 * provisório recusado, série de posto/WEB recusada ao cliente, offline sem
 * chave tratado como venda normal, replicação de fatura forjada recusada,
 * relatório de validação do SAF-T (XSD + conteúdo). Só localhost.
 *
 * Uso: node qa/fiscal-emissao.mjs
 */
import fs from 'node:fs';
import { call, ok, db, uuid, Report } from './lib.mjs';

const R = new Report('fiscal-emissao');
const tok = (r) => r.tokens?.accessToken ?? r.accessToken;
const tag = String(Date.now()).slice(-6);
const plan = (await ok('GET', '/public/landing')).plans?.[0]?.tier ?? 'STARTER';
const pass = 'QaTeste#2026x';

// Empresa com NIF real (formato) e setup concluído.
const nif = `55${tag}02`;
await ok('POST', '/onboarding/register-simple', { body: { email: `qa-em-${tag}@qa.test`, password: pass, planTier: plan, nif } });
let A = tok(await ok('POST', '/auth/login', { body: { email: `qa-em-${tag}@qa.test`, password: pass } }));
await ok('POST', '/onboarding/complete-setup', { token: A, body: { name: `QA Emissão ${tag} Lda`, nif } });
A = tok(await ok('POST', '/auth/login', { body: { email: `qa-em-${tag}@qa.test`, password: pass } }));
const code = `EM${tag}`;
await ok('POST', '/pos/products', { token: A, body: { code, name: 'Sabão', ivaCode: 'NOR', unitPrice: 500, costPrice: 0, stockQty: 100 } });
await call('POST', '/cashbox/session/open', { token: A, body: { openingFloat: 0 } });
const cust = await ok('POST', '/pos/customers', { token: A, body: { name: 'Cliente Original Lda', taxId: '5417000123' } });
const emit = (b) => call('POST', '/pos/invoices', { token: A, body: { docType: 'FT', paymentType: 'CASH', clientOpId: uuid(), lines: [{ productCode: code, quantity: 1 }], ...b } });

let r = await emit({ customerId: cust.id });
R.check('E-1', 'emite factura com cliente', r.status < 300, `${r.status} ${r.body.number}`);
const inv = r.body;
await call('PATCH', `/pos/customers/${cust.id}`, { token: A, body: { name: 'Nome Mudado Depois' } });
const again = await call('GET', `/pos/invoices/${inv.id}`, { token: A });
const shown = JSON.stringify(again.body);
R.check('E-2', '2.ª via mantém o nome do cliente DA EMISSÃO depois de editar a ficha', shown.includes('Cliente Original Lda') && !shown.includes('Nome Mudado Depois'), shown.slice(0, 200));

// NIF inválido herdado numa ficha antiga (a validação do formulário é recente):
// a emissão recusa-o em vez de o pôr no documento e no SAF-T.
{
  const pub0 = await db('nexus_public');
  const sch = (await pub0.query(`SELECT "schemaName" FROM nexus_public.companies WHERE nif = $1`, [nif])).rows[0].schemaName;
  const badId = (await pub0.query(`INSERT INTO "${sch}".customers (name, tax_id) VALUES ('Ficha Antiga', '12 3') RETURNING id`)).rows[0].id;
  await pub0.end();
  r = await emit({ customerId: badId });
  R.check('E-3', 'cliente com NIF inválido (espaços/curto) → emissão recusada', r.status === 400 && /NIF do cliente/.test(JSON.stringify(r.body)), `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
}
r = await call('POST', '/pos/customers', { token: A, body: { name: 'X', taxId: '<script>' } });
R.check('E-4', 'ficha de cliente com NIF inválido → recusada no formulário', r.status === 400, `${r.status}`);

r = await emit({ series: 'LAB1' });
R.check('E-5', 'pedido com série de posto (L…) → ignorada, emite na série normal', r.status < 300 && !/ LAB1/.test(r.body.number ?? ''), `${r.body.number}`);
r = await emit({ series: 'WEB' });
R.check('E-6', 'pedido com série WEB → ignorada', r.status < 300 && !/ WEB/.test(r.body.number ?? ''), `${r.body.number}`);

// offline sem clientOpId com caixa fechada → controlos normais (recusa por turno fechado).
await call('POST', '/cashbox/session/close', { token: A, body: { countedCash: 0 } });
r = await call('POST', '/pos/invoices', { token: A, body: { docType: 'FT', paymentType: 'CASH', offline: true, lines: [{ productCode: code, quantity: 1 }] } });
R.check('E-7', 'offline:true sem clientOpId não salta o controlo do turno', r.status === 409, `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
r = await call('POST', '/pos/invoices', { token: A, body: { docType: 'FT', paymentType: 'CASH', offline: true, clientOpId: uuid(), lines: [{ productCode: code, quantity: 1 }] } });
R.check('E-8', 'offline:true COM clientOpId (fila da Caixa) continua aceite', r.status < 300, `${r.status}`);

// Replicação: fatura forjada por um caixa.
r = await call('POST', '/replication/push', { token: A, body: { rows: [{ table: 'invoices', id: uuid(), deleted: false, data: { id: uuid(), number: 'FT A2026/9999', doc_type: 'FT', series: 'A', year: 2026, sequence: 9999, invoice_date: '2025-01-01', net_total: 1, iva_total: 0, gross_total: 1, status: 'N', hash: 'x', signable_string: 'x' } }] } });
const out = JSON.stringify(r.body);
R.check('E-9', 'replicação de fatura forjada (série da nuvem, data antiga) → recusada', /recusad|posto local/.test(out) && !/"applied":true/.test(out), out.slice(0, 200));
r = await call('POST', '/replication/push', { token: A, body: { rows: [{ table: 'invoice_items', id: uuid(), deleted: false, data: { id: uuid(), invoice_id: inv.id, line_number: 9, product_code: code, description: 'Extra', quantity: 1, unit_price: 1000, iva_code: 'NOR', iva_rate: 14, net_amount: 1000, iva_amount: 140, gross_amount: 1140 } }] } });
R.check('E-10', 'acrescentar linha a uma factura emitida pela replicação → recusado', !/"applied":true/.test(JSON.stringify(r.body)), JSON.stringify(r.body).slice(0, 200));

// SAF-T: relatório de validação.
const now = new Date(Date.now() + 3600e3);
const v = await ok('GET', `/pos/saft/validate?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`, { token: A });
R.check('E-11', 'SAF-T do mês passa no XSD oficial (SAFTAO1.01_01)', v.xsd?.valid === true, JSON.stringify(v.xsd?.issues?.slice(0, 3)));
R.check('E-12', 'SAF-T do mês sem erros de conteúdo', Array.isArray(v.semantic) && v.semantic.length === 0, JSON.stringify(v.semantic?.slice(0, 3)));
R.check('E-13', 'relatório assinala o que falta configurar (produtor / nº de validação)', Array.isArray(v.configuration), JSON.stringify(v.configuration));

// Emitente com NIF provisório.
await ok('POST', '/onboarding/register-simple', { body: { email: `qa-em2-${tag}@qa.test`, password: pass, planTier: plan } });
const B = tok(await ok('POST', '/auth/login', { body: { email: `qa-em2-${tag}@qa.test`, password: pass } }));
const pub = await db('nexus_public');
const bnif = (await pub.query(`SELECT nif FROM nexus_public.companies WHERE "responsibleEmail" = $1`, [`qa-em2-${tag}@qa.test`])).rows[0]?.nif;
await pub.end();
await call('POST', '/pos/products', { token: B, body: { code, name: 'Sabão', ivaCode: 'NOR', unitPrice: 500, costPrice: 0, stockQty: 100 } });
await call('POST', '/cashbox/session/open', { token: B, body: { openingFloat: 0 } });
r = await call('POST', '/pos/invoices', { token: B, body: { docType: 'FT', paymentType: 'CASH', clientOpId: uuid(), lines: [{ productCode: code, quantity: 1 }] } });
R.check('E-14', 'empresa com NIF provisório (TMP…) não emite documentos fiscais', /^TMP/i.test(bnif ?? '') ? r.status >= 400 : true, `nif=${bnif} → ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);

fs.mkdirSync('qa/out', { recursive: true });
const sum = R.summary();
fs.writeFileSync('qa/out/fiscal-emissao.json', JSON.stringify(sum, null, 1));
console.log(`\n${sum.passed}/${sum.total} passaram; ${sum.failed} falharam`);
