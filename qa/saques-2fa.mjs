/**
 * QA — regras de saque do LPS Kwanza e verificação em 2 passos (só localhost).
 *
 *  Saques: prazo (seg–qui 24 h; sex–dom até ao fim de segunda), reclamação do associado só
 *  depois do prazo, Super Admin encontra pelo código do associado, avisa a empresa (+24 h),
 *  empresa paga (RESOLVED) ou é banida e o associado reembolsado (REFUNDED), readmissão.
 *  Bancos: a empresa indica os seus bancos e o associado vê-os no painel.
 *  2FA: associado (WhatsApp), utilizador da empresa (e-mail) e Super Admin — login, troca e
 *  recuperação da senha, limite de envios, código usado uma só vez, desbloqueio pelo Super Admin.
 *
 * A API de QA corre com TWOFA_DEV_LOG=1: os códigos vão para o registo (QA_LOG) em vez de
 * serem enviados — nunca em produção (o serviço recusa esse modo com NODE_ENV=production).
 *
 * Uso: node qa/saques-2fa.mjs   (empresas de qa/seed-cinco.mjs)
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { call, ok, db, Report, sleep } from './lib.mjs';

const require = createRequire(import.meta.url);
const S = JSON.parse(fs.readFileSync(process.env.QA_CINCO ?? 'qa/.cinco.json', 'utf8'));
const LOG = process.env.QA_LOG;
if (!LOG) throw new Error('Indique QA_LOG (registo da API de QA, onde ficam os códigos de teste).');
const R = new Report('saques-2fa');
const K = '/kwanza', AK = '/ecommerce/kwanza';
const tag = String(Date.now()).slice(-6);
const geo = { geoLat: -8.8383, geoLng: 13.2344, geoAccuracy: 8, geoConsent: true };
const near = (a, b) => Math.abs(a - b) < 0.02;

/** Último código de teste escrito no registo para este destino e finalidade (depois de `since`). */
async function code(target, purpose, since) {
  for (let i = 0; i < 40; i++) {
    const txt = fs.readFileSync(LOG, 'utf8').slice(since);
    const re = new RegExp(`\\[2FA-DEV\\] ${purpose} (EMAIL|WHATSAPP) ${target.replace(/[.+]/g, '\\$&')} código (\\d{6})`, 'g');
    const all = [...txt.matchAll(re)];
    if (all.length) return all[all.length - 1][2];
    await sleep(150);
  }
  return null;
}
const mark = () => fs.statSync(LOG).size;

/* ═══════════ 1. regra do prazo ═══════════ */
{
  const { withdrawalDue } = require('../apps/api/dist/ecommerce/kwanza-rules.js');
  const at = (s) => new Date(s);
  const hrs = (a, b) => (b.getTime() - a.getTime()) / 3_600_000;
  const mon = at('2026-11-09T10:00:00+01:00'), thu = at('2026-11-12T23:30:00+01:00');
  const fri = at('2026-11-13T09:00:00+01:00'), sat = at('2026-11-14T15:00:00+01:00'), sun = at('2026-11-15T23:00:00+01:00');
  const endMon = '2026-11-16T22:59:59.000Z'; // 23:59:59 de Luanda
  R.check('PZ-1', 'pedido de segunda a quinta: prazo de 24 h', hrs(mon, withdrawalDue(mon)) === 24 && hrs(thu, withdrawalDue(thu)) === 24);
  R.check('PZ-2', 'pedido de sexta, sábado ou domingo: prazo até ao fim da segunda-feira', [fri, sat, sun].every((d) => withdrawalDue(d).toISOString() === endMon), withdrawalDue(fri).toISOString());
}

/* ═══════════ 2. preparar empresa, produto e associado ═══════════ */
const login = async (email, password = S.pass, extra = {}) => call('POST', '/auth/login', { body: { email, password, ...extra } });
const tok = (r) => r.body?.tokens?.accessToken ?? r.body?.accessToken;
const co = { k: 'E', code: 'loja-welwitschia-qa' };
co.adm = tok(await login(S.E.email));
co.db = await db(S.E.schema);
const base = 20 + (Number(tag) % 30);
co.prod = S.E.products[base];
await ok('POST', '/erp/stock/entry', { token: co.adm, body: { productId: co.prod.id, warehouseId: S.E.storeId, quantity: 200, unitCost: co.prod.cost } });
await ok('PATCH', `${AK}/products/${co.prod.code}`, { token: co.adm, body: { published: true, percent: 20, mode: 'OPEN', allowMarkup: false, maxMarkupPct: null, materials: [] } });
{
  const m = (await ok('GET', `${K}/market`)).find((l) => l.productCode === co.prod.code && l.companyName);
  if (m) co.code = m.companyCode;
}

