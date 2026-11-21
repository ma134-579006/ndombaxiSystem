/**
 * QA — MOTOR FISCAL EXTERNO (Cegid Vendus) contra o SIMULADOR LOCAL (qa/vendus-mock.mjs).
 * Testes 1–20 da missão + NC, SAF-T, landing e isolamento da chave. Só localhost.
 * Nada aqui é uma emissão real nem uma aceitação da AGT.
 *
 * A API tem de estar a correr com VENDUS_BASE_URL=http://127.0.0.1:3997/ws,
 * VENDUS_TIMEOUT_MS=3000 e FISCAL_ENGINE_SCHEDULER=off.
 *
 * Uso: node qa/vendus-motor.mjs
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { call, ok, db, uuid, Report } from './lib.mjs';
import { startVendusMock } from './vendus-mock.mjs';

const require = createRequire(import.meta.url);
const R = new Report('vendus-motor');
const tok = (r) => r.tokens?.accessToken ?? r.accessToken;
const tag = String(Date.now()).slice(-6);
const apiKey = `qa-vendus-${randomBytes(18).toString('base64url')}`;
const mock = await startVendusMock({ apiKey });
const ctl = (body) => fetch('http://127.0.0.1:3997/__control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const mstate = async () => (await fetch('http://127.0.0.1:3997/__control')).json();
const pub = await db('nexus_public');
const j = (x) => JSON.stringify(x).slice(0, 220);

try {
  // ── Preparação ──────────────────────────────────────────────────────────────
  const argon2 = require('../apps/api/node_modules/argon2');
  const saEmail = `qa-vd-sa-${tag}@qa.test`, saPass = randomBytes(9).toString('base64url');
  await pub.query(`INSERT INTO nexus_public.platform_users (id, email, "passwordHash", name, role, "isActive", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'QA Vendus', 'SUPER_ADMIN', true, now(), now())`, [saEmail, await argon2.hash(saPass, { type: argon2.argon2id })]);
  const SA = tok(await ok('POST', '/auth/super-admin/login', { body: { email: saEmail, password: saPass } }));
  // Estado global limpo para este cenário (só na BD de QA).
  await pub.query(`DELETE FROM nexus_public.fiscal_engine_settings`);
  await pub.query(`DELETE FROM nexus_public.fiscal_engine_companies`);
  const plan = (await ok('GET', '/public/landing')).plans?.[0]?.tier ?? 'STARTER';
  const nif = `54${tag}07`;
  const email = `qa-vd-${tag}@qa.test`;
  await ok('POST', '/onboarding/register-simple', { body: { email, password: 'QaTeste#2026x', planTier: plan, nif } });
  let A = tok(await ok('POST', '/auth/login', { body: { email, password: 'QaTeste#2026x' } }));
  await ok('POST', '/onboarding/complete-setup', { token: A, body: { name: `QA Vendus ${tag} Lda`, nif, address: 'Rua 1', city: 'Luanda' } });
  A = tok(await ok('POST', '/auth/login', { body: { email, password: 'QaTeste#2026x' } }));
  const company = (await pub.query(`SELECT id, "schemaName" FROM nexus_public.companies WHERE "responsibleEmail" = $1`, [email])).rows[0];
  const cid = company.id;
  const code = `VD${tag}`;
  await ok('POST', '/pos/products', { token: A, body: { code, name: 'Sabão', ivaCode: 'NOR', unitPrice: 500, costPrice: 0, stockQty: 100 } });
  const cust = await ok('POST', '/pos/customers', { token: A, body: { name: 'Cliente Vendus Lda', taxId: '5417000999' } });
  await call('POST', '/cashbox/session/open', { token: A, body: { openingFloat: 0 } });
  const sell = (extra = {}) => call('POST', '/pos/invoices', { token: A, body: { docType: 'FT', paymentType: 'CASH', clientOpId: uuid(), customerId: cust.id, lines: [{ productCode: code, quantity: 2 }], ...extra } });
  const countInvoices = async () => Number((await pub.query(`SELECT COUNT(*)::int AS n FROM "${company.schemaName}".invoices`)).rows[0].n);

  // ── Teste 1 — Super Admin vê a nova opção ──────────────────────────────────
  let ov = await ok('GET', '/super-admin/fiscal-engine', { token: SA });
  let row = ov.companies.find((c) => c.id === cid);
  R.check('V-01', 'Super Admin → motor fiscal lista a empresa (sem ligação, motor LPS legado)', ov.settings.vendusEnabled === false && row?.indicator === 'NAO_CONFIGURADA' && row.effective.legacy === true, j(row));

  // ── Teste 2 — guardar configuração; switch exige validade confirmada ───────
  let r = await call('PATCH', '/super-admin/fiscal-engine/settings', { token: SA, body: { vendusEnabled: true } });
  R.check('V-02a', 'ligar o switch sem validade do fornecedor confirmada → recusado', r.status === 409, `${r.status} ${j(r.body)}`);
  r = await call('PATCH', '/super-admin/fiscal-engine/settings', { token: SA, body: { vendusApiVersion: '9.9' } });
  R.check('V-02b', 'versão da API não publicada → recusada', r.status === 400, `${r.status}`);
  r = await call('PATCH', '/super-admin/fiscal-engine/settings', { token: SA, body: { vendusBaseUrl: 'https://evil.example/ws' } });
  R.check('V-02c', 'URL da API fora de vendus.co.ao → recusado', r.status === 400, `${r.status}`);
  const pdf = Buffer.from('%PDF-1.4\n% Lista de programas validados (evidencia de teste QA)\n%%EOF\n').toString('base64');
  const ev = await ok('POST', '/super-admin/fiscal-engine/evidence', { token: SA, body: { kind: 'PROVIDER_VALIDITY', filename: 'lista-agt.pdf', contentType: 'application/pdf', base64: pdf } });
  r = await call('POST', '/super-admin/fiscal-engine/evidence', { token: SA, body: { kind: 'PROVIDER_VALIDITY', filename: 'x.pdf', contentType: 'application/pdf', base64: Buffer.from('<html>').toString('base64') } });
  R.check('V-02d', 'evidência que não é PDF → recusada', r.status === 400, `${r.status}`);
  const future = new Date(Date.now() + 200 * 86400e3).toISOString().slice(0, 10);
  ov = await ok('PATCH', '/super-admin/fiscal-engine/settings', { token: SA, body: { providerProducer: 'PRIMAVERA- BUSINESS SOFTWARE SOLUTIONS, LDA', providerSoftware: 'Vendus', providerValidationNo: '142/AGT/2019', providerFeCertNo: 'FE/105/AGT/2025', providerVersion: '1', providerValidUntil: future, providerEvidenceId: ev.id, providerVerifiedBy: 'QA' } });
  R.check('V-02e', 'validade do fornecedor com evidência → CONFIRMADO', ov.validity.status === 'CONFIRMADO', j(ov.validity));
  ov = await ok('PATCH', '/super-admin/fiscal-engine/settings', { token: SA, body: { vendusEnabled: true } });
  R.check('V-02f', 'switch "Usar motor fiscal externo — Cegid Vendus" liga', ov.settings.vendusEnabled === true, '');
  r = await call('POST', `/super-admin/fiscal-engine/company/${cid}/activate`, { token: SA });
  R.check('V-02g', 'activar a empresa só pelo switch (sem ligação) → recusado', r.status === 409, `${r.status} ${j(r.body)}`);

  // ── Teste 3 — API KEY de testes (cifrada, nunca devolvida) ─────────────────
  let det = await ok('PUT', `/super-admin/fiscal-engine/company/${cid}/api-key`, { token: SA, body: { apiKey: 'chave-errada-0000000000' } });
  const stored = (await pub.query(`SELECT "apiKeyEnc" FROM nexus_public.fiscal_engine_companies WHERE "companyId" = $1`, [cid])).rows[0].apiKeyEnc;
  R.check('V-03', 'API KEY guardada cifrada (v1:…), resposta só com máscara', /^v1:/.test(stored) && !stored.includes('chave-errada') && !JSON.stringify(det).includes('chave-errada') && det.link.apiKeyMask.endsWith('0000'), det.link.apiKeyMask);

  // ── Teste 4 — autenticação ─────────────────────────────────────────────────
  det = await ok('POST', `/super-admin/fiscal-engine/company/${cid}/test`, { token: SA });
  R.check('V-04', 'chave errada → CHAVE_INVALIDA / credenciais inválidas', det.test.code === 'CHAVE_INVALIDA' && det.indicator === 'CREDENCIAIS_INVALIDAS', j(det.test));

  // ── Teste 5/6 — conta, NIF e país ──────────────────────────────────────────
  await ok('PUT', `/super-admin/fiscal-engine/company/${cid}/api-key`, { token: SA, body: { apiKey } });
  await ctl({ account: { fiscal_id: '5000000001', country: 'AO' } });
  det = await ok('POST', `/super-admin/fiscal-engine/company/${cid}/test`, { token: SA });
  R.check('V-05', 'conta Vendus de OUTRO contribuinte → NIF_DIFERENTE (não usável)', det.test.code === 'NIF_DIFERENTE' && !det.canActivate, j(det.test));
  await ctl({ account: { fiscal_id: nif, country: 'PT' } });
  det = await ok('POST', `/super-admin/fiscal-engine/company/${cid}/test`, { token: SA });
  R.check('V-06a', 'conta de outro país (PT) → PAIS_DIFERENTE', det.test.code === 'PAIS_DIFERENTE', j(det.test));
  await ctl({ account: { fiscal_id: nif, country: 'AO', company: `QA Vendus ${tag} Lda` } });
  det = await ok('POST', `/super-admin/fiscal-engine/company/${cid}/test`, { token: SA });
  R.check('V-06b', 'conta identificada: mesmo NIF e Angola', det.test.ok && det.link.accountFiscalId === nif && det.link.accountCountry === 'AO', j(det.link));
  // NIF do contribuinte definido no Super Admin (a ficha da empresa no LPS tem outro NIF).
  await ctl({ account: { fiscal_id: '5417000555' } });
  await ok('PATCH', `/super-admin/fiscal-engine/company/${cid}`, { token: SA, body: { taxpayerNif: '5417000555' } });
  let dn = await ok('POST', `/super-admin/fiscal-engine/company/${cid}/test`, { token: SA });
  R.check('V-06d', 'NIF do contribuinte no Super Admin → conta desse NIF aceite', dn.test.ok && dn.company.nif === '5417000555', j(dn.test));
  let bad = await call('PATCH', `/super-admin/fiscal-engine/company/${cid}`, { token: SA, body: { taxpayerNif: '12AB' } });
  R.check('V-06e', 'NIF do contribuinte inválido → recusado', bad.status === 400, `${bad.status}`);
  await ok('PATCH', `/super-admin/fiscal-engine/company/${cid}`, { token: SA, body: { taxpayerNif: '' } });
  await ctl({ account: { fiscal_id: nif } });
  dn = await ok('POST', `/super-admin/fiscal-engine/company/${cid}/test`, { token: SA });
  R.check('V-06f', 'NIF vazio → volta a usar o NIF da empresa', dn.test.ok && dn.company.nif === nif, j(dn.test));
  R.check('V-06c', 'impostos: só os de Angola com a mesma taxa (o NOR 23% PT é ignorado)', det.link.taxMap.NOR === 'NOR' && det.catalog.taxes.length === 3, j(det.link.taxMap));

  // ── Teste 7/8 — lojas e caixas; caixa API com subscrição ───────────────────
  R.check('V-07', 'lista caixas e lojas da conta', det.catalog.registers.length === 1 && det.catalog.stores.length === 1, j(det.catalog.registers));
  await ok('PATCH', `/super-admin/fiscal-engine/company/${cid}`, { token: SA, body: { registerId: '9', paymentMap: { CASH: '3' } } });
  await ctl({ mode: 'subscription-off', times: 1 });
  det = await ok('POST', `/super-admin/fiscal-engine/company/${cid}/test`, { token: SA });
  R.check('V-08a', 'caixa sem subscrição activa → SUBSCRICAO_INACTIVA', det.test.code === 'SUBSCRICAO_INACTIVA' && det.indicator === 'SUBSCRICAO_INACTIVA', j(det.test));
  det = await ok('POST', `/super-admin/fiscal-engine/company/${cid}/test`, { token: SA });
  // Caixa unificada: a escolhida é POS → o LPS usa a caixa API da conta para todas as caixas.
  await ctl({ addRegister: { id: 11, store_id: 1, title: 'Caixa Loja', type: 'pos', status: 'on', mode: 'normal', subscription_active: 'yes' } });
  await ok('PATCH', `/super-admin/fiscal-engine/company/${cid}`, { token: SA, body: { registerId: '11' } });
  let dp = await ok('POST', `/super-admin/fiscal-engine/company/${cid}/test`, { token: SA });
  R.check('V-08c', 'caixa POS escolhida → o LPS passa a usar a caixa API da conta (unificada)', dp.test.ok && dp.link.registerId === '9' && dp.link.registerType === 'api', j({ test: dp.test, reg: dp.link.registerId }));
  await ctl({ register: { type: 'pos' } });
  dp = await ok('POST', `/super-admin/fiscal-engine/company/${cid}/test`, { token: SA });
  R.check('V-08d', 'conta sem nenhuma caixa API → CAIXA_NAO_API com a indicação do que criar', dp.test.code === 'CAIXA_NAO_API' && dp.indicator === 'CAIXA_NAO_API', j(dp.test));
  await ctl({ register: { type: 'api' } });
  det = await ok('POST', `/super-admin/fiscal-engine/company/${cid}/test`, { token: SA });
  R.check('V-08b', 'caixa do tipo API com subscrição activa', det.test.ok && det.link.registerType === 'api' && det.link.registerSubscription === 'yes', j(det.link));

  // ── Teste 9/10/11 — sincronização sem duplicados ───────────────────────────
  let sy = await ok('POST', '/fiscal-engine/sync/clients', { token: A });
  let sy2 = await ok('POST', '/fiscal-engine/sync/clients', { token: A });
  let ms = await mstate();
  R.check('V-09', 'consulta e sincroniza clientes (1.ª cria, 2.ª actualiza, sem duplicar)', sy.created === 1 && sy2.updated === 1 && sy2.created === 0 && ms.clients === 1, `${j(sy)} ${j(sy2)}`);
  await pub.query(`DELETE FROM "${company.schemaName}".fiscal_engine_links WHERE entity = 'client'`);
  sy = await ok('POST', '/fiscal-engine/sync/clients', { token: A });
  ms = await mstate();
  R.check('V-10', 'cliente já existente no Vendus (vínculo perdido) → liga-se, não duplica', sy.linked === 1 && sy.created === 0 && ms.clients === 1, j(sy));
  sy = await ok('POST', '/fiscal-engine/sync/products', { token: A });
  sy2 = await ok('POST', '/fiscal-engine/sync/products', { token: A });
  ms = await mstate();
  R.check('V-11', 'sincroniza produtos (referência, preço com IVA, imposto AO) sem duplicar', sy.created >= 1 && sy2.created === 0 && ms.products === sy.created, `${j(sy)} ${j(sy2)}`);

  // ── Ligação partilhada entre empresas do MESMO contribuinte ─────────────────
  {
    const email2 = `qa-vd2-${tag}@qa.test`;
    await ok('POST', '/onboarding/register-simple', { body: { email: email2, password: 'QaTeste#2026x', planTier: plan, nif: `54${tag}08` } });
    const cid2 = (await pub.query(`SELECT id FROM nexus_public.companies WHERE "responsibleEmail" = $1`, [email2])).rows[0].id;
    let cp = await call('POST', `/super-admin/fiscal-engine/company/${cid2}/copy-from`, { token: SA, body: { sourceCompanyId: cid } });
    R.check('V-SH1', 'copiar a ligação para uma empresa de OUTRO NIF → recusado', cp.status === 409 && /mesmo contribuinte/.test(j(cp.body)), `${cp.status}`);
    await ok('PATCH', `/super-admin/fiscal-engine/company/${cid2}`, { token: SA, body: { taxpayerNif: nif } });
    cp = await call('POST', `/super-admin/fiscal-engine/company/${cid2}/copy-from`, { token: SA, body: { sourceCompanyId: cid } });
    const t2 = await ok('POST', `/super-admin/fiscal-engine/company/${cid2}/test`, { token: SA });
    R.check('V-SH2', 'mesmo NIF do contribuinte → ligação copiada (chave cifrada, nunca reescrita) e testada', cp.status < 300 && t2.test.ok && t2.link.apiKeyMask === det.link.apiKeyMask, j(t2.test));
  }

  // ── Teste 12/13/14 — documento em modo testes, consulta e PDF ──────────────
  let t = await ok('POST', `/super-admin/fiscal-engine/company/${cid}/tests`, { token: SA });
  ms = await mstate();
  R.check('V-12', 'cria documento em modo Formação/Testes (mode=tests)', t.ok && ms.docs.some((d) => d.mode === 'tests'), j(t.document));
  R.check('V-13', 'documento de testes consultado: estado CRIADO_NO_VENDUS (nunca "aceite AGT")', t.document.state === 'CRIADO_NO_VENDUS', t.document.state);
  R.check('V-14', 'PDF do documento de testes obtido', t.document.pdf === true, '');

  // Activação: falta a confirmação da FE no Backoffice Vendus.
  r = await call('POST', `/super-admin/fiscal-engine/company/${cid}/activate`, { token: SA });
  R.check('V-14b', 'activar sem confirmar a FE do Vendus → recusado (a chave válida não chega)', r.status === 409 && /fe_vendus/.test(j(r.body)), `${r.status} ${j(r.body)}`);
  await ok('PATCH', `/super-admin/fiscal-engine/company/${cid}`, { token: SA, body: { feConfirmed: true } });
  det = await ok('POST', `/super-admin/fiscal-engine/company/${cid}/activate`, { token: SA });
  R.check('V-14c', 'todas as verificações → motor fiscal activo', det.indicator === 'MOTOR_ACTIVO' && det.effective.engine === 'VENDUS', det.indicator);

  // ── Emissão via POS ────────────────────────────────────────────────────────
  r = await sell();
  const inv1 = r.body;
  const lpsRow = (await pub.query(`SELECT series, fiscal_engine, signature FROM "${company.schemaName}".invoices WHERE id = $1`, [inv1.id])).rows[0];
  R.check('V-E1', 'venda emitida pelo Vendus: número fiscal do Vendus devolvido ao caixa', r.status < 300 && /^FR AO/.test(inv1.fiscal?.number ?? ''), j(inv1.fiscal));
  R.check('V-E2', 'no LPS fica o registo comercial (série interna VND, sem assinatura fiscal do LPS)', lpsRow.series === 'VND' && lpsRow.fiscal_engine === 'VENDUS' && !lpsRow.signature, j(lpsRow));
  R.check('V-E3', 'estado AGT: COMUNICACAO_AGT_PENDENTE (HTTP 201/PDF/hash não são aceitação)', inv1.fiscal.state === 'COMUNICACAO_AGT_PENDENTE', inv1.fiscal.state);
  const docs = await ok('GET', '/fiscal-engine/documents', { token: A });
  const d1 = docs.find((d) => d.invoice_id === inv1.id);
  const pdfRes = await fetch(`http://127.0.0.1:3901/fiscal-engine/documents/${d1.id}/pdf`, { headers: { authorization: `Bearer ${A}` } });
  const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());
  R.check('V-E4', 'PDF ORIGINAL do Vendus conservado e descarregável sem alterações', pdfRes.status === 200 && pdfBytes.toString('latin1').includes(`Documento ${inv1.fiscal.number}`), `${pdfRes.status} ${pdfBytes.length}B`);
  const det1 = await ok('GET', `/fiscal-engine/documents/${d1.id}`, { token: A });
  R.check('V-E5', 'trilho do documento (A_PREPARAR → A_ENVIAR → CRIADO → pendente AGT)', det1.events.map((e) => e.state).join('>').includes('A_PREPARAR>A_ENVIAR>CRIADO_NO_VENDUS>COMUNICACAO_AGT_PENDENTE') && det1.tx_id === `lps-${inv1.id}-FT`, det1.events.map((e) => e.state).join('>'));

  // ── Teste 15 — duplicação / tx_id ──────────────────────────────────────────
  const opId = uuid();
  const a1 = await sell({ clientOpId: opId });
  const a2 = await sell({ clientOpId: opId });
  ms = await mstate();
  const sameRef = ms.docs.filter((d) => d.external_reference === `LPS-${a1.body.id}`).length;
  r = await call('POST', `/fiscal-engine/documents/${d1.id}/retry`, { token: A });
  R.check('V-15a', 'reenvio da mesma venda (clientOpId) → um só documento no Vendus', a2.body.id === a1.body.id && sameRef === 1, `${sameRef}`);
  R.check('V-15b', 'documento já emitido não pode ser reenviado', r.status === 409, `${r.status}`);

  // ── Teste 16 — timeout e resposta perdida: reconcilia, nunca duplica ───────
  await ctl({ mode: 'lost', times: 1 });
  const lost = await sell();
  R.check('V-16a', 'Vendus cria mas a resposta perde-se → ESTADO_DESCONHECIDO (não "falhou")', lost.body.fiscal?.state === 'ESTADO_DESCONHECIDO', j(lost.body.fiscal));
  const lostDoc = (await ok('GET', '/fiscal-engine/documents', { token: A })).find((d) => d.invoice_id === lost.body.id);
  const rec = await ok('POST', `/fiscal-engine/documents/${lostDoc.id}/retry`, { token: A });
  ms = await mstate();
  R.check('V-16b', 'reconciliação por external_reference encontra o documento — sem segundo POST', rec.state === 'COMUNICACAO_AGT_PENDENTE' && ms.docs.filter((d) => d.external_reference === `LPS-${lost.body.id}`).length === 1, `${rec.state}`);
  await ctl({ mode: 'slow', times: 1, delayMs: 5000 });
  const slow = await sell();
  R.check('V-16c', 'timeout do cliente (3 s) com o Vendus a processar → ESTADO_DESCONHECIDO', slow.body.fiscal?.state === 'ESTADO_DESCONHECIDO', j(slow.body.fiscal));
  await new Promise((res) => setTimeout(res, 2500));
  const slowDoc = (await ok('GET', '/fiscal-engine/documents', { token: A })).find((d) => d.invoice_id === slow.body.id);
  const rec2 = await ok('POST', `/fiscal-engine/documents/${slowDoc.id}/retry`, { token: A });
  ms = await mstate();
  const posts = ms.log.filter((l) => l.method === 'POST' && l.path.endsWith('/documents/')).length;
  R.check('V-16d', 'depois do timeout: adoptado o documento existente, 1 só documento para a venda', rec2.state === 'COMUNICACAO_AGT_PENDENTE' && ms.docs.filter((d) => d.external_reference === `LPS-${slow.body.id}`).length === 1, `${rec2.state} POSTs=${posts}`);

  // ── Teste 17 — rejeição simulada ───────────────────────────────────────────
  await ctl({ mode: 'reject', times: 1 });
  const rej = await sell();
  R.check('V-17', 'recusa do Vendus (422) → CORRECCAO_NECESSARIA com motivo; venda não apagada', rej.body.fiscal?.state === 'CORRECCAO_NECESSARIA' && /inválidos/.test(rej.body.fiscal?.error ?? ''), j(rej.body.fiscal));

  // ── NC: anulação e devolução emitidas pelo Vendus ──────────────────────────
  const ncAll = await call('POST', `/pos/invoices/${inv1.id}/cancel`, { token: A, body: { reason: 'Cliente desistiu da compra' } });
  ms = await mstate();
  const ncDoc = ms.docs.find((d) => d.type === 'NC');
  R.check('V-NC1', 'anulação → NC no Vendus com referência ao documento original', ncAll.status < 300 && /^NC AO/.test(ncAll.body.fiscal?.number ?? '') && !!ncDoc, `${ncAll.status} ${j(ncAll.body.fiscal)}`);
  const ncPart = await call('POST', `/pos/invoices/${a1.body.id}/return`, { token: A, body: { reason: 'Devolução de 1 unidade', items: [{ productCode: code, quantity: 1 }], clientOpId: uuid() } });
  R.check('V-NC2', 'devolução parcial → NC no Vendus só da linha devolvida', ncPart.status < 300 && /^NC AO/.test(ncPart.body.fiscal?.number ?? ''), `${ncPart.status} ${j(ncPart.body.fiscal)}`);
  const pend = await call('POST', `/pos/invoices/${rej.body.id}/cancel`, { token: A, body: { reason: 'Anular documento recusado' } });
  R.check('V-NC3', 'anular venda cujo documento Vendus não existe → recusado (sem NC local)', pend.status === 409, `${pend.status} ${j(pend.body)}`);

  // ── SAF-T (AO) do Vendus ───────────────────────────────────────────────────
  const now = new Date();
  const sf = await ok('POST', '/fiscal-engine/saft', { token: A, body: { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 } });
  const hist = await ok('GET', '/fiscal-engine/saft', { token: A });
  R.check('V-SAFT', 'SAF-T do Vendus descodificado, validado no XSD AO e arquivado (incompleto → inválido)', sf.header.namespace === 'urn:OECD:StandardAuditFile-Tax:AO_1.01_01' && sf.valid === false && sf.issues.length > 0 && hist.length === 1, `${sf.valid} ${sf.issues.length} problemas`);
  const lpsSaft = await call('GET', `/pos/saft/validate?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`, { token: A });
  R.check('V-SAFT2', 'SAF-T do LPS não inclui os documentos emitidos pelo Vendus', lpsSaft.status < 300 && Number(lpsSaft.body.documents ?? lpsSaft.body.period?.documents ?? 0) === 0, j({ documents: lpsSaft.body.documents }));

  // ── Landing ────────────────────────────────────────────────────────────────
  let land = await ok('GET', '/public/landing');
  R.check('V-LAND1', 'landing identifica o Cegid Vendus (produtor e nº do registo) quando activo', land.fiscalEngine?.name === 'Cegid Vendus' && land.fiscalEngine.producer.startsWith('PRIMAVERA') && land.agtCertificate === null, j(land.fiscalEngine));

  // ── Teste 18 — credenciais revogadas → suspensão ───────────────────────────
  await ctl({ apiKey: `revogada-${randomBytes(8).toString('hex')}` });
  det = await ok('POST', `/super-admin/fiscal-engine/company/${cid}/health`, { token: SA });
  const before18 = await countInvoices();
  r = await sell();
  R.check('V-18', 'chave revogada → motor suspenso, venda recusada (503), sem fallback para o LPS', det.effective.engine === 'SUSPENSO' && r.status === 503 && (await countInvoices()) === before18, `${det.effective.reason} | ${r.status}`);
  await ctl({ apiKey });
  det = await ok('POST', `/super-admin/fiscal-engine/company/${cid}/test`, { token: SA });
  r = await sell();
  R.check('V-18b', 'chave reposta e ligação testada → volta a emitir pelo Vendus', det.effective.engine === 'VENDUS' && r.status < 300 && !!r.body.fiscal?.number, j(det.effective));

  // ── Teste 19 — validade expirada ───────────────────────────────────────────
  await pub.query(`UPDATE nexus_public.fiscal_engine_settings SET "providerValidUntil" = (now() - interval '3 days')::date`);
  const before19 = await countInvoices();
  r = await sell();
  R.check('V-19a', 'validação AGT do fornecedor expirada → emissão bloqueada (503)', r.status === 503 && /expirada/.test(j(r.body)) && (await countInvoices()) === before19, `${r.status} ${j(r.body)}`);
  await ok('PATCH', '/super-admin/fiscal-engine/settings', { token: SA, body: { vendusEnabled: false } });
  r = await call('PATCH', '/super-admin/fiscal-engine/settings', { token: SA, body: { vendusEnabled: true } });
  R.check('V-19b', 'desligar e voltar a ligar o switch não contorna o bloqueio', r.status === 409, `${r.status}`);
  r = await call('PATCH', '/super-admin/fiscal-engine/settings', { token: SA, body: { providerValidUntil: future, providerVerifiedBy: 'QA' } });
  R.check('V-19c', 'nova validade sem nova evidência → recusada', r.status === 400 && /evidência/.test(j(r.body)), `${r.status} ${j(r.body)}`);
  const ev2 = await ok('POST', '/super-admin/fiscal-engine/evidence', { token: SA, body: { kind: 'PROVIDER_VALIDITY', filename: 'renovacao.pdf', contentType: 'application/pdf', base64: Buffer.from('%PDF-1.4\n% Renovacao (QA)\n%%EOF\n').toString('base64') } });
  await ok('PATCH', '/super-admin/fiscal-engine/settings', { token: SA, body: { providerValidUntil: future, providerEvidenceId: ev2.id, providerVerifiedBy: 'QA' } });
  ov = await ok('PATCH', '/super-admin/fiscal-engine/settings', { token: SA, body: { vendusEnabled: true } });
  r = await sell();
  R.check('V-19d', 'renovação com evidência documental → estado operacional reposto', ov.validity.status === 'CONFIRMADO' && r.status < 300 && !!r.body.fiscal?.number, `${ov.validity.status} ${r.status}`);

  // ── Teste 20 — nenhum motor válido ─────────────────────────────────────────
  await ok('POST', `/super-admin/fiscal-engine/company/${cid}/suspend`, { token: SA, body: { reason: 'Teste QA: nenhum motor autorizado' } });
  const before20 = await countInvoices();
  r = await sell();
  R.check('V-20a', 'emissão suspensa → recusada, sem número fiscal fictício nem série local', r.status === 503 && (await countInvoices()) === before20, `${r.status} ${j(r.body)}`);
  r = await call('POST', `/super-admin/fiscal-engine/company/${cid}/use-lps`, { token: SA, body: { confirmation: 'MUDAR PARA MOTOR PRÓPRIO' } });
  R.check('V-20b', 'mudar para o motor próprio sem validação AGT do LPS → recusado', r.status === 409 && /validação AGT do LPS/.test(j(r.body)), `${r.status}`);
  land = await ok('GET', '/public/landing');
  R.check('V-LAND2', 'sem empresa activa no Vendus → landing deixa de o apresentar como motor em uso', land.fiscalEngine === null, j(land.fiscalEngine));

  // ── Permissões e segredos ──────────────────────────────────────────────────
  r = await call('GET', '/super-admin/fiscal-engine', { token: A });
  R.check('V-P1', 'empresa não acede às rotas do Super Admin', r.status === 403 || r.status === 401, `${r.status}`);
  const st = await ok('GET', '/fiscal-engine/status', { token: A });
  R.check('V-P2', 'empresa vê o estado da própria ligação sem a chave', !!st.indicator && !JSON.stringify(st).includes(apiKey), st.indicator);
  const audit = await pub.query(`SELECT COUNT(*)::int AS n FROM nexus_public.audit_logs WHERE (before::text LIKE $1 OR after::text LIKE $1)`, [`%${apiKey}%`]).catch(() => ({ rows: [{ n: 0 }] }));
  const log = fs.existsSync(process.env.QA_LOG ?? '/tmp/qa-api.log') ? fs.readFileSync(process.env.QA_LOG ?? '/tmp/qa-api.log', 'utf8') : '';
  ms = await mstate();
  R.check('V-P3', 'API KEY nunca no URL, nos registos de auditoria nem no log da API', !ms.urlKeyLeak && audit.rows[0].n === 0 && !log.includes(apiKey), `urlLeak=${ms.urlKeyLeak} audit=${audit.rows[0].n}`);
  const aud = await pub.query(`SELECT action FROM nexus_public.audit_logs WHERE action LIKE 'FISCAL_ENGINE_%'`).catch(() => ({ rows: [] }));
  R.check('V-P4', 'alterações auditadas (chave, teste, activação, suspensão, validade)', ['FISCAL_ENGINE_API_KEY_SET', 'FISCAL_ENGINE_ACTIVATED', 'FISCAL_ENGINE_SUSPENDED', 'FISCAL_ENGINE_SETTINGS_UPDATED'].every((a) => aud.rows.some((x) => x.action === a)), [...new Set(aud.rows.map((x) => x.action))].join(','));
} catch (e) {
  R.check('V-ERRO', 'cenário terminou sem exceção', false, e instanceof Error ? e.stack?.slice(0, 400) : String(e));
} finally {
  await pub.end();
  mock.srv.close();
}

fs.mkdirSync('qa/out', { recursive: true });
const sum = R.summary();
fs.writeFileSync('qa/out/vendus-motor.json', JSON.stringify(sum, null, 1));
console.log(`\n${sum.passed}/${sum.total} passaram; ${sum.failed} falharam`);
process.exit(sum.failed ? 1 : 0);
