/**
 * QA — cria um GRUPO EMPRESARIAL FICTÍCIO de grande dimensão na API local.
 *
 * O sistema é multi-empresa por schema (tenant). Modelamos:
 *   • tenant A "Grupo Kwanza Distribuição (QA)": 1 sede/distribuidora, 3
 *     supermercados, 2 lojas de retalho, 1 armazém central (lojas do tenant);
 *   • tenant B "Kwanza Serviços (QA)": empresa de serviços — também serve para
 *     provar o ISOLAMENTO entre empresas.
 * Utilizadores com todos os papéis do RBAC real (COMPANY_ADMIN..ATTENDANT).
 * Contabilista/compras/auditor NÃO existem como papéis no sistema: ficam
 * mapeados para o papel real mais próximo e isso fica no relatório.
 *
 * Todos os dados são sintéticos, com domínio `.qa.test`. Uso:
 *   node qa/seed-empresa.mjs [nProdutos=1500] [nClientes=1000]
 */
import fs from 'node:fs';
import { call, ok, jwtPayload, uuid } from './lib.mjs';

const N_PROD = Number(process.argv[2] ?? 1500);
const N_CLI = Number(process.argv[3] ?? 1000);
const STATE = process.env.QA_STATE ?? 'qa/.state.json';
const PASS = 'QaTeste!2026x';

async function tenant(email, businessType) {
  let r = await call('POST', '/onboarding/register-simple', { body: { email, password: PASS, planTier: 'ENTERPRISE', businessType } });
  if (r.status >= 300) {
    // Já existe: entra com a mesma conta.
    r = await call('POST', '/auth/login', { body: { email, password: PASS } });
    if (r.status >= 300) throw new Error(`tenant ${email}: ${JSON.stringify(r.body)}`);
    return { token: r.body.tokens?.accessToken ?? r.body.accessToken, code: jwtPayload(r.body.tokens?.accessToken ?? r.body.accessToken).tenantSchema };
  }
  return { token: r.body.tokens.accessToken, code: r.body.companyCode };
}

const CATS = [
  ['Mercearia', 'NOR'], ['Bebidas', 'NOR'], ['Lacticínios', 'NOR'], ['Higiene', 'NOR'],
  ['Electrónica', 'NOR'], ['Cesta básica', 'ISE'], ['Medicamentos OTC', 'ISE'], ['Talho', 'NOR'],
];
const UNITS = ['UN', 'KG', 'L', 'CX'];
const pick = (a, i) => a[i % a.length];