// Bancos da empresa
const savedBanks = await call('PUT', `${AK}/banks`, { token: co.adm, body: { banks: ['BFA', 'BAI', ' BFA ', 'X'] } });
const gotBanks = await ok('GET', `${AK}/banks`, { token: co.adm });
R.check('BK-1', 'a empresa guarda os seus bancos (sem repetidos nem vazios) e vê a lista de bancos de Angola', savedBanks.status === 200 && JSON.stringify(gotBanks.banks) === '["BFA","BAI"]' && gotBanks.catalog.includes('BIC') && !gotBanks.banned, JSON.stringify(gotBanks.banks));

const phone = `95${tag}7`.slice(0, 9);
const reg = await ok('POST', `${K}/auth/register`, { body: { name: `Associado Prazo ${tag}`, phone, password: 'segredo123' } });
const A = { token: reg.token, code: reg.associate.code, phone };
await ok('POST', `${K}/me/accounts`, { token: A.token, body: { method: 'Transferência bancária', bank: 'BFA', holder: `Associado Prazo ${tag}`, details: `AO06 0006 0000 ${tag}7` } });
A.accountId = (await ok('GET', `${K}/me/accounts`, { token: A.token }))[0].id;
await ok('POST', `${K}/me/affiliations`, { token: A.token, body: { companyCode: co.code, productCode: co.prod.code } });

// 3 vendas pagas pela empresa → saldo disponível
for (let i = 0; i < 3; i++) {
  let r;
  for (;;) { r = await call('POST', `${K}/checkout`, { body: { companyCode: co.code, associateCode: A.code, lines: [{ productCode: co.prod.code, quantity: 2 }], name: `Cliente ${i}`, phone: `93${tag}${i}`.slice(0, 9), address: 'Rua da Missão, Luanda', deliveryMethod: 'DELIVERY', paymentMethod: 'CASH', device: randomUUID(), ...geo } }); if (r.status !== 429) break; await sleep(15000); }
  if (r.status >= 300) throw new Error(`checkout ${r.status} ${JSON.stringify(r.body)}`);
  await ok('POST', `/ecommerce/orders/${r.body.orderId}/pay`, { token: co.adm });
}
let d = await ok('GET', `${K}/me/dashboard`, { token: A.token });
let pc = d.companies.find((c) => c.companyCode === co.code);
R.check('BK-2', 'o associado vê no painel os bancos da empresa (para abrir conta no mesmo banco)', JSON.stringify(pc?.banks) === '["BFA","BAI"]', JSON.stringify(pc?.banks));
const bal0 = pc.balance;
R.check('SQ-0', 'associado com saldo disponível depois de a empresa marcar as vendas pagas', bal0 > 0, bal0);

/* ═══════════ 3. saque pago depois da reclamação (RESOLVED) ═══════════ */
const w1v = Math.floor(bal0 / 3);
await ok('POST', `${K}/me/withdrawals`, { token: A.token, body: { companyCode: co.code, amount: w1v, accountId: A.accountId } });
d = await ok('GET', `${K}/me/dashboard`, { token: A.token });
const w1 = d.withdrawals[0];
const dueH = (new Date(w1.dueAt).getTime() - new Date(w1.date).getTime()) / 3_600_000;
R.check('SQ-1', 'o saque fica com prazo para a empresa (24 h, ou até ao fim de segunda se pedido sex–dom)', dueH >= 23.9 && dueH <= 87, `${dueH.toFixed(1)} h`);
const early = await call('POST', `${K}/me/withdrawals/${w1.id}/complain`, { token: A.token, body: { text: 'cedo' } });
R.check('SQ-2', 'reclamar antes do prazo é recusado', early.status === 400, early.body?.message);
const cw = (await ok('GET', `${AK}/withdrawals`, { token: co.adm })).find((w) => w.id === w1.id);
R.check('SQ-3', 'a empresa vê o prazo e o código do associado em cada pedido de saque', cw?.dueAt === w1.dueAt && cw?.code === A.code, `${cw?.dueAt} ${cw?.code}`);

