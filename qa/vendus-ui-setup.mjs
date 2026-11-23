/**
 * QA (só localhost) — deixa o simulador Vendus a correr e reactiva o motor na última
 * empresa de QA do `qa/vendus-motor.mjs`, para testar o caixa no navegador.
 * Uso: node qa/vendus-ui-setup.mjs   (fica a correr; Ctrl+C para parar)
 */
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { ok, db } from './lib.mjs';
import { startVendusMock } from './vendus-mock.mjs';

const require = createRequire(import.meta.url);
const apiKey = `qa-vendus-ui-${randomBytes(12).toString('base64url')}`;
await startVendusMock({ apiKey });
const pub = await db('nexus_public');
const argon2 = require('../apps/api/node_modules/argon2');
const tag = String(Date.now()).slice(-6);
const saEmail = `qa-vd-ui-sa-${tag}@qa.test`, saPass = randomBytes(9).toString('base64url');
await pub.query(`INSERT INTO nexus_public.platform_users (id, email, "passwordHash", name, role, "isActive", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'QA Vendus UI', 'SUPER_ADMIN', true, now(), now())`, [saEmail, await argon2.hash(saPass, { type: argon2.argon2id })]);
const saR = await ok('POST', '/auth/super-admin/login', { body: { email: saEmail, password: saPass } }); const SA = saR.tokens?.accessToken ?? saR.accessToken;
const co = (await pub.query(`SELECT c.id, COALESCE(NULLIF(f."taxpayerNif", ''), c.nif) AS nif, c."responsibleEmail" AS email, c.code FROM nexus_public.companies c JOIN nexus_public.fiscal_engine_companies f ON f."companyId" = c.id WHERE COALESCE(f."taxpayerNif", '') = '' AND f."apiKeyEnc" IS NOT NULL ORDER BY c."createdAt" DESC LIMIT 1`)).rows[0];
await fetch('http://127.0.0.1:3997/__control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: { fiscal_id: co.nif, country: 'AO', company: 'QA UI' } }) });
await ok('PUT', `/super-admin/fiscal-engine/company/${co.id}/api-key`, { token: SA, body: { apiKey } });
await ok('PATCH', `/super-admin/fiscal-engine/company/${co.id}`, { token: SA, body: { registerId: '9', paymentMap: { CASH: '3', CARD: '4', TRANSFER: '4', REFERENCE: '4', EXPRESS: '4' }, feConfirmed: true } });
const tst = await ok('POST', `/super-admin/fiscal-engine/company/${co.id}/test`, { token: SA }); console.log('teste', JSON.stringify(tst.test), tst.link?.accountFiscalId, co.nif);
await ok('POST', `/super-admin/fiscal-engine/company/${co.id}/tests`, { token: SA });
const det = await ok('POST', `/super-admin/fiscal-engine/company/${co.id}/activate`, { token: SA });
console.log(JSON.stringify({ company: co.email, code: co.code, indicator: det.indicator, engine: det.effective?.engine }));
await pub.end();
