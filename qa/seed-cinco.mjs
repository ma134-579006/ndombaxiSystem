/**
 * QA — cinco empresas FICTÍCIAS e independentes (só localhost), uma por tipo de operação:
 *   A supermercado · B grossista · C tecnologia · D serviços · E comércio eletrónico.
 * Uso: node qa/seed-cinco.mjs   →  qa/.cinco.json
 */
import fs from 'node:fs';
import { call, ok, jwtPayload } from './lib.mjs';

const PASS = 'QaTeste!2026x';
const STATE = process.env.QA_CINCO ?? 'qa/.cinco.json';
const DEFS = [
  { k: 'A', email: 'admin@super-palanca.qa.test', type: 'RETAIL', name: 'Super Palanca (QA)', nif: '5000100001', nProd: 600, nCli: 150, nSup: 30 },
  { k: 'B', email: 'admin@grossista-kuanza.qa.test', type: 'RETAIL', name: 'Grossista Kuanza (QA)', nif: '5000100002', nProd: 150, nCli: 100, nSup: 30 },
  { k: 'C', email: 'admin@tecno-mussulo.qa.test', type: 'RETAIL', name: 'Tecno Mussulo (QA)', nif: '5000100003', nProd: 120, nCli: 100, nSup: 10 },
  { k: 'D', email: 'admin@servicos-imbondeiro.qa.test', type: 'SERVICES', name: 'Serviços Imbondeiro (QA)', nif: '5000100004', nProd: 30, nCli: 100, nSup: 5 },
  { k: 'E', email: 'admin@loja-welwitschia.qa.test', type: 'RETAIL', name: 'Loja Welwitschia (QA)', nif: '5000100005', nProd: 100, nCli: 100, nSup: 8 },
];
const pick = (a, i) => a[i % a.length];

async function pool(n, conc, fn) {
  let next = 0; const out = [];
  await Promise.all(Array.from({ length: conc }, async () => { for (;;) { const i = next++; if (i >= n) return; out[i] = await fn(i); } }));
  return out;
}

async function tenant(d) {
  let r = await call('POST', '/onboarding/register-simple', { body: { email: d.email, password: PASS, planTier: 'ENTERPRISE', businessType: d.type } });
  let token;
  if (r.status < 300) token = r.body.tokens.accessToken;
  else {
    r = await call('POST', '/auth/login', { body: { email: d.email, password: PASS } });
    if (r.status >= 300) throw new Error(`${d.k}: ${JSON.stringify(r.body)}`);
    token = r.body.tokens?.accessToken ?? r.body.accessToken;
  }
  const s = await call('POST', '/onboarding/complete-setup', { token, body: { name: d.name, nif: d.nif } });
  // O setup pode trocar o token (código da empresa definitivo): volta a entrar.
  const l = await ok('POST', '/auth/login', { body: { email: d.email, password: PASS } });
  token = l.tokens?.accessToken ?? l.accessToken;
  return { token, jwt: jwtPayload(token), setup: s.status };
}