await co.db.query(`UPDATE nexus_public.kwanza_withdrawals SET "dueAt" = now() - interval '1 hour' WHERE id = $1`, [w1.id]);
const c1 = await call('POST', `${K}/me/withdrawals/${w1.id}/complain`, { token: A.token, body: { text: 'Passou o prazo e não recebi.' } });
const c1b = await call('POST', `${K}/me/withdrawals/${w1.id}/complain`, { token: A.token, body: {} });
const other = await ok('POST', `${K}/auth/register`, { body: { name: `Outro ${tag}`, phone: `95${tag}8`.slice(0, 9), password: 'segredo123' } });
const c1c = await call('POST', `${K}/me/withdrawals/${w1.id}/complain`, { token: other.token, body: {} });
R.check('SQ-4', 'prazo ultrapassado: o associado reclama (uma vez; outro associado não consegue)', c1.status === 200 && c1b.status === 400 && c1c.status === 404, `${c1.status}/${c1b.status}/${c1c.status}`);
const rej = await call('POST', `${AK}/withdrawals/${w1.id}/reject`, { token: co.adm, body: { note: 'não' } });
R.check('SQ-5', 'com reclamação aberta a empresa já não pode recusar o saque', rej.status === 400, rej.body?.message);
const notes = (await co.db.query(`SELECT kind FROM admin_notifications WHERE kind = 'KWANZA_WITHDRAWAL_COMPLAINT' ORDER BY created_at DESC LIMIT 1`)).rows;
R.check('SQ-6', 'a empresa recebe a notificação da reclamação', notes.length === 1);

// Super Admin de teste (só QA local; senha gerada nesta corrida)
const argon2 = require('../apps/api/node_modules/argon2');
const saEmail = `qa-2fa-${tag}@qa.test`, saPass = randomBytes(9).toString('base64url');
const pub = await db();
await pub.query(`INSERT INTO nexus_public.platform_users (id, email, "passwordHash", name, role, "isActive", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'QA 2FA', 'SUPER_ADMIN', true, now(), now())`, [saEmail, await argon2.hash(saPass, { type: argon2.argon2id })]);
const saLogin = (extra = {}) => call('POST', '/auth/super-admin/login', { body: { email: saEmail, password: saPass, ...extra } });
let SA = tok(await saLogin());

const forbidden = await call('GET', '/super-admin/kwanza/withdrawals', { token: co.adm });
R.check('SA-0', 'só o Super Admin abre as reclamações de saques', forbidden.status === 403, forbidden.status);
let list = await ok('GET', `/super-admin/kwanza/withdrawals?q=${A.code}`, { token: SA });
let row = list.rows.find((x) => x.id === w1.id);
R.check('SA-1', 'o Super Admin encontra a reclamação pelo código do associado', row?.escalation === 'OPEN' && row.associate.code === A.code && row.complaint === 'Passou o prazo e não recebi.' && list.counts.open >= 1, `${row?.escalation} open=${list.counts.open}`);
const banEarly = await call('POST', `/super-admin/kwanza/withdrawals/${w1.id}/ban-refund`, { token: SA, body: { refundRef: 'TRF-1' } });
R.check('SA-2', 'banir antes de avisar a empresa é recusado', banEarly.status === 400, banEarly.body?.message);
const nt = await ok('POST', `/super-admin/kwanza/withdrawals/${w1.id}/notify`, { token: SA, body: { note: 'Pague hoje.' } });
const extH = (new Date(nt.extendedUntil).getTime() - Date.now()) / 3_600_000;
const nt2 = await call('POST', `/super-admin/kwanza/withdrawals/${w1.id}/notify`, { token: SA, body: {} });
R.check('SA-3', 'aviso à empresa dá mais 24 h (uma só vez)', extH > 23.9 && extH <= 24 && nt2.status === 400, `${extH.toFixed(2)} h`);
const warn = (await co.db.query(`SELECT body FROM admin_notifications WHERE kind = 'KWANZA_WITHDRAWAL_WARNING' ORDER BY created_at DESC LIMIT 1`)).rows[0];
const aNote = (await pub.query(`SELECT title FROM nexus_public.kwanza_notifications n JOIN nexus_public.kwanza_associates a ON a.id = n."associateId" WHERE a.code = $1 AND n.kind = 'WITHDRAWAL_ESCALATED'`, [A.code])).rows;
R.check('SA-4', 'empresa recebe o aviso com o prazo final e o associado é informado', !!warn?.body?.includes('banida') && aNote.length === 1, warn?.body?.slice(0, 90));
const banIn = await call('POST', `/super-admin/kwanza/withdrawals/${w1.id}/ban-refund`, { token: SA, body: { refundRef: 'TRF-1' } });
R.check('SA-5', 'dentro das 24 h extra não se pode banir', banIn.status === 400, banIn.body?.message);
await ok('POST', `${AK}/withdrawals/${w1.id}/pay`, { token: co.adm, body: { note: `TRF ${tag}` } });
list = await ok('GET', `/super-admin/kwanza/withdrawals?status=closed&q=${A.code}`, { token: SA });
row = list.rows.find((x) => x.id === w1.id);
R.check('SA-6', 'a empresa paga depois do aviso → reclamação resolvida', row?.escalation === 'RESOLVED' && row.status === 'PAID', `${row?.escalation}/${row?.status}`);

