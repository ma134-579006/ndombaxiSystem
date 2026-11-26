/**
 * QA (só localhost) — Configuração › Unidades e Motivos - Notas Crédito (paridade Vendus).
 * A 1.ª leitura traz as sugestões de origem; o gestor acrescenta, muda o nome e apaga;
 * a Caixa (operador) lê mas não altera; nomes repetidos e listas desconhecidas são recusados.
 * Uso: node qa/listas-config.mjs  (API de QA na 3901)
 */
import fs from 'node:fs';
import { call, ok, Report } from './lib.mjs';

const R = new Report('listas-config');
const tok = (r) => r.tokens?.accessToken ?? r.accessToken;
const tag = String(Date.now()).slice(-6);
try {
  const plan = (await ok('GET', '/public/landing')).plans?.[0]?.tier ?? 'STARTER';
  const email = `qa-lc-${tag}@qa.test`;
  const pass = 'QaTeste#2026x';
  await ok('POST', '/onboarding/register-simple', { body: { email, password: pass, planTier: plan, nif: `57${tag}01` } });
  let A = tok(await ok('POST', '/auth/login', { body: { email, password: pass } }));
  await ok('POST', '/onboarding/complete-setup', { token: A, body: { name: `QA Listas ${tag} Lda`, nif: `57${tag}01`, address: 'Rua 1', city: 'Luanda' } });
  A = tok(await ok('POST', '/auth/login', { body: { email, password: pass } }));

  const u0 = await ok('GET', '/config-lists/units', { token: A });
  R.check('LC-1', 'Unidades: a 1.ª leitura traz as de origem (un, kg, L…) com id', u0.length >= 10 && u0.some((x) => x.label === 'kg') && u0.every((x) => !!x.id), JSON.stringify(u0.slice(0, 3)));
  const n0 = await ok('GET', '/config-lists/nc-reasons', { token: A });
  R.check('LC-2', 'Motivos NC: a 1.ª leitura traz os de origem', n0.some((x) => x.label === 'Devolução de artigos'), JSON.stringify(n0.slice(0, 2)));

  const a1 = await call('POST', '/config-lists/units', { token: A, body: { label: '  rolo  ' } });
  const u1 = await ok('GET', '/config-lists/units', { token: A });
  const rolo = u1.find((x) => x.label === 'rolo');
  R.check('LC-3', 'acrescentar «rolo» (espaços limpos) fica no fim da lista', a1.status < 300 && !!rolo && u1.at(-1)?.label === 'rolo', `${a1.status} ${JSON.stringify(u1.at(-1))}`);
  const d1 = await call('POST', '/config-lists/units', { token: A, body: { label: 'ROLO' } });
  R.check('LC-4', 'nome repetido (maiúsculas) é recusado', d1.status === 409, d1.status);
  const lg = await call('POST', '/config-lists/units', { token: A, body: { label: 'x'.repeat(17) } });
  R.check('LC-5', 'unidade com mais de 16 caracteres é recusada', lg.status === 400, lg.status);
  const r1 = await call('PATCH', `/config-lists/units/${rolo.id}`, { token: A, body: { label: 'rolo grande' } });
  const u2 = await ok('GET', '/config-lists/units', { token: A });
  R.check('LC-6', 'mudar o nome', r1.status < 300 && u2.some((x) => x.id === rolo.id && x.label === 'rolo grande'), r1.status);
  const kg = u2.find((x) => x.label === 'kg');
  const del = await call('DELETE', `/config-lists/units/${kg.id}`, { token: A });
  const u3 = await ok('GET', '/config-lists/units', { token: A });
  R.check('LC-7', 'apagar «kg» e não volta a aparecer', del.status < 300 && !u3.some((x) => x.label === 'kg'), del.status);
  const nc = await call('POST', '/config-lists/nc-reasons', { token: A, body: { label: 'Artigo trocado por outro tamanho' } });
  const n1 = await ok('GET', '/config-lists/nc-reasons', { token: A });
  R.check('LC-8', 'motivo de NC novo aparece na lista lida pela Caixa', nc.status < 300 && n1.some((x) => x.label === 'Artigo trocado por outro tamanho'), nc.status);
  const bad = await call('GET', '/config-lists/armazens', { token: A });
  R.check('LC-9', 'lista desconhecida → 404', bad.status === 404, bad.status);
  const anon = await call('GET', '/config-lists/units');
  R.check('LC-10', 'sem sessão → 401', anon.status === 401, anon.status);

  // Operador de caixa: lê, não altera.
  const cashEmail = `qa-lc-cx-${tag}@qa.test`;
  const cu = await call('POST', '/staff/users', { token: A, body: { name: 'Caixa QA', email: cashEmail, role: 'CASHIER', password: pass } });
  if (cu.status < 300) {
    const C = tok(await ok('POST', '/auth/login', { body: { email: cashEmail, password: cu.body?.temporaryPassword ?? pass } }));
    const cr = await call('GET', '/config-lists/nc-reasons', { token: C });
    const cw = await call('POST', '/config-lists/nc-reasons', { token: C, body: { label: 'Tentativa da caixa' } });
    R.check('LC-11', 'operador de caixa lê os motivos mas não altera', cr.status === 200 && cw.status === 403, `${cr.status}/${cw.status}`);
  } else {
    R.check('LC-11', 'operador de caixa lê os motivos mas não altera', false, `não foi possível criar o operador: ${cu.status} ${JSON.stringify(cu.body).slice(0, 120)}`);
  }
} catch (e) {
  R.check('LC-ERRO', 'cenário terminou sem exceção', false, e instanceof Error ? e.stack?.slice(0, 400) : String(e));
}
fs.mkdirSync('qa/out', { recursive: true });
const sum = R.summary();
console.log(`\n${sum.passed}/${sum.total} passaram; ${sum.failed} falharam`);
process.exit(sum.failed ? 1 : 0);
