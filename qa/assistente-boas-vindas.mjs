/**
 * QA — assistente "Bem-Vindo" pós-registo (estilo Vendus): Validar NIF,
 * conclusão com morada/localidade/responsável/cargo/objectivo e "Preencher
 * Mais Tarde" (só com NIF real). Só localhost.
 *
 * Uso: node qa/assistente-boas-vindas.mjs
 */
import fs from 'node:fs';
import { ok, call, db, Report } from './lib.mjs';

const R = new Report('assistente-boas-vindas');
const tag = String(Date.now()).slice(-6);
const plan = (await ok('GET', '/public/landing')).plans?.[0]?.tier ?? 'STARTER';
const reg = async (extra) => (await ok('POST', '/onboarding/register-simple', { body: { email: `qa-bv-${extra.k}-${tag}@qa.test`, password: 'QaTeste#2026x', planTier: plan, ...extra.b } })).tokens.accessToken;

const A = await reg({ k: 'a', b: { nif: `5418${tag}` } });
let r = await call('POST', '/onboarding/validate-nif', { token: A, body: { nif: '5000000001' } });
R.check('BV-1', 'Validar NIF com NIF válido → válido', r.status === 200 && r.body.valid === true, JSON.stringify(r.body));
r = await call('POST', '/onboarding/validate-nif', { token: A, body: { nif: '12ab' } });
R.check('BV-2', 'Validar NIF com NIF inválido → inválido com motivo', r.status === 200 && r.body.valid === false && !!r.body.reason, JSON.stringify(r.body));
r = await call('POST', '/onboarding/validate-nif', { body: { nif: '5000000001' } });
R.check('BV-3', 'Validar NIF sem sessão → 401', r.status === 401, `${r.status}`);

r = await call('POST', '/onboarding/skip-setup', { token: A });
R.check('BV-4', '"Preencher Mais Tarde" com NIF do registo → entra no painel', r.status === 200, `${r.status}`);
let st = await ok('GET', '/onboarding/setup-status', { token: A });
R.check('BV-5', 'depois de saltar, o setup fica concluído', st.setupCompleted === true, JSON.stringify(st));

const B = await reg({ k: 'b', b: {} });
r = await call('POST', '/onboarding/skip-setup', { token: B });
R.check('BV-6', '"Preencher Mais Tarde" sem NIF → recusado (o emitente nunca fica com NIF provisório)', r.status === 400 && /NIF/.test(r.body?.message ?? ''), `${r.status} ${r.body?.message}`);
r = await call('POST', '/onboarding/complete-setup', { token: B, body: { name: 'QA Bem Vindo Lda', nif: `5419${tag}`, address: 'Rua 1', city: 'Benguela', responsibleName: 'Rui Teste', responsiblePhone: '+244 923 111 222', responsibleRole: 'MANAGER', usage: 'RESTAURANT' } });
R.check('BV-7', 'Terminar com todos os dados do assistente', r.status === 201 || r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
r = await call('POST', '/onboarding/complete-setup', { token: B, body: { name: 'X Lda', nif: `5419${tag}`, responsibleRole: 'CEO' } });
R.check('BV-8', 'cargo fora da lista → 400', r.status === 400, `${r.status}`);
r = await call('POST', '/onboarding/complete-setup', { token: B, body: { name: 'X Lda', nif: `5419${tag}`, responsiblePhone: '<script>' } });
R.check('BV-9', 'telefone inválido → 400', r.status === 400, `${r.status}`);

const pub = await db('nexus_public');
const c = (await pub.query(`SELECT name, nif, sector, "responsibleName", "responsiblePhone", "schemaName" FROM nexus_public.companies WHERE "responsibleEmail" = $1`, [`qa-bv-b-${tag}@qa.test`])).rows[0];
const s = c ? (await pub.query(`SELECT address, company_profile FROM "${c.schemaName}".site_settings LIMIT 1`)).rows[0] : null;
R.check('BV-10', 'grava nome, NIF, responsável e telefone da empresa', c?.name === 'QA Bem Vindo Lda' && c?.nif === `5419${tag}` && c?.responsibleName === 'Rui Teste' && c?.responsiblePhone === '+244 923 111 222', JSON.stringify(c));
R.check('BV-11', 'grava morada, localidade, cargo e objectivo', s?.address === 'Rua 1' && s?.company_profile?.city === 'Benguela' && s?.company_profile?.responsibleRole === 'MANAGER' && s?.company_profile?.usage === 'RESTAURANT', JSON.stringify(s));
R.check('BV-12', 'objectivo "Restauração" adapta o painel à restauração', c?.sector === 'RESTAURANT', c?.sector);
await pub.end();

fs.mkdirSync('qa/out', { recursive: true });
const sum = R.summary();
fs.writeFileSync('qa/out/assistente-boas-vindas.json', JSON.stringify(sum, null, 1));
console.log(`\n${sum.passed}/${sum.total} passaram; ${sum.failed} falharam`);
