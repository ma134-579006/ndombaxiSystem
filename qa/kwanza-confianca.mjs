/**
 * QA — LPS Kwanza: cliente sem sessão, GPS obrigatório na compra, avaliações (só de quem
 * comprou), gostos, reclamações, política de devolução e congelamento do saldo do associado.
 * Uso: node qa/kwanza-confianca.mjs  (empresas B e C de qa/seed-cinco.mjs; só localhost)
 */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { call, ok, Report } from './lib.mjs';

const S = JSON.parse(fs.readFileSync(process.env.QA_CINCO ?? 'qa/.cinco.json', 'utf8'));
const R = new Report('kwanza-confianca');
const CODE = 'grossista-kuanza-qa', OTHER = 'tecno-mussulo-qa';
const ST = `/store/${CODE}`, K = '/kwanza', AK = '/ecommerce/kwanza';
const login = async (email) => { const r = await ok('POST', '/auth/login', { body: { email, password: S.pass } }); return r.tokens?.accessToken ?? r.accessToken; };
const adm = await login(S.B.email), admC = await login(S.C.email), caixa = await login(S.B.users.caixa1.email);
const geo = { geoLat: -8.83, geoLng: 13.23, geoAccuracy: 10, geoConsent: true };
const tag = String(Date.now()).slice(-7);
// Produto diferente em cada execução e política reposta: o teste é repetível.
const P = S.B.products[20 + (Number(tag) % 100)];
await ok('PUT', `${AK}/policy`, { token: adm, body: { returnDays: 7, text: null } });
await ok('POST', '/erp/stock/entry', { token: adm, body: { productId: P.id, warehouseId: S.B.storeId, quantity: 5, unitCost: P.cost } });

// produto publicado pela empresa, afiliação e publicação do associado
await ok('PATCH', `${AK}/products/${P.code}`, { token: adm, body: { published: true, percent: 10, mode: 'OPEN', allowMarkup: true, maxMarkupPct: 30, materials: [] } });
const a = await ok('POST', `${K}/auth/register`, { body: { name: 'Associada Confiança', phone: `96${tag}`, password: 'segredo123' } });
await ok('POST', `${K}/me/affiliations`, { token: a.token, body: { companyCode: CODE, productCode: P.code } });
const listing = (await ok('GET', `${K}/market`, { token: a.token })).find((l) => l.companyCode === CODE && l.productCode === P.code);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
await ok('PUT', `${K}/me/posts`, { token: a.token, body: { companyCode: CODE, productCode: P.code, price: listing.grossPrice, images: [PNG], published: true } });

// ── cliente normal: sem sessão ──
const pub = await call('GET', `${K}/market`);
const post = (pub.body ?? []).find?.((l) => l.productCode === P.code && l.associate?.code === a.associate.code);
R.check('KC-1', 'cliente SEM sessão vê os produtos publicados pelos associados', pub.status === 200 && !!post, `${pub.status} ${Array.isArray(pub.body) ? pub.body.length : ''} publicações`);
const soc0 = await call('GET', `${K}/social/${CODE}/${P.code}`);
R.check('KC-2', 'página do produto (sem sessão): estrelas, gostos e política de devolução por omissão (7 dias)', soc0.status === 200 && soc0.body.policy.returnDays === 7 && soc0.body.count === 0, JSON.stringify(soc0.body).slice(0, 160));

// ── GPS obrigatório na compra ──
const phone = `93${tag}`;
const buyer = (await ok('POST', `${ST}/auth/quick`, { body: { name: 'Cliente Confiança', phone } })).token;
const noGps = await call('POST', `${ST}/checkout`, { token: buyer, body: { affiliateCode: a.associate.code, lines: [{ productCode: P.code, quantity: 1 }] } });
R.check('KC-3', 'compra SEM localização GPS é recusada', noGps.status === 400 && /localiza|GPS/i.test(JSON.stringify(noGps.body)), `${noGps.status} ${JSON.stringify(noGps.body).slice(0, 140)}`);
const noConsent = await call('POST', `${ST}/checkout`, { token: buyer, body: { affiliateCode: a.associate.code, lines: [{ productCode: P.code, quantity: 1 }], ...geo, geoConsent: false } });
R.check('KC-4', 'compra sem consentimento da localização é recusada', noConsent.status === 400, noConsent.status);

