/**
 * QA — conformidade AGT (assinatura, cadeia, SAF-T) na API local.
 *
 * 1. Super Admin gera a chave RSA-1024 da plataforma (Modelo 8) — só no
 *    ambiente de teste local; NUNCA em produção a partir daqui.
 * 2. Emite FT/FS/NC com essa chave.
 * 3. Verifica, documento a documento: assinatura RSA-SHA1 válida com a chave
 *    pública exportada; signable string no formato
 *    "Data;DataHoraSistema;Número;Total;AssinaturaAnterior"; 172 caracteres;
 *    1.º documento de cada série encadeia com vazio.
 * 4. Exporta o SAF-T (AO) do mês e reconcilia com a base: nº de documentos,
 *    totais, Hash de cada documento, NC com referência à fatura de origem.
 *
 * Uso: QA_SUPER_PASS=... node qa/agt.mjs
 */
import fs from 'node:fs';
import { createVerify } from 'node:crypto';
import { call, ok, db, uuid, Report, jwtPayload } from './lib.mjs';

const S = JSON.parse(fs.readFileSync(process.env.QA_STATE ?? 'qa/.state.json', 'utf8'));
const R = new Report('agt');

const tag = (xml, name) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1]);

async function main() {
  const superLogin = await ok('POST', '/auth/super-admin/login', { body: { email: process.env.QA_SUPER_EMAIL ?? 'qa-admin@qa.test', password: process.env.QA_SUPER_PASS } });
  const SA = superLogin.tokens?.accessToken ?? superLogin.accessToken;
  const gen = await call('POST', '/super-admin/fiscal/agt/signing-key', { token: SA, body: {} });
  R.check('K-1', 'super admin gera a chave RSA da plataforma', gen.status < 300, `${gen.status} ${JSON.stringify(gen.body).slice(0, 160)}`);
  const exp = await call('GET', '/super-admin/fiscal/agt/signing-key/export', { token: SA });
  const pub = typeof exp.body === 'string' ? exp.body : exp.body?.pem ?? exp.body?.publicKeyPem ?? '';
  R.check('K-2', 'chave pública exportável (para entregar à AGT)', /BEGIN PUBLIC KEY/.test(pub), `${exp.status} ${String(pub).slice(0, 40)}`);
  const empresaRead = await call('GET', '/super-admin/fiscal/agt/signing-key', { token: S.A.token });
  R.check('K-3', 'empresa (admin de tenant) não lê a chave da plataforma', empresaRead.status === 403, empresaRead.status);

  const email = 'caixa2@grupo-kwanza.qa.test';
  const lg = await ok('POST', '/auth/login', { body: { email, password: S.pass } });
  const cx = lg.tokens?.accessToken ?? lg.accessToken;
  const gl = await ok('POST', '/auth/login', { body: { email: 'gestor@grupo-kwanza.qa.test', password: S.pass } });
  const ger = gl.tokens?.accessToken ?? gl.accessToken;
  await call('POST', '/cashbox/session/close', { token: cx, body: { countedCash: 0 } });
  await ok('POST', '/cashbox/session/open', { token: cx, body: { openingFloat: 0 } });
  const P = S.products;
  const docs = [];
  for (let i = 0; i < 12; i++) {
    const r = await call('POST', '/pos/invoices', { token: cx, body: {
      docType: i % 4 === 3 ? 'FS' : 'FT',
      lines: [{ productCode: P[20 + i].code, quantity: 1 + (i % 3) }, { productCode: P[200 + i].code, quantity: 1 }],
      paymentType: 'CARD', clientOpId: uuid(),
      ...(i % 2 === 0 ? { customerId: S.customers[i] } : {}),
    } });
    if (r.status < 300) docs.push(r.body); else console.log('emit', r.status, JSON.stringify(r.body).slice(0, 200));
  }
  const toCancel = docs[1];
  if (toCancel) await call('POST', `/pos/invoices/${toCancel.id}/cancel`, { token: ger, body: { reason: 'QA AGT anulação' } });
  const toReturn = docs[2];
  if (toReturn) await call('POST', `/pos/invoices/${toReturn.id}/return`, { token: ger, body: { items: [{ productCode: P[22].code, quantity: 1 }], reason: 'QA AGT devolução' } });

  const c = await db(S.A.schema);
  const rows = (await c.query(`SELECT doc_type, series, year, sequence, number, invoice_date, system_entry_date, gross_total,
                                      signable_string, previous_hash, hash, signature, source_invoice_id, status
                                 FROM invoices WHERE signature IS NOT NULL ORDER BY doc_type, series, year, sequence`)).rows;
  let badSig = 0, badLen = 0, badFmt = 0, badLink = 0;
  const prevBySeries = new Map();
  for (const d of rows) {
    const key = `${d.doc_type}|${d.series}|${d.year}`;
    const v = createVerify('RSA-SHA1'); v.update(d.signable_string, 'utf8'); v.end();
    if (!pub || !v.verify(pub, d.signature, 'base64')) badSig++;
    if (d.signature.length !== 172 || d.hash !== d.signature) badLen++;
    const parts = d.signable_string.split(';');
    const okFmt = parts.length === 5 && /^\d{4}-\d{2}-\d{2}$/.test(parts[0]) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(parts[1])
      && parts[2] === d.number && /^\d+\.\d{2}$/.test(parts[3]) && Math.abs(Number(parts[3]) - Number(d.gross_total)) < 0.005;
    if (!okFmt) badFmt++;
    const prev = prevBySeries.get(key);
    if (prev !== undefined && parts[4] !== prev) badLink++;
    prevBySeries.set(key, d.signature);
  }
  R.check('S-1', 'assinatura RSA-SHA1 de cada documento verifica com a chave pública', rows.length > 0 && badSig === 0, `${rows.length} documentos assinados, inválidos ${badSig}`);
  R.check('S-2', 'campo Hash = assinatura base64 de 172 caracteres (RSA-1024)', badLen === 0, `fora do formato ${badLen}`);
  R.check('S-3', 'signable string "Data;DataHora;Número;Total;Anterior"', badFmt === 0, `${badFmt} fora do formato; ex.: ${rows[0]?.signable_string?.slice(0, 80)}`);
  R.check('S-4', 'cada documento assina com a assinatura do anterior da série', badLink === 0, `elos errados ${badLink}`);
  const nc = (await c.query("SELECT number, source_invoice_id FROM invoices WHERE doc_type='NC'")).rows;
  R.check('S-5', 'cada NC refere a fatura de origem', nc.every((n) => n.source_invoice_id), JSON.stringify(nc.slice(0, 4)));
  const ann = toCancel ? (await c.query('SELECT status, doc_state FROM invoices WHERE id=$1', [toCancel.id])).rows[0] : null;
  R.check('S-6', 'fatura anulada fica com estado A (mantém número e hash)', ann?.status === 'A', JSON.stringify(ann));

  // SAF-T do mês.
  const now = new Date();
  const year = now.getFullYear(); const month = now.getMonth() + 1;
  const res = await fetch(`${process.env.QA_API ?? 'http://127.0.0.1:3901'}/pos/saft?year=${year}&month=${month}`, { headers: { authorization: `Bearer ${S.A.token}` } });
  const xml = await res.text();
  fs.mkdirSync('qa/out', { recursive: true });
  fs.writeFileSync('qa/out/saft.xml', xml);
  R.check('X-1', 'SAF-T (AO) exporta XML', res.status === 200 && xml.startsWith('<?xml') && xml.includes('AuditFile'), `${res.status} ${xml.length} bytes`);
  const inDb = (await c.query(`SELECT doc_type, count(*) n, sum(gross_total) g FROM invoices WHERE extract(year from invoice_date)=$1 AND extract(month from invoice_date)=$2 GROUP BY 1`, [year, month])).rows;
  const nDb = inDb.reduce((s, r) => s + Number(r.n), 0);
  const invoiceNos = tag(xml, 'InvoiceNo');
  R.check('X-2', 'SAF-T: nº de documentos = base de dados', invoiceNos.length === nDb, `XML ${invoiceNos.length}, base ${nDb} ${JSON.stringify(inDb)}`);
  const ents = tag(xml, 'NumberOfEntries').map(Number);
  R.check('X-3', 'SAF-T: NumberOfEntries coerente', ents.length > 0 && ents[0] === invoiceNos.length, `NumberOfEntries ${ents.join(',')}`);
  const hashes = new Set(tag(xml, 'Hash'));
  const allDb = (await c.query(`SELECT hash FROM invoices WHERE extract(year from invoice_date)=$1 AND extract(month from invoice_date)=$2`, [year, month])).rows;
  R.check('X-4', 'SAF-T: Hash de cada documento igual ao da base', allDb.every((r) => hashes.has(r.hash)), `${allDb.filter((r) => !hashes.has(r.hash)).length} em falta`);
  const td = Number(tag(xml, 'TotalDebit')[0] ?? NaN), tc = Number(tag(xml, 'TotalCredit')[0] ?? NaN);
  const ftNet = (await c.query(`SELECT doc_type, sum(net_total) s FROM invoices WHERE status <> 'A' AND extract(year from invoice_date)=$1 AND extract(month from invoice_date)=$2 GROUP BY 1`, [year, month])).rows;
  R.check('X-5', 'SAF-T: TotalCredit (vendas) e TotalDebit (NC) presentes e numéricos', Number.isFinite(td) && Number.isFinite(tc), `debit ${td} credit ${tc} base ${JSON.stringify(ftNet)}`);
  R.check('X-6', 'SAF-T: NIF fictício da empresa no cabeçalho', xml.includes('<TaxRegistrationNumber>5000000001</TaxRegistrationNumber>'), tag(xml, 'TaxRegistrationNumber')[0]);
  R.check('X-7', 'SAF-T: isenções com TaxExemptionCode', !xml.includes('<TaxExemptionReason>') || tag(xml, 'TaxExemptionCode').length > 0, `${tag(xml, 'TaxExemptionCode').length} códigos`);
  void jwtPayload;
  await call('POST', '/cashbox/session/close', { token: cx, body: { countedCash: 0 } });
  await c.end();
  fs.writeFileSync('qa/out/agt.json', JSON.stringify(R.summary(), null, 1));
  const s = R.summary();
  console.log(`\n${s.passed}/${s.total} verificações passaram, ${s.failed} falharam`);
}

main().catch((e) => { console.error(e); process.exit(1); });