/* ═══════════ 4. saque não pago → banir e reembolsar ═══════════ */
d = await ok('GET', `${K}/me/dashboard`, { token: A.token });
const bal1 = d.companies.find((c) => c.companyCode === co.code).balance;
await ok('POST', `${K}/me/withdrawals`, { token: A.token, body: { companyCode: co.code, amount: bal1, accountId: A.accountId } });
d = await ok('GET', `${K}/me/dashboard`, { token: A.token });
const w2 = d.withdrawals.find((w) => w.status === 'REQUESTED');
await co.db.query(`UPDATE nexus_public.kwanza_withdrawals SET "dueAt" = now() - interval '2 hours' WHERE id = $1`, [w2.id]);
await ok('POST', `${K}/me/withdrawals/${w2.id}/complain`, { token: A.token, body: { text: 'Sem pagamento.' } });
await ok('POST', `/super-admin/kwanza/withdrawals/${w2.id}/notify`, { token: SA, body: {} });
await co.db.query(`UPDATE nexus_public.kwanza_withdrawals SET "extendedUntil" = now() - interval '1 minute' WHERE id = $1`, [w2.id]);
const noRef = await call('POST', `/super-admin/kwanza/withdrawals/${w2.id}/ban-refund`, { token: SA, body: { refundRef: '' } });
const ban = await call('POST', `/super-admin/kwanza/withdrawals/${w2.id}/ban-refund`, { token: SA, body: { refundRef: `REEMB-${tag}`, note: 'Reembolso pela plataforma' } });
R.check('BN-1', 'sem pagamento depois das 24 h extra: o Super Admin bane e regista o reembolso (pede a referência)', noRef.status === 400 && ban.status === 200, `${noRef.status}/${ban.status}`);
d = await ok('GET', `${K}/me/dashboard`, { token: A.token });
pc = d.companies.find((c) => c.companyCode === co.code);
const w2b = d.withdrawals.find((w) => w.id === w2.id);
R.check('BN-2', 'o associado vê o saque reembolsado (com referência) e o valor como recebido', w2b?.status === 'REFUNDED' && w2b.refundRef === `REEMB-${tag}` && pc.requested === 0 && near(pc.withdrawn, w1v + bal1) && pc.balance === 0, `${w2b?.status} levantado=${pc.withdrawn}`);
const mk = (await ok('GET', `${K}/market`)).filter((l) => l.companyCode === co.code);
const mkA = (await ok('GET', `${K}/market`, { token: A.token })).filter((l) => l.companyCode === co.code);
R.check('BN-3', 'empresa banida: os produtos saem do marketplace', mk.length === 0 && mkA.length === 0, `${mk.length}/${mkA.length}`);
await ok('POST', `${AK}/sync`, { token: co.adm });
const pubB = await call('PATCH', `${AK}/products/${co.prod.code}`, { token: co.adm, body: { published: true, percent: 20, mode: 'OPEN', allowMarkup: false, maxMarkupPct: null, materials: [] } });
const mk2 = (await ok('GET', `${K}/market`, { token: A.token })).filter((l) => l.companyCode === co.code);
const bnk = await ok('GET', `${AK}/banks`, { token: co.adm });
R.check('BN-4', 'empresa banida não volta a publicar nem a sincronização a repõe; o painel mostra o banimento', pubB.status === 400 && mk2.length === 0 && !!bnk.banned, `${pubB.status} ${bnk.banned?.reason ?? ''}`);
list = await ok('GET', '/super-admin/kwanza/withdrawals?status=closed', { token: SA });
const bRow = list.bans.find((b) => b.code === co.code);
R.check('BN-5', 'Super Admin: empresa na lista de banidas com a dívida do reembolso', !!bRow && bRow.debt >= bal1 && list.counts.debt >= bal1 && list.counts.refunded >= 1, `${bRow?.debt}`);
const refNote = (await pub.query(`SELECT 1 FROM nexus_public.kwanza_notifications n JOIN nexus_public.kwanza_associates a ON a.id = n."associateId" WHERE a.code = $1 AND n.kind = 'WITHDRAWAL_REFUNDED'`, [A.code])).rows;
const banNote = (await co.db.query(`SELECT 1 FROM admin_notifications WHERE kind = 'KWANZA_BANNED'`)).rows;
R.check('BN-6', 'associado e empresa notificados do reembolso e do banimento', refNote.length === 1 && banNote.length >= 1);
const unban = await call('POST', `/super-admin/kwanza/bans/${bRow.companyId}/lift`, { token: SA });
await ok('PATCH', `${AK}/products/${co.prod.code}`, { token: co.adm, body: { published: true, percent: 20, mode: 'OPEN', allowMarkup: false, maxMarkupPct: null, materials: [] } });
const mk3 = (await ok('GET', `${K}/market`, { token: A.token })).filter((l) => l.companyCode === co.code);
R.check('BN-7', 'readmissão pelo Super Admin: a empresa volta a publicar', unban.status === 200 && mk3.length >= 1, `${unban.status} ${mk3.length}`);