// ── avaliações: só de quem comprou ──
const rev = (body) => call('POST', `${K}/social/${CODE}/${P.code}/review`, { body });
const early = await rev({ name: 'Cliente Confiança', phone, rating: 5, comment: 'Ainda não comprei' });
R.check('KC-5', 'quem não comprou não pode avaliar', early.status === 403, `${early.status} ${early.body?.message}`);
const order = await ok('POST', `${ST}/checkout`, { token: buyer, body: { affiliateCode: a.associate.code, lines: [{ productCode: P.code, quantity: 1 }], customerName: 'Cliente Confiança', customerPhone: phone, ...geo } });
const pend = await rev({ name: 'Cliente Confiança', phone, rating: 5 });
R.check('KC-6', 'encomenda ainda não paga não dá direito a avaliar', pend.status === 403, pend.status);
await ok('POST', `/ecommerce/orders/${order.id}/pay`, { token: adm });
const loc = await call('GET', `/ecommerce/orders/${order.id}/location`, { token: adm });
R.check('KC-7', 'a empresa tem a localização GPS exata do comprador', loc.status === 200 && (loc.body?.lat ?? loc.body?.geoLat) != null, JSON.stringify(loc.body).slice(0, 120));
const good = await rev({ name: 'Cliente Confiança', phone: `+244 ${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6)}`, rating: 4, comment: 'Chegou no dia. <script>alert(1)</script> Ótimo 👍' });
R.check('KC-8', 'depois de paga, quem comprou avalia (telefone com espaços e +244 aceite)', good.status < 300, `${good.status} ${JSON.stringify(good.body).slice(0, 120)}`);
for (const [name, body] of [['0 estrelas', { name: 'X Y', phone, rating: 0 }], ['6 estrelas', { name: 'X Y', phone, rating: 6 }], ['4,5 estrelas', { name: 'X Y', phone, rating: 4.5 }], ['sem nome', { name: '', phone, rating: 3 }], ['comentário de 5000 caracteres', { name: 'X Y', phone, rating: 3, comment: 'a'.repeat(5000) }]]) {
  const r = await rev(body); R.check('KC-9', `avaliação com ${name} é recusada`, r.status === 400, r.status);
}
await rev({ name: 'Cliente Confiança', phone, rating: 5, comment: 'Editei: excelente' });
const soc1 = (await ok('GET', `${K}/social/${CODE}/${P.code}`));
R.check('KC-10', 'reenviar edita a avaliação (uma por comprador): média 5,0 e 1 avaliação', soc1.count === 1 && soc1.rating === 5 && soc1.reviews[0].comment === 'Editei: excelente' && soc1.reviews[0].phone === undefined, JSON.stringify(soc1).slice(0, 220));

// ── gostos ──
const dev1 = randomUUID(), dev2 = randomUUID();
const re = (device, value) => call('POST', `${K}/social/${CODE}/${P.code}/react`, { body: { device, value } });
await re(dev1, 1); await re(dev1, 1); await re(dev2, -1);
let s = (await ok('GET', `${K}/social/${CODE}/${P.code}?device=${dev1}`));
R.check('KC-11', 'um gosto por dispositivo (repetir não soma); o outro dispositivo não gosta', s.likes === 1 && s.dislikes === 1 && s.mine === 1, `gostos ${s.likes} não gostos ${s.dislikes} meu ${s.mine}`);
await re(dev1, -1); s = (await ok('GET', `${K}/social/${CODE}/${P.code}?device=${dev1}`));
R.check('KC-12', 'trocar de gosto para não gosto', s.likes === 0 && s.dislikes === 2 && s.mine === -1, `${s.likes}/${s.dislikes}/${s.mine}`);
await re(dev1, 0); s = (await ok('GET', `${K}/social/${CODE}/${P.code}?device=${dev1}`));
const bad = [await re('x', 1), await re(dev1, 5), await call('POST', `${K}/social/${CODE}/NAO-EXISTE/react`, { body: { device: dev1, value: 1 } }), await call('POST', `${K}/social/empresa-que-nao-existe/${P.code}/react`, { body: { device: dev1, value: 1 } })];
R.check('KC-13', 'retirar a reação; dispositivo, valor, produto ou empresa inválidos são recusados', s.mine === 0 && s.dislikes === 1 && bad.every((r) => r.status >= 400 && r.status < 500), `${s.mine}/${s.dislikes} ${bad.map((r) => r.status).join(',')}`);

