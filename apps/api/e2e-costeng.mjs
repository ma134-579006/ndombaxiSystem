const API = 'https://ndombaxi-api-img.onrender.com';
const SA = { email: process.env.SA_EMAIL, password: process.env.SA_PASS };
const PW = 'Teste1234!'; const rnd = () => Math.random().toString(36).slice(2, 7);
const nif = () => String(Math.floor(100000000 + Math.random() * 899999999));
const dec = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString());
async function call(m, p, { token, tenant, body } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`; if (tenant) h['X-Tenant-Code'] = tenant;
  let r, t; try { r = await fetch(API + p, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined }); t = await r.text(); } catch (e) { return { status: 0, d: e.message }; }
  let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, d };
}
const ok = (b) => b ? '✅' : '❌';
const sa = await call('POST', '/auth/super-admin/login', { body: SA });
const saTok = sa.d?.accessToken || sa.d?.tokens?.accessToken;
const email = `zzcost-${rnd()}@ndombaxitest.ao`;
const reg = await call('POST', '/onboarding/register-simple', { body: { email, password: PW, planTier: 'ENTERPRISE', businessType: 'RESTAURANT' } });
let tok = reg.d?.accessToken || reg.d?.tokens?.accessToken; const tid = dec(tok).tenantId;
await call('POST', '/onboarding/complete-setup', { token: tok, body: { name: 'ZZ Custos', nif: nif() } });
const li = await call('POST', '/auth/login', { body: { email, password: PW } });
tok = li.d?.accessToken || li.d?.tokens?.accessToken || tok; const code = li.d?.companyCode;
const A = { token: tok, tenant: code };

await call('POST', '/pos/products', { ...A, body: { code: 'CARNE', name: 'Carne kg', ivaCode: 'AUTO', costPrice: 500, stockQty: 100, sharedStock: true, isIngredient: true } });
await call('POST', '/pos/products', { ...A, body: { code: 'HAMB', name: 'Hamburguer', ivaCode: 'AUTO', unitPrice: 2000, stockQty: 0, sharedStock: true } });
const ings = (await call('GET', '/pos/products/ingredients', A)).d || [];
const carneId = ings.find(p => p.code === 'CARNE')?.id;
const hbId = ((await call('GET', '/pos/products', A)).d || []).find(p => p.code === 'HAMB')?.id;
await call('POST', `/restaurant/recipe/${hbId}`, { ...A, body: { items: [{ ingredientCode: 'CARNE', quantity: 1 }] } });

const hambCost = () => { return call('GET', '/restaurant/recipe/_x', A).then(() => null); };
const costOf = async (code, ingredient = false) => {
  const list = (await call('GET', ingredient ? '/pos/products/ingredients' : '/pos/products', A)).d || [];
  return Number(list.find(p => p.code === code)?.cost_price);
};
console.log(`Custo inicial — CARNE: ${await costOf('CARNE', true)}  HAMB: ${await costOf('HAMB')}  (esperado 500 / 500)`);

// ENTRADA de stock: +100 carne a 700/un -> CMP = (100*500 + 100*700)/200 = 600
const entry = await call('POST', '/erp/stock/entry', { ...A, body: { productId: carneId, warehouseId: 'ALL', quantity: 100, unitCost: 700 } });
console.log('Entrada de stock (100 carne @700):', entry.status);

const carneAfter = await costOf('CARNE', true);
const hambAfter = await costOf('HAMB');
console.log(`\nDepois da entrada — CARNE: ${carneAfter}  HAMB: ${hambAfter}`);
console.log(`1) CARNE com custo médio ponderado = 600: ${ok(Math.abs(carneAfter - 600) < 0.01)}`);
console.log(`2) HAMB recalculou-se SOZINHO para 600:  ${ok(Math.abs(hambAfter - 600) < 0.01)}  ← engenharia de custos automática`);

await call('DELETE', `/super-admin/tenants/${tid}`, { token: saTok });
console.log('\n(apagado)');