/* ═══════════ 4b. publicações: cada associado só edita a sua; stock e fotos do produto ═══════════ */
{
  const imgA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  await ok('PUT', `${K}/me/posts`, { token: A.token, body: { companyCode: co.code, productCode: co.prod.code, price: null, images: [imgA], videoUrl: null, caption: `Publicação A ${tag}`, published: true } });
  const B = await ok('POST', `${K}/auth/register`, { body: { name: `Associado B ${tag}`, phone: `95${tag}9`.slice(0, 9), password: 'segredo123' } });
  await ok('POST', `${K}/me/affiliations`, { token: B.token, body: { companyCode: co.code, productCode: co.prod.code } });
  await ok('PUT', `${K}/me/posts`, { token: B.token, body: { companyCode: co.code, productCode: co.prod.code, price: null, images: [], videoUrl: null, caption: `Publicação B ${tag}`, published: true } });
  const pa = await ok('GET', `${K}/listing/${co.code}/${co.prod.code}?a=${A.code}`);
  const pb = await ok('GET', `${K}/listing/${co.code}/${co.prod.code}?a=${B.associate.code}`);
  R.check('PB-1', 'cada associado edita só a sua publicação (a de B não altera a de A)', pa.caption === `Publicação A ${tag}` && pb.caption === `Publicação B ${tag}` && pa.associate.code === A.code, `${pa.caption} | ${pb.caption}`);
  const mk = (await ok('GET', `${K}/market`)).find((l) => l.productCode === co.prod.code && l.associate?.code === A.code);
  R.check('PB-2', 'o cliente sem conta vê o stock disponível do produto', mk && mk.stockQty > 0 && mk.inStock, `${mk?.stockQty}`);
  const prodImg = (await ok('GET', `${K}/market`, { token: A.token })).find((l) => l.productCode === co.prod.code)?.imageUrl;
  R.check('PB-3', 'a foto do produto vem primeiro; a imagem do associado fica na galeria', prodImg ? (mk.imageUrl === prodImg && mk.gallery.includes(imgA)) : mk.imageUrl === imgA, `${String(mk?.imageUrl).slice(0, 40)}`);
  const social = await call('GET', `${K}/social/${co.code}/${co.prod.code}?device=${randomUUID()}`);
  R.check('PB-4', 'página do produto: avaliações, estrelas e gostos/não gostos disponíveis sem conta', social.status === 200 && 'rating' in social.body && 'likes' in social.body && 'dislikes' in social.body && Array.isArray(social.body.reviews), social.status);
}
// Saldo novo para o saque com 2FA
{
  let r;
  for (;;) { r = await call('POST', `${K}/checkout`, { body: { companyCode: co.code, associateCode: A.code, lines: [{ productCode: co.prod.code, quantity: 1 }], name: 'Cliente 2FA', phone: `93${tag}8`.slice(0, 9), address: 'Rua 2', deliveryMethod: 'DELIVERY', paymentMethod: 'CASH', device: randomUUID(), ...geo } }); if (r.status !== 429) break; await sleep(15000); }
  await ok('POST', `/ecommerce/orders/${r.body.orderId}/pay`, { token: co.adm });
}