// ── política de devolução ──
const pol = await call('PUT', `${AK}/policy`, { token: adm, body: { returnDays: 15, text: 'Produto na embalagem original.\nReembolso em 5 dias úteis.' } });
const polBad = await call('PUT', `${AK}/policy`, { token: adm, body: { returnDays: 120 } });
const polCx = await call('PUT', `${AK}/policy`, { token: caixa, body: { returnDays: 1 } });
s = await ok('GET', `${K}/social/${CODE}/${P.code}`);
const sOther = await ok('GET', `${K}/social/${OTHER}/${S.C.products[0].code}`);
R.check('KC-14', 'a empresa define 15 dias; o produto mostra; 120 dias e o caixa são recusados; a outra empresa mantém a sua', pol.status < 300 && polBad.status === 400 && polCx.status === 403 && s.policy.returnDays === 15 && sOther.policy.returnDays === 7, `${pol.status}/${polBad.status}/${polCx.status} ${s.policy.returnDays} outra=${sOther.policy.returnDays}`);

// ── reclamações ──
const cl = await call('POST', `${K}/complaints`, { body: { companyCode: CODE, productCode: P.code, associateCode: a.associate.code, orderNumber: order.orderNumber, name: 'Cliente Confiança', phone, kind: 'DAMAGED', body: 'A caixa chegou amassada e o produto riscado.' } });
R.check('KC-15', 'cliente sem sessão abre uma reclamação e recebe um código', cl.status < 300 && /^[A-Z0-9]{8}$/.test(cl.body?.code ?? ''), `${cl.status} ${JSON.stringify(cl.body)}`);
for (const [name, body] of [['texto curto', { companyCode: CODE, name: 'A B', phone, kind: 'OTHER', body: 'curto' }], ['motivo inválido', { companyCode: CODE, name: 'A B', phone, kind: 'HACK', body: 'descrição suficiente' }], ['telefone inválido', { companyCode: CODE, name: 'A B', phone: '12', kind: 'OTHER', body: 'descrição suficiente' }], ['empresa inexistente', { companyCode: 'nao-existe', name: 'A B', phone, kind: 'OTHER', body: 'descrição suficiente' }]]) {
  const r = await call('POST', `${K}/complaints`, { body }); R.check('KC-16', `reclamação com ${name} é recusada`, r.status >= 400 && r.status < 500, r.status);
}
const mine = await ok('GET', `${AK}/complaints`, { token: adm });
const row = mine.find((c) => c.code === cl.body.code);
const theirs = await ok('GET', `${AK}/complaints`, { token: admC });
R.check('KC-17', 'a empresa vê a reclamação (com produto e associado); a outra empresa não', !!row && row.associate === 'Associada Confiança' && !theirs.some((c) => c.code === cl.body.code), JSON.stringify(row ?? null).slice(0, 200));
const steal = await call('PATCH', `${AK}/complaints/${row.id}`, { token: admC, body: { reply: 'intruso', status: 'RESOLVED' } });
const cx = await call('GET', `${AK}/complaints`, { token: caixa });
const ans = await call('PATCH', `${AK}/complaints/${row.id}`, { token: adm, body: { reply: 'Pedimos desculpa. Vamos trocar o produto amanhã.' } });
let tr = await ok('GET', `${K}/complaints/${cl.body.code.toLowerCase()}`);
R.check('KC-18', 'outra empresa não responde (404), o caixa não vê (403); a empresa responde e o cliente lê pelo código', steal.status === 404 && cx.status === 403 && ans.status < 300 && tr.status === 'ANSWERED' && /trocar/.test(tr.reply) && tr.phone === undefined, `${steal.status}/${cx.status}/${ans.status} ${tr.status}`);
await ok('PATCH', `${AK}/complaints/${row.id}`, { token: adm, body: { status: 'RESOLVED' } });
tr = await ok('GET', `${K}/complaints/${cl.body.code}`);
const nf = await call('GET', `${K}/complaints/ZZZZZZZZ`);
R.check('KC-19', 'marcar resolvida mantém a resposta; código desconhecido → 404', tr.status === 'RESOLVED' && /trocar/.test(tr.reply) && nf.status === 404, `${tr.status} ${nf.status}`);
const notes = await ok('GET', '/notifications', { token: adm });
R.check('KC-20', 'a empresa é avisada da reclamação e da avaliação', notes.items.some((i) => i.kind === 'KWANZA_COMPLAINT') && notes.items.some((i) => i.kind === 'KWANZA_REVIEW'), notes.items.slice(0, 4).map((i) => i.kind).join(','));