const out = {};
for (const d of DEFS) {
  const t0 = Date.now();
  const t = await tenant(d);
  const stores = await ok('GET', '/staff/stores', { token: t.token });
  const store = stores[0];
  // utilizadores por papel
  const users = {};
  const have = await ok('GET', '/staff/users', { token: t.token });
  const roles = [['gerente', 'STORE_MANAGER'], ['supervisor', 'SHIFT_SUPERVISOR'], ['caixa1', 'CASHIER'], ['caixa2', 'CASHIER'], ['atendente', 'ATTENDANT'], ['regional', 'REGIONAL_MANAGER']];
  for (const [nick, role] of roles) {
    const email = `${nick}@${d.email.split('@')[1]}`;
    const pin = String(100000 + [...(nick + d.k)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 899999, 7)).slice(0, 6);
    let u = have.find((x) => x.email === email);
    if (!u) {
      const r = await call('POST', '/staff/users', { token: t.token, body: { name: `QA ${nick} ${d.k}`, email, role, storeId: store.id, password: PASS, pin, mustResetPw: false } });
      if (r.status >= 300) { console.log(d.k, 'user', nick, r.status, JSON.stringify(r.body).slice(0, 200)); continue; }
      u = r.body.user ?? r.body;
    }
    users[nick] = { id: u.id, email, role, pin };
  }
  await pool(d.nSup, 6, (i) => call('POST', '/erp/suppliers', { token: t.token, body: { code: `F${d.k}${String(i).padStart(3, '0')}`, name: `Fornecedor ${d.k} ${i}`, nif: `54${d.k.charCodeAt(0)}${String(i).padStart(6, '0')}`, paymentTermsDays: pick([0, 15, 30, 60], i) } }));
  const products = (await pool(d.nProd, 8, async (i) => {
    const iva = i % 7 === 0 ? 'ISE' : 'NOR';
    const cost = d.k === 'C' ? 5000 + (i * 977) % 400000 : 50 + (i * 37) % 9000;
    const price = Math.round(cost * (1 + pick([0.08, 0.15, 0.25, 0.4], i)) * 100) / 100 + pick([0, 0.01, 0.05, 0.99, 0.5], i);
    const code = `${d.k}${String(i).padStart(5, '0')}`;
    const body = { code, barcode: `56${d.k.charCodeAt(0)}${String(100000000 + i).slice(-8)}`, name: `${pick(['Arroz', 'Óleo', 'Açúcar', 'Feijão', 'Água', 'Sabão', 'Leite', 'Pão'], i)} ${d.k} nº ${i}`, ivaCode: iva, ...(iva === 'ISE' ? { exemptionCode: 'M10' } : {}), unitPrice: price, costPrice: cost, stockQty: 0, unit: pick(['UN', 'KG', 'L', 'CX'], i), showOnline: d.k === 'E' || i % 5 === 0 };
    const r = await call('POST', '/pos/products', { token: t.token, body });
    if (r.status >= 300 && r.status !== 409 && i < 3) console.log(d.k, 'produto', r.status, JSON.stringify(r.body).slice(0, 300));
    return r.status < 300 ? { id: r.body.id, code, price, cost, iva } : null;
  })).filter(Boolean);
  if (!products.length) {
    const all = await ok('GET', '/pos/products/all', { token: t.token });
    for (const p of all) products.push({ id: p.id, code: p.code, price: Number(p.unit_price ?? p.unitPrice), cost: Number(p.cost_price ?? p.costPrice ?? 0), iva: p.iva_code ?? p.ivaCode });
  }
  if (d.k !== 'D') await pool(products.length, 8, (i) => call('POST', '/erp/stock/entry', { token: t.token, body: { productId: products[i].id, warehouseId: store.id, quantity: 200 + (i % 100), unitCost: products[i].cost } }));
  const customers = (await pool(d.nCli, 8, async (i) => {
    const r = await call('POST', '/pos/customers', { token: t.token, body: { name: `Cliente ${d.k} ${i}`, taxId: i % 3 === 0 ? `5${String(200000000 + d.k.charCodeAt(0) * 100000 + i).slice(-9)}` : undefined, email: `c${i}@${d.k.toLowerCase()}.clientes.qa.test`, phone: `9${String(30000000 + d.k.charCodeAt(0) * 10000 + i).slice(-8)}` } });
    return r.status < 300 ? r.body.id : null;
  })).filter(Boolean);
  out[d.k] = { email: d.email, name: d.name, schema: t.jwt.tenantSchema, code: t.jwt.companyCode ?? t.jwt.tenantCode, tenantId: t.jwt.tenantId, storeId: store.id, users, products, customers };
  console.log(`${d.k} ${d.name}: setup ${t.setup}, ${products.length} produtos, ${customers.length} clientes, ${Object.keys(users).length} utilizadores, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
out.pass = PASS;
fs.writeFileSync(STATE, JSON.stringify(out, null, 1));
