// Cria uma LOJA DE DEMONSTRAÇÃO totalmente funcional (empresa + aprovação + produtos).
// Requer a API a correr (http://localhost:3000). Uso: pnpm demo
// Idempotente o suficiente: se a empresa já existir, tenta apenas (re)criar produtos.

const API = (process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '');
const SA_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'admin@ndombaxi.ao';
const SA_PASS = process.env.SUPER_ADMIN_PASSWORD || 'Ndombaxi!Admin2026';

const COMPANY = {
  name: 'Loja Demo Ndombaxi',
  companyCode: 'demo',
  nif: '5417000000',
  responsibleEmail: 'gestor@demo.ao',
  responsibleName: 'Gestor Demo',
  planTier: 'ENTERPRISE',
};

const PRODUCTS = [
  { code: 'P001', name: 'Arroz Branco 5kg', ivaCode: 'NOR', unitPrice: 4500, stockQty: 120, showOnline: true },
  { code: 'P002', name: 'Óleo Alimentar 1L', ivaCode: 'NOR', unitPrice: 1800, stockQty: 200, showOnline: true },
  { code: 'P003', name: 'Açúcar 2kg', ivaCode: 'NOR', unitPrice: 2200, stockQty: 90, showOnline: true },
  { code: 'P004', name: 'Água Mineral 1.5L', ivaCode: 'RED', unitPrice: 350, stockQty: 500, showOnline: true },
  { code: 'P005', name: 'Pão de Forma', ivaCode: 'NOR', unitPrice: 950, stockQty: 60, showOnline: true },
  { code: 'P006', name: 'Leite UHT 1L', ivaCode: 'NOR', unitPrice: 1200, stockQty: 150, showOnline: true },
];

async function req(method, path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const msg = data?.message ? (Array.isArray(data.message) ? data.message.join('; ') : data.message) : `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function main() {
  console.log(`→ API: ${API}`);

  // 1) Super Admin
  const sa = await req('POST', '/auth/super-admin/login', { email: SA_EMAIL, password: SA_PASS });
  console.log('✓ Super Admin autenticado');

  // 2) Registar a empresa de demonstração (idempotente: ignora se já existir)
  let companyId;
  let adminEmail = COMPANY.responsibleEmail;
  let tempPassword;
  try {
    const reg = await req('POST', '/onboarding/register', COMPANY);
    companyId = reg.companyId;
    adminEmail = reg.adminEmail;
    tempPassword = reg.temporaryPassword;
    console.log(`✓ Empresa demo registada (${reg.companyCode})`);
  } catch (e) {
    if (e.status === 409) console.log('• Empresa demo já existe — a continuar.');
    else throw e;
  }

  // 3) Aprovar (procura o id se não veio do registo)
  if (!companyId) {
    const list = await req('GET', '/super-admin/tenants?search=demo', undefined, sa.accessToken);
    companyId = Array.isArray(list) ? list.find((c) => c.code === 'demo')?.id : undefined;
  }
  if (companyId) {
    try {
      await req('POST', `/super-admin/tenants/${companyId}/approve`, {}, sa.accessToken);
      console.log('✓ Empresa aprovada (ACTIVE)');
    } catch (e) {
      console.log(`• Aprovação: ${e.message}`);
    }
  }

  // 4) Login da empresa e criação de produtos (só se tivermos a senha temporária)
  if (tempPassword) {
    try {
      const ca = await req('POST', '/auth/login', {
        companyCode: 'demo',
        email: adminEmail,
        password: tempPassword,
      });
      let created = 0;
      for (const p of PRODUCTS) {
        try {
          await req('POST', '/pos/products', p, ca.accessToken);
          created++;
        } catch (e) {
          if (e.status !== 409) console.log(`  • Produto ${p.code}: ${e.message}`);
        }
      }
      console.log(`✓ ${created} produtos criados`);
    } catch (e) {
      console.log(`• Login da empresa/produtos: ${e.message} (pode ser preciso trocar a senha no 1.º login)`);
    }
  } else {
    console.log('• Sem senha temporária (empresa já existia) — produtos não recriados automaticamente.');
  }

  console.log('\nLoja demo pronta. Abra a montra:  http://localhost:5174/?loja=demo');
}

main().catch((e) => {
  console.error(`\n[X] Falhou: ${e.message}`);
  console.error('   A API está a correr em ' + API + ' ?');
  process.exit(1);
});