async function main() {
  const t0 = Date.now();
  const A = await tenant('admin@grupo-kwanza.qa.test', 'RETAIL');
  const B = await tenant('admin@kwanza-servicos.qa.test', 'SERVICES');
  const pa = jwtPayload(A.token);

  // Setup obrigatório (nome, NIF fictício).
  await call('POST', '/onboarding/complete-setup', { token: A.token, body: { name: 'Grupo Kwanza Distribuição (QA)', nif: '5000000001' } });
  await call('POST', '/onboarding/complete-setup', { token: B.token, body: { name: 'Kwanza Serviços (QA)', nif: '5000000002' } });

  // Lojas do grupo.
  const storesWanted = [
    ['SEDE', 'Sede / Distribuidora'], ['SUP1', 'Supermercado Talatona'], ['SUP2', 'Supermercado Viana'],
    ['SUP3', 'Supermercado Cazenga'], ['RET1', 'Loja Retalho Maianga'], ['RET2', 'Loja Retalho Benfica'],
    ['ARM', 'Armazém Central'],
  ];
  const existing = await ok('GET', '/staff/stores', { token: A.token });
  const stores = {};
  for (const s of existing) stores[s.code] = s.id;
  for (const [code, name] of storesWanted) {
    if (stores[code]) continue;
    const r = await call('POST', '/staff/stores', { token: A.token, body: { code, name, address: `${name}, Luanda (fictício)` } });
    if (r.status < 300) stores[code] = r.body.id;
    else console.log('loja', code, r.status, JSON.stringify(r.body).slice(0, 200));
  }

  // Utilizadores por papel (PIN de 6 dígitos para a caixa).
  const roles = [
    ['gestor', 'REGIONAL_MANAGER', null], ['gerente-sup1', 'STORE_MANAGER', 'SUP1'],
    ['supervisor-sup1', 'SHIFT_SUPERVISOR', 'SUP1'], ['auditor', 'ATTENDANT', null],
    ['contabilista', 'ATTENDANT', null], ['compras', 'STORE_MANAGER', 'ARM'],
    ['stock-arm', 'STORE_MANAGER', 'ARM'], ['limitado', 'ATTENDANT', 'RET1'],
  ];
  for (let i = 1; i <= 12; i++) roles.push([`caixa${i}`, 'CASHIER', pick(['SUP1', 'SUP2', 'SUP3', 'RET1', 'RET2', 'SEDE'], i - 1)]);
  const users = {};
  const list = await ok('GET', '/staff/users', { token: A.token });
  for (const u of list) users[u.email] = u;
  for (const [nick, role, store] of roles) {
    const email = `${nick}@grupo-kwanza.qa.test`;
    // PIN determinístico por utilizador (reexecuções usam sempre o mesmo).
    const pin = String(100000 + ([...nick].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 899999, 7))).slice(0, 6);
    if (!users[email]) {
      const r = await call('POST', '/staff/users', { token: A.token, body: {
        name: `QA ${nick}`, email, role, storeId: store ? stores[store] : undefined, password: PASS, pin, mustResetPw: false,
      } });
      if (r.status >= 300) { console.log('user', nick, r.status, JSON.stringify(r.body).slice(0, 200)); continue; }
      users[email] = { ...r.body.user ?? r.body, pin };
    }
    else await call('POST', `/staff/users/${users[email].id}/set-pin`, { token: A.token, body: { pin } });
    users[email].role = role; users[email].store = store; users[email].nick = nick; users[email].pin = pin;
  }

  // Fornecedores.
  for (let i = 1; i <= 8; i++) {
    await call('POST', '/erp/suppliers', { token: A.token, body: { name: `Fornecedor QA ${i}`, nif: `54${String(i).padStart(8, '0')}`, paymentTermsDays: pick([0, 15, 30, 60], i) } });
  }

  // Catálogo.
  const products = [];
  const conc = 8;
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= N_PROD) return;
      const [cat, iva] = pick(CATS, i);
      const cost = 100 + ((i * 37) % 9000);
      const margin = pick([0.08, 0.15, 0.25, 0.4, 0.6], i);
      const code = `QA${String(i).padStart(6, '0')}`;
      const body = {
        code, barcode: `560${String(1000000000 + i).slice(-9)}${i % 10}`,
        name: `${cat} artigo ${i}`, brand: pick(['Kwanza', 'Palanca', 'Imbondeiro', 'Mussulo'], i),
        ivaCode: iva, ...(iva === 'ISE' ? { exemptionCode: cat.startsWith('Medic') ? 'M11' : 'M10' } : {}),
        unitPrice: Math.round(cost * (1 + margin)), costPrice: cost,
        stockQty: 0, unit: pick(UNITS, i),
      };
      const r = await call('POST', '/pos/products', { token: A.token, body });
      if (r.status < 300) products.push({ id: r.body.id, code, price: body.unitPrice, cost, iva });
      else if (r.status !== 409 && i < 5) console.log('produto', code, r.status, JSON.stringify(r.body).slice(0, 300));
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));

  // Se já existiam, lê o catálogo.
  {
    const all = await ok('GET', '/pos/products/all', { token: A.token });
    for (const p of all) if (p.code?.startsWith('QA') && !products.find((x) => x.code === p.code)) products.push({ id: p.id, code: p.code, price: Number(p.unit_price ?? p.unitPrice), cost: Number(p.cost_price ?? p.costPrice ?? 0), iva: p.iva_code ?? p.ivaCode });
  }

  // Stock inicial por loja (entradas com custo).
  next = 0;
  const shops = ['SUP1', 'SUP2', 'SUP3', 'RET1', 'RET2', 'SEDE', 'ARM'].filter((s) => stores[s]);
  const entries = [];
  for (const p of products.slice(0, Math.min(products.length, 400))) for (const s of shops) entries.push([p, s]);
  async function stockWorker() {
    for (;;) {
      const i = next++;
      if (i >= entries.length) return;
      const [p, s] = entries[i];
      const qty = s === 'ARM' ? 1000 : 50 + (i % 50);
      const r = await call('POST', '/erp/stock/entry', { token: A.token, body: { productId: p.id, warehouseId: stores[s], quantity: qty, unitCost: p.cost } });
      if (r.status >= 300 && i < 3) console.log('entrada', r.status, JSON.stringify(r.body).slice(0, 300));
    }
  }
  await Promise.all(Array.from({ length: conc }, stockWorker));

  // Clientes.
  next = 0;
  const customers = [];
  async function cliWorker() {
    for (;;) {
      const i = next++;
      if (i >= N_CLI) return;
      const r = await call('POST', '/pos/customers', { token: A.token, body: {
        name: `Cliente QA ${i}`, taxId: i % 3 === 0 ? `5${String(100000000 + i).slice(-9)}` : undefined,
        email: `cliente${i}@clientes.qa.test`, phone: `9${String(20000000 + i).slice(-8)}`, address: `Rua Fictícia ${i}, Luanda`,
      } });
      if (r.status < 300) customers.push(r.body.id);
      else if (i < 3) console.log('cliente', r.status, JSON.stringify(r.body).slice(0, 300));
    }
  }
  await Promise.all(Array.from({ length: conc }, cliWorker));

  if (customers.length < 50) {
    const lc = await ok('GET', '/pos/customers?limit=5000&q=Cliente QA', { token: A.token });
    for (const x of lc.items ?? lc) if (!customers.includes(x.id)) customers.push(x.id);
  }
  const state = { A: { token: A.token, schema: pa.tenantSchema, code: A.code }, B: { token: B.token, schema: jwtPayload(B.token).tenantSchema, code: B.code }, stores, users, products, customers, pass: PASS };
  fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
  console.log(`OK: ${Object.keys(stores).length} lojas, ${Object.keys(users).length} utilizadores, ${products.length} produtos, ${customers.length} clientes, ${entries.length} entradas de stock em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