/* ═══════════ 5. 2FA do associado (WhatsApp) ═══════════ */
const st0 = await ok('GET', `${K}/me/two-factor`, { token: A.token });
R.check('2A-0', 'a verificação em 2 passos vem desligada por omissão', st0.enabled === false && st0.channels.whatsapp === true, JSON.stringify(st0));
let m0 = mark();
const su = await ok('POST', `${K}/me/two-factor/setup`, { token: A.token, body: { method: 'WHATSAPP' } });
const suCode = await code(A.phone, 'SETUP', m0);
const badC = await call('POST', `${K}/me/two-factor/confirm`, { token: A.token, body: { code: suCode === '111111' ? '222222' : '111111' } });
const cf = await call('POST', `${K}/me/two-factor/confirm`, { token: A.token, body: { code: suCode } });
R.check('2A-1', 'ativar por WhatsApp: código enviado para o telefone, código errado recusado, certo ativa', su.channel === 'WHATSAPP' && su.to.endsWith(A.phone.slice(-3)) && badC.status === 401 && cf.status < 300 && cf.body.enabled && cf.body.method === 'WHATSAPP', `${su.to} ${badC.status}/${cf.status}`);
m0 = mark();
const l1 = await call('POST', `${K}/auth/login`, { body: { login: A.phone, password: 'segredo123' } });
const lc = await code(A.phone, 'LOGIN', m0);
const lWrong = await call('POST', `${K}/auth/login`, { body: { login: A.phone, password: 'segredo123', twoFaCode: lc === '123456' ? '654321' : '123456' } });
const lOk = await call('POST', `${K}/auth/login`, { body: { login: A.phone, password: 'segredo123', twoFaCode: lc } });
const lReuse = await call('POST', `${K}/auth/login`, { body: { login: A.phone, password: 'segredo123', twoFaCode: lc } });
R.check('2A-2', 'login do associado com 2FA: pede o código, recusa o errado, aceita o certo uma só vez', l1.status === 401 && l1.body.error === 'TwoFaRequired' && l1.body.channel === 'WHATSAPP' && lWrong.status === 401 && lOk.status === 201 && !!lOk.body.token && lReuse.status === 401, `${l1.status}/${lWrong.status}/${lOk.status}/${lReuse.status}`);
const lBad = await call('POST', `${K}/auth/login`, { body: { login: A.phone, password: 'errada!!', twoFaCode: '000000' } });
R.check('2A-3', 'senha errada nunca chega ao passo do código', lBad.status === 401 && lBad.body.error !== 'TwoFaRequired', lBad.body?.message);
m0 = mark();
const cp1 = await call('POST', `${K}/me/password`, { token: A.token, body: { current: 'segredo123', next: 'novasenha9' } });
const cpc = await code(A.phone, 'CHANGE_PW', m0);
const cp2 = await call('POST', `${K}/me/password`, { token: A.token, body: { current: 'segredo123', next: 'novasenha9', twoFaCode: cpc } });
R.check('2A-4', 'mudar a senha com 2FA ligada pede o código do WhatsApp', cp1.status === 401 && cp1.body.error === 'TwoFaRequired' && cp2.status === 201, `${cp1.status}/${cp2.status}`);
m0 = mark();
const rq = await ok('POST', `${K}/auth/recover`, { body: { login: A.phone } });
const rc = await code(A.phone, 'RESET', m0);
m0 = mark();
const rc1 = await call('POST', `${K}/auth/recover/confirm`, { body: { login: A.phone, code: rc, password: 'recupera77' } });
const r2fa = await code(A.phone, 'RESET', m0);
const rc2 = await call('POST', `${K}/auth/recover/confirm`, { body: { login: A.phone, code: rc, password: 'recupera77', twoFaCode: r2fa } });
R.check('2A-5', 'recuperar a senha: código pelo WhatsApp (conta sem e-mail) + código da 2FA', rq.via === 'WHATSAPP' && rq.twoFa === true && rc1.status === 401 && rc1.body.error === 'TwoFaRequired' && rc2.status === 201 && r2fa !== rc, `${rq.via} ${rc1.status}/${rc2.status}`);
{
  d = await ok('GET', `${K}/me/dashboard`, { token: A.token });
  const bal = d.companies.find((c) => c.companyCode === co.code).balance;
  m0 = mark();
  const w0 = await call('POST', `${K}/me/withdrawals`, { token: A.token, body: { companyCode: co.code, amount: bal, accountId: A.accountId } });
  const wc = await code(A.phone, 'WITHDRAW', m0);
  const wBad = await call('POST', `${K}/me/withdrawals`, { token: A.token, body: { companyCode: co.code, amount: bal, accountId: A.accountId, twoFaCode: wc === '123456' ? '654321' : '123456' } });
  const wOk = await call('POST', `${K}/me/withdrawals`, { token: A.token, body: { companyCode: co.code, amount: bal, accountId: A.accountId, twoFaCode: wc } });
  R.check('2A-W', 'saque com 2FA ligada: pede o código, recusa o errado, segue com o certo', bal > 0 && w0.status === 401 && w0.body.error === 'TwoFaRequired' && wBad.status === 401 && wOk.status === 201, `${w0.status}/${wBad.status}/${wOk.status}`);
}
const dr1 = await call('POST', `${K}/me/two-factor/disable/request`, { token: A.token });
const dr2 = await call('POST', `${K}/me/two-factor/disable/request`, { token: A.token });
R.check('2A-6', 'limite de envios: novo código só 30 s depois', dr1.status === 201 && dr2.status === 429, `${dr1.status}/${dr2.status}`);
// O Super Admin desliga a 2FA de quem perdeu o telefone (pelo código do associado).
const ad = await call('POST', '/super-admin/security/disable-user', { token: SA, body: { who: A.code } });
const lNo = await call('POST', `${K}/auth/login`, { body: { login: A.phone, password: 'recupera77' } });
R.check('2A-7', 'Super Admin desliga a 2FA pelo código do associado; volta a entrar só com a senha', ad.status === 200 && ad.body.disabled === 1 && lNo.status === 201, `${ad.status}/${lNo.status}`);

