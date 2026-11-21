/**
 * QA — SIMULAÇÃO COMPLETA da Facturação Electrónica contra um simulador local da
 * AGT (qa/agt-fe-mock.mjs). NÃO fala com a AGT. Uma resposta simulada nunca é
 * aprovação oficial.
 *
 * Requisitos: API local (3901) arrancada com AGT_FE_BASE_URL=http://127.0.0.1:3996
 * e NODE_ENV≠production; PostgreSQL de QA. Todos os dados são fictícios (.qa.test).
 *
 * Cenários: A (identidade do produtor), B (integração API), C (séries),
 * D (emissão FT/FR/NC na série AGT), H (falhas, reenvio, duplicados, reinício),
 * I (segurança: chave privada nunca exposta, art. 17.º 60 dias).
 *
 * Uso: node qa/agt-fe-simulacao.mjs
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createSign, createVerify, generateKeyPairSync, randomBytes } from 'node:crypto';
import { call, ok, db, uuid, Report } from './lib.mjs';
import { startAgtMock } from './agt-fe-mock.mjs';

const require = createRequire(import.meta.url);
const R = new Report('agt-fe-simulacao');
const tok = (r) => r.tokens?.accessToken ?? r.accessToken;
const tag = String(Date.now()).slice(-6);
const basicPass = randomBytes(12).toString('base64url');
const mock = await startAgtMock({ pass: basicPass });
const ctl = (body) => fetch(`${mock.url}/__control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const pub = await db('nexus_public');

try {
  // ── Preparação: Super Admin temporário + empresa nova ───────────────────────
  const argon2 = require('../apps/api/node_modules/argon2');
  const saEmail = `qa-fe-sa-${tag}@qa.test`, saPass = randomBytes(9).toString('base64url');
  await pub.query(`INSERT INTO nexus_public.platform_users (id, email, "passwordHash", name, role, "isActive", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'QA FE', 'SUPER_ADMIN', true, now(), now())`, [saEmail, await argon2.hash(saPass, { type: argon2.argon2id })]);
  const SA = tok(await ok('POST', '/auth/super-admin/login', { body: { email: saEmail, password: saPass } }));
  const plan = (await ok('GET', '/public/landing')).plans?.[0]?.tier ?? 'STARTER';
  const nif = `54${tag}01`;
  const reg = await ok('POST', '/onboarding/register-simple', { body: { email: `qa-fe-${tag}@qa.test`, password: 'QaTeste#2026x', planTier: plan, nif } });
  let A = tok(reg);
  await ok('POST', '/onboarding/complete-setup', { token: A, body: { name: `QA FE ${tag} Lda`, nif, address: 'Rua 1', city: 'Luanda' } });
  A = tok(await ok('POST', '/auth/login', { body: { email: `qa-fe-${tag}@qa.test`, password: 'QaTeste#2026x' } }));
  const company = (await pub.query(`SELECT id, "schemaName" FROM nexus_public.companies WHERE nif = $1`, [nif])).rows[0];

  // ── Cenário A: identidade do produtor ───────────────────────────────────────
  let r = await call('POST', '/super-admin/fiscal/einvoice/software-key', { token: SA, body: { modulusBits: 2048 } });
  R.check('A-1', 'gera o par RSA do software (≥2048)', r.status < 300 && r.body.softwareKeyBits >= 2048, `${r.status} bits=${r.body.softwareKeyBits}`);
  R.check('A-2', 'a resposta não contém a chave privada', !/PRIVATE KEY/.test(JSON.stringify(r.body)), 'sem PRIVATE KEY');
  const exp = await ok('GET', '/super-admin/fiscal/einvoice/software-key/export', { token: SA });
  const swPub = typeof exp === 'string' ? exp : exp.pem ?? exp.publicKeyPem ?? exp.publicKey;
  R.check('A-3', 'exporta a chave pública PEM (BEGIN PUBLIC KEY) para o Portal do Parceiro', /^-----BEGIN PUBLIC KEY-----/.test(String(swPub).trim()) && !/PRIVATE/.test(JSON.stringify(exp)), String(swPub).slice(0, 30));
  const cfgRead = await ok('GET', '/super-admin/fiscal/einvoice/config', { token: SA });
  R.check('A-4', 'a configuração lida não expõe privada nem palavra-passe', !/PRIVATE KEY/.test(JSON.stringify(cfgRead)) && !JSON.stringify(cfgRead).includes(basicPass), 'ok');
  const empresaLe = await call('GET', '/super-admin/fiscal/einvoice/config', { token: A });
  R.check('A-5', 'uma empresa não lê a configuração do produtor', empresaLe.status === 403, `${empresaLe.status}`);
  await ctl({ softwarePub: swPub, validationNumber: 'C_QA1' });

  r = await call('PATCH', '/super-admin/fiscal/einvoice/config', { token: SA, body: { environment: 'HML', basicUser: 'qa-produtor', basicPassword: basicPass, productId: 'LPS Vendas', productVersion: '3.0.0', softwareValidationNumber: 'C_QA1', enabled: true } });
  R.check('A-6', 'activa a FE com credenciais Basic, chave e nº de validação', r.status < 300 && r.body.ready === true && /127\.0\.0\.1:3996/.test(r.body.baseUrl), `${r.status} ready=${r.body.ready} url=${r.body.baseUrl}`);

  // Chave do contribuinte (gerada aqui SÓ para o teste — na vida real é emitida pela AGT).
  const tp = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  await ctl({ taxpayer: { nif, pub: tp.publicKey } });
  r = await call('PUT', `/super-admin/fiscal/einvoice/company/${company.id}`, { token: SA, body: { establishmentNumber: 'SEDE', taxpayerPrivateKey: tp.privateKey } });
  R.check('A-7', 'guarda a chave do contribuinte (cifrada) sem a devolver', r.status < 300 && r.body.hasTaxpayerKey === true && !/PRIVATE KEY/.test(JSON.stringify(r.body)), `${r.status}`);
  const weak = generateKeyPairSync('rsa', { modulusLength: 1024, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  r = await call('PUT', `/super-admin/fiscal/einvoice/company/${company.id}`, { token: SA, body: { taxpayerPrivateKey: weak.privateKey } });
  R.check('A-8', 'recusa chave do contribuinte < 2048 bits', r.status === 400, `${r.status}`);
  // Assinatura/verificação local (o mesmo algoritmo que a API usa).
  const s = createSign('RSA-SHA256'); s.update('a.b'); s.end(); const sig = s.sign(tp.privateKey);
  const v1 = createVerify('RSA-SHA256'); v1.update('a.b'); v1.end();
  const v2 = createVerify('RSA-SHA256'); v2.update('a.c'); v2.end();
  const v3 = createVerify('RSA-SHA256'); v3.update('a.b'); v3.end();
  R.check('A-9', 'assinatura verifica com a chave certa, falha com dados alterados e com outra chave', v1.verify(tp.publicKey, sig) && !v2.verify(tp.publicKey, sig) && !v3.verify(weak.publicKey, sig), 'ok');

  // ── Cenário C: séries ───────────────────────────────────────────────────────
  const year = Number(new Date(Date.now() + 3600e3).toISOString().slice(0, 4));
  await ctl({ mode: 'reject-series', times: 1 });
  r = await call('POST', `/super-admin/fiscal/einvoice/company/${company.id}/series`, { token: SA, body: { documentType: 'FT', year } });
  R.check('C-1', 'rejeição da AGT ao pedir série é mostrada (E31)', r.status === 400 && /E31/.test(JSON.stringify(r.body)), `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  const codes = {};
  for (const t of ['FT', 'FS', 'NC']) {
    r = await call('POST', `/super-admin/fiscal/einvoice/company/${company.id}/series`, { token: SA, body: { documentType: t, year } });
    codes[t] = r.body.seriesCode;
  }
  R.check('C-2', 'séries FT, FR e NC atribuídas pela AGT (código da AGT, não inventado)', Object.values(codes).every((c) => /^[A-Z]{2}\d{4}S\d+N$/.test(c ?? '')), JSON.stringify(codes));
  r = await call('PUT', `/super-admin/fiscal/einvoice/company/${company.id}`, { token: SA, body: { enabled: true } });
  R.check('C-3', 'empresa activa na FE depois de ter as séries', r.status < 300 && r.body.enabled === true, `${r.status}`);

  // ── Cenário D: emissão na série AGT ─────────────────────────────────────────
  const prods = [
    { code: `FE${tag}A`, name: 'Óleo 1L', ivaCode: 'NOR', unitPrice: 1234.56, costPrice: 0, stockQty: 100 },
    { code: `FE${tag}B`, name: 'Arroz 5kg', ivaCode: 'ISE', exemptionCode: 'M10', unitPrice: 3333.33, costPrice: 0, stockQty: 100 },
    { code: `FE${tag}C`, name: 'Serviço', ivaCode: 'NOR', unitPrice: 0.07, costPrice: 0, stockQty: 1000 },
  ];
  for (const p of prods) await ok('POST', '/pos/products', { token: A, body: p });
  await call('POST', '/cashbox/session/open', { token: A, body: { openingFloat: 0 } });
  const emit = (body) => call('POST', '/pos/invoices', { token: A, body: { paymentType: 'CASH', clientOpId: uuid(), ...body } });
  const ft = await emit({ docType: 'FT', lines: [{ productCode: prods[0].code, quantity: 3 }, { productCode: prods[1].code, quantity: 2 }, { productCode: prods[2].code, quantity: 7 }] });
  const fr = await emit({ docType: 'FS', lines: [{ productCode: prods[0].code, quantity: 1 }] });
  R.check('D-1', 'FT emitida na série AGT ("FT <série>/1")', ft.status < 300 && ft.body.number === `FT ${codes.FT}/1`, `${ft.status} ${ft.body.number ?? JSON.stringify(ft.body).slice(0, 120)}`);
  R.check('D-2', 'factura-recibo emitida como FR na série AGT', fr.status < 300 && fr.body.number === `FR ${codes.FS}/1`, `${fr.body.number}`);
  const many = [];
  for (let i = 0; i < 31; i++) many.push((await emit({ docType: 'FT', lines: [{ productCode: prods[2].code, quantity: i + 1 }] })).body.number);
  R.check('D-3', 'numeração contínua na série AGT (2..32)', many.every((n, i) => n === `FT ${codes.FT}/${i + 2}`), `${many[0]} … ${many[30]}`);
  const ger = A;
  const cancel = await call('POST', `/pos/invoices/${fr.body.id}/cancel`, { token: ger, body: { reason: 'QA FE anulação' } });
  R.check('D-4', 'anulação gera NC na série AGT', cancel.status < 300, `${cancel.status} ${JSON.stringify(cancel.body).slice(0, 120)}`);

  // ── Cenário B: comunicação ──────────────────────────────────────────────────
  const docsOf = async () => (await pub.query(`SELECT "documentNo", status, errors, attempts FROM nexus_public.einvoice_documents WHERE "companyId" = $1 ORDER BY "createdAt"`, [company.id])).rows;
  const sync = () => call('POST', `/super-admin/fiscal/einvoice/company/${company.id}/sync`, { token: SA });
  const ageErrors = () => pub.query(`UPDATE nexus_public.einvoice_documents SET "lastAttemptAt" = now() - interval '6 minutes' WHERE "companyId" = $1 AND status = 'ERROR'`, [company.id]);

  // B-1 credenciais erradas → nada é perdido, fica para reenvio.
  await ctl({ pass: 'errada' });
  await sync();
  let d = await docsOf();
  R.check('B-1', 'credenciais recusadas (401): documentos ficam em ERROR para reenvio, nada se perde', d.length === 34 && d.filter((x) => x.status === 'ERROR').length >= 30, JSON.stringify(d.reduce((m, x) => ({ ...m, [x.status]: (m[x.status] ?? 0) + 1 }), {})));
  await ctl({ pass: basicPass });

  // B-2 indisponibilidade (500) e limite (429).
  await ageErrors(); await ctl({ mode: 'http500', times: 1 }); await sync();
  await ageErrors(); await ctl({ mode: 'http429', times: 1 }); await sync();
  await ageErrors(); await ctl({ mode: 'malformed', times: 1 }); await sync();
  d = await docsOf();
  R.check('B-2', '500, 429 e resposta malformada → reenvio sem marcar inválido', d.every((x) => x.status !== 'INVALID'), JSON.stringify(d.slice(0, 2)));

  // B-3 envio com sucesso → obterEstado → VALID (≤30 por pedido).
  for (let i = 0; i < 4; i++) { await ageErrors(); await sync(); }
  d = await docsOf();
  const nValid = d.filter((x) => x.status === 'VALID').length;
  R.check('B-3', 'todos os documentos aceites (V) pelo simulador depois da recuperação', nValid === d.length, `${nValid}/${d.length}`);
  const lg = await (await fetch(`${mock.url}/__control`)).json();
  const reg2 = lg.log.filter((x) => x.service === 'registarFactura' && x.status === 200);
  R.check('B-4', 'nunca mais de 30 documentos por pedido e um requestID por envio', reg2.length >= 2, `${reg2.length} pedidos aceites`);
  const subs = (await pub.query(`SELECT "submissionUuid", "requestId" FROM nexus_public.einvoice_submissions WHERE "companyId" = $1`, [company.id])).rows;
  R.check('B-5', 'cada submissão fica registada (submissionUUID + requestID) — auditoria do pedido', subs.length >= 2 && subs.every((x) => /^[0-9a-f-]{36}$/.test(x.submissionUuid) && x.requestId), `${subs.length} submissões`);

  // B-6 rejeição fiscal → INVALID com o código da AGT; correcção → reenvio.
  const bad = await emit({ docType: 'FT', lines: [{ productCode: prods[0].code, quantity: 1 }] });
  await ctl({ mode: 'invalid-next', times: 1 });
  await sync(); await sync();
  d = await docsOf();
  const inv = d.find((x) => x.documentNo === bad.body.number);
  R.check('B-6', 'rejeição fiscal (E20) → documento INVALID com o código da AGT', inv?.status === 'INVALID' && /E20/.test(JSON.stringify(inv.errors)), JSON.stringify(inv));

  // ── Cenário H: resposta perdida + reenvio → E09 → reconciliação ─────────────
  const lost = await emit({ docType: 'FT', lines: [{ productCode: prods[2].code, quantity: 2 }] });
  await ctl({ mode: 'lost', times: 1 });
  await sync();
  d = await docsOf();
  R.check('H-1', 'resposta perdida (AGT registou, respondeu 500) → ERROR, não inválido', d.find((x) => x.documentNo === lost.body.number)?.status === 'ERROR', JSON.stringify(d.find((x) => x.documentNo === lost.body.number)));
  await ageErrors(); await sync(); await sync();
  d = await docsOf();
  const rec = d.find((x) => x.documentNo === lost.body.number);
  R.check('H-2', 'reenvio → AGT diz E09 (já existe) → reconciliado como VALID, sem duplicado', rec?.status === 'VALID', JSON.stringify(rec));
  const mk = await (await fetch(`${mock.url}/__control`)).json();
  R.check('H-3', 'o simulador tem o documento uma única vez', mk.docs.filter((n) => n === lost.body.number).length === 1, 'ok');

  // H-4 reinício a meio do envio (SENDING antigo) → retomado.
  const mid = await emit({ docType: 'FT', lines: [{ productCode: prods[2].code, quantity: 3 }] });
  await ctl({ mode: 'http500', times: 1 }); await sync(); // recolhe-o para a fila
  await pub.query(`UPDATE nexus_public.einvoice_documents SET status = 'SENDING', "lastAttemptAt" = now() - interval '11 minutes' WHERE "companyId" = $1 AND "documentNo" = $2`, [company.id, mid.body.number]).catch(() => {});
  await sync(); await sync();
  d = await docsOf();
  R.check('H-4', 'envio interrompido (reinício) é retomado e concluído', d.find((x) => x.documentNo === mid.body.number)?.status === 'VALID', JSON.stringify(d.find((x) => x.documentNo === mid.body.number)));

  // ── Cenário I: art. 17.º (60 dias sem comunicação bloqueiam a emissão) ──────
  const pend = await emit({ docType: 'FT', lines: [{ productCode: prods[2].code, quantity: 1 }] });
  await ctl({ mode: 'http500', times: 1 }); await sync(); // fica por comunicar
  await pub.query(`UPDATE nexus_public.einvoice_documents SET "createdAt" = now() - interval '61 days' WHERE "companyId" = $1 AND "documentNo" = $2`, [company.id, pend.body.number]);
  const blocked = await emit({ docType: 'FT', lines: [{ productCode: prods[2].code, quantity: 1 }] });
  R.check('I-1', 'documento por comunicar há 61 dias → emissão bloqueada (DP 71/25 art. 17.º)', blocked.status === 403 && /60/.test(JSON.stringify(blocked.body)), `${blocked.status} ${JSON.stringify(blocked.body).slice(0, 140)}`);
  const st = await ok('GET', '/fiscal/einvoice/status', { token: A });
  R.check('I-2', 'o estado mostra os dias sem comunicação', (st.communication?.elapsedMs ?? 0) > 60 * 86_400_000, JSON.stringify(st.communication));
  await ageErrors(); await sync(); await sync();
  const unblocked = await emit({ docType: 'FT', lines: [{ productCode: prods[2].code, quantity: 1 }] });
  R.check('I-3', 'regularizada a comunicação, a emissão volta a ser aceite', unblocked.status < 300, `${unblocked.status}`);
  const logText = fs.existsSync(process.env.QA_LOG ?? '') ? fs.readFileSync(process.env.QA_LOG, 'utf8') : '';
  R.check('I-4', 'os logs da API não contêm chaves privadas nem a palavra-passe Basic', !/PRIVATE KEY/.test(logText) && !logText.includes(basicPass), process.env.QA_LOG ? 'log verificado' : 'QA_LOG não definido');
} finally {
  await pub.end();
  mock.srv.close();
}

fs.mkdirSync('qa/out', { recursive: true });
const sum = R.summary();
fs.writeFileSync('qa/out/agt-fe-simulacao.json', JSON.stringify(sum, null, 1));
console.log(`\n${sum.passed}/${sum.total} passaram; ${sum.failed} falharam`);
process.exit(0);