// ── avaliações no painel ──
const revs = await ok('GET', `${AK}/reviews`, { token: adm });
const rv = revs.find((r) => r.productCode === P.code);
await ok('PATCH', `${AK}/reviews/${rv.id}`, { token: adm, body: { reply: 'Obrigado pela preferência!' } });
s = await ok('GET', `${K}/social/${CODE}/${P.code}`);
const hideOther = await call('PATCH', `${AK}/reviews/${rv.id}`, { token: admC, body: { hidden: true } });
await ok('PATCH', `${AK}/reviews/${rv.id}`, { token: adm, body: { hidden: true } });
const s2 = await ok('GET', `${K}/social/${CODE}/${P.code}`);
R.check('KC-21', 'a empresa responde em público e pode ocultar (deixa de contar); outra empresa não mexe', s.reviews[0]?.reply === 'Obrigado pela preferência!' && hideOther.status === 404 && s2.count === 0 && s2.reviews.length === 0, `${s.reviews[0]?.reply} ${hideOther.status} ${s2.count}`);
await ok('PATCH', `${AK}/reviews/${rv.id}`, { token: adm, body: { hidden: false } });

// ── congelar o saldo do associado ──
const dash0 = await ok('GET', `${K}/me/dashboard`, { token: a.token });
const bal = dash0.companies.find((c) => c.companyCode === CODE)?.balance ?? 0;
await ok('POST', `${K}/me/accounts`, { token: a.token, body: { method: 'Transferência', bank: 'BAI', holder: 'Associada Confiança', details: 'AO06000000000000000000000' } });
const acc = (await ok('GET', `${K}/me/accounts`, { token: a.token }))[0];
const assoc = (await ok('GET', `${AK}/associates`, { token: adm })).find((x) => x.code === a.associate.code);
const fzOther = await call('POST', `${AK}/associates/${assoc.id}/freeze`, { token: admC, body: { reason: 'intruso' } });
const fzCx = await call('POST', `${AK}/associates/${assoc.id}/freeze`, { token: caixa, body: { reason: 'caixa' } });
const fzNo = await call('POST', `${AK}/associates/${assoc.id}/freeze`, { token: adm, body: { reason: '' } });
const fz = await call('POST', `${AK}/associates/${assoc.id}/freeze`, { token: adm, body: { reason: 'Reclamação em análise' } });
R.check('KC-22', 'a empresa congela com motivo; sem motivo, o caixa e outra empresa (associado alheio) são recusados', bal > 0 && fz.status < 300 && fzNo.status === 400 && fzCx.status === 403 && fzOther.status === 404, `saldo ${bal} ${fz.status}/${fzNo.status}/${fzCx.status}/${fzOther.status}`);
const wd = await call('POST', `${K}/me/withdrawals`, { token: a.token, body: { companyCode: CODE, amount: Math.min(bal, 100), accountId: acc.id } });
const dash1 = await ok('GET', `${K}/me/dashboard`, { token: a.token });
const an = await ok('GET', `${K}/me/notifications`, { token: a.token });
R.check('KC-23', 'com o saldo congelado o saque é recusado com o motivo; o associado é avisado e o saldo não se perde', wd.status === 400 && /congelado.*Reclamação em análise/.test(wd.body?.message ?? '') && dash1.frozen?.[CODE] === 'Reclamação em análise' && an.items.some((i) => i.kind === 'FREEZE') && dash1.companies.find((c) => c.companyCode === CODE)?.balance === bal, `${wd.status} ${wd.body?.message} saldo ${dash1.companies.find((c) => c.companyCode === CODE)?.balance}`);
const list = await ok('GET', `${AK}/freezes`, { token: adm });
const listC = await ok('GET', `${AK}/freezes`, { token: admC });
await ok('POST', `${AK}/associates/${assoc.id}/unfreeze`, { token: adm });
const wd2 = await call('POST', `${K}/me/withdrawals`, { token: a.token, body: { companyCode: CODE, amount: Math.min(bal, 100), accountId: acc.id } });
R.check('KC-24', 'lista de congelados só da própria empresa; descongelar volta a permitir o saque', list.some((f) => f.associateId === assoc.id) && listC.length === 0 && wd2.status < 300, `${list.length}/${listC.length} saque ${wd2.status} ${JSON.stringify(wd2.body).slice(0, 100)}`);

const s3 = R.summary(); fs.mkdirSync('qa/out', { recursive: true }); fs.writeFileSync('qa/out/kwanza-confianca.json', JSON.stringify(s3, null, 1));
console.log(`\n${s3.passed}/${s3.total} passaram; ${s3.failed} falharam`);