/* ═══════════ 6. 2FA do utilizador da empresa (e-mail) ═══════════ */
const email = S.E.email.toLowerCase();
const ts0 = await ok('GET', '/auth/two-factor', { token: co.adm });
m0 = mark();
await ok('POST', '/auth/two-factor/setup', { token: co.adm, body: { method: 'EMAIL', target: email } });
await ok('POST', '/auth/two-factor/setup/confirm', { token: co.adm, body: { code: await code(email, 'SETUP', m0) } });
m0 = mark();
const t1 = await login(S.E.email);
const tc = await code(email, 'LOGIN', m0);
const t2 = await login(S.E.email, S.pass, { twoFaToken: tc });
R.check('2E-1', 'empresa: 2FA por e-mail desligada por omissão; ligada, o login pede o código e entra com ele', ts0.enabled === false && t1.status === 401 && t1.body.error === 'TwoFaRequired' && t1.body.channel === 'EMAIL' && t2.status === 200 && !!tok(t2), `${t1.status}/${t2.status}`);
co.adm = tok(t2);
const newPass = `${S.pass}#2f`;
const pw1 = await call('POST', '/auth/me/password', { token: co.adm, body: { current: S.pass, next: newPass } });
m0 = mark();
await ok('POST', '/auth/two-factor/code', { token: co.adm, body: { purpose: 'CHANGE_PW' } });
const pw2 = await call('POST', '/auth/me/password', { token: co.adm, body: { current: S.pass, next: newPass, twoFaCode: await code(email, 'CHANGE_PW', m0) } });
R.check('2E-2', 'empresa: mudar a própria senha pede a atual e o código da 2FA', pw1.status === 401 && pw2.status === 200, `${pw1.status}/${pw2.status}`);
// recuperação por link + código
const resetTok = randomBytes(32).toString('hex');
const uid = (await co.db.query('SELECT id FROM users WHERE lower(email) = $1', [email])).rows[0].id;
await pub.query(`INSERT INTO nexus_public.password_resets (id, email, scope, "companyCode", "tenantSchema", "userId", kind, "tokenHash", "expiresAt", "createdAt") VALUES (gen_random_uuid(), $1, 'TENANT', $2, $3, $4, 'PASSWORD', $5, now() + interval '1 hour', now())`,
  [email, co.code, S.E.schema, uid, createHash('sha256').update(resetTok).digest('hex')]);
m0 = mark();
const rs1 = await call('POST', '/auth/reset-password', { body: { token: resetTok, secret: S.pass } });
const rsc = await code(email, 'RESET', m0);
const rs2 = await call('POST', '/auth/reset-password', { body: { token: resetTok, secret: S.pass, twoFaCode: rsc } });
m0 = mark();
const back1 = await login(S.E.email);
const back = await login(S.E.email, S.pass, { twoFaToken: await code(email, 'LOGIN', m0) });
R.check('2E-3', 'empresa: recuperar a senha pelo link pede também o código da 2FA', rs1.status === 401 && rs1.body.error === 'TwoFaRequired' && rs2.status === 200 && back1.status === 401 && back.status === 200, `${rs1.status}/${rs2.status}/${back.status}`);
co.adm = tok(back);
m0 = mark();
await ok('POST', '/auth/two-factor/disable/request', { token: co.adm });
const off = await call('POST', '/auth/two-factor/disable', { token: co.adm, body: { code: await code(email, 'DISABLE', m0) } });
const plain = await login(S.E.email);
R.check('2E-4', 'empresa: desligar pede o código; depois entra só com a senha', off.status === 200 && off.body.enabled === false && plain.status === 200, `${off.status}/${plain.status}`);

/* ═══════════ 7. Super Admin: 2FA e configuração ═══════════ */
const cfg = await ok('GET', '/super-admin/security', { token: SA });
const badT = await call('PUT', '/super-admin/security', { token: SA, body: { waTemplate: 'Modelo Mau' } });
const goodT = await call('PUT', '/super-admin/security', { token: SA, body: { waTemplate: 'codigo_lps', waLang: 'pt_PT', codeMinutes: 10 } });
await call('PUT', '/super-admin/security', { token: SA, body: { waTemplate: cfg.config.waTemplate ?? '' } });
const noSA = await call('GET', '/super-admin/security', { token: co.adm });
R.check('SC-1', 'Super Admin configura canais e modelo do WhatsApp (validado); empresas não acedem', cfg.channels.email && cfg.channels.whatsapp && badT.status === 400 && goodT.status === 200 && goodT.body.config.waTemplate === 'codigo_lps' && noSA.status === 403, `${badT.status}/${goodT.status}/${noSA.status}`);
m0 = mark();
await ok('POST', '/auth/two-factor/setup', { token: SA, body: { method: 'EMAIL', target: saEmail } });
await ok('POST', '/auth/two-factor/setup/confirm', { token: SA, body: { code: await code(saEmail, 'SETUP', m0) } });
m0 = mark();
const s1 = await saLogin();
const s2 = await saLogin({ twoFaToken: await code(saEmail, 'LOGIN', m0) });
R.check('SC-2', 'Super Admin com 2FA: o login pede o código e entra com ele', s1.status === 401 && s1.body.error === 'TwoFaRequired' && s2.status === 200, `${s1.status}/${s2.status}`);
SA = tok(s2);
const stats = (await ok('GET', '/super-admin/security', { token: SA })).stats;
R.check('SC-3', 'painel de segurança conta as contas com 2FA ligada', stats.platform >= 1 && stats.total >= 1, JSON.stringify(stats));
await ok('POST', '/super-admin/security/disable-user', { token: SA, body: { who: saEmail } });
const s3 = await saLogin();
R.check('SC-4', 'desbloqueio pelo e-mail: volta a entrar só com a senha', s3.status === 200, s3.status);

await pub.query(`DELETE FROM nexus_public.platform_users WHERE email = $1`, [saEmail]);
await pub.end(); await co.db.end();
const sum = R.summary();
console.log(`\n${sum.passed}/${sum.total} verificações passaram`);
process.exit(sum.failed ? 1 : 0);
