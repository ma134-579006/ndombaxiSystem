import { PrismaClient, PlanTier } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// Preços mensais em KWANZAS (AOA) — realidade angolana.
const PLANS = [
  {
    tier: PlanTier.STARTER,
    name: 'Starter',
    priceKz: 15000,
    maxStores: 1,
    maxUsers: 5,
    maxProducts: 1000,
    maxTxPerMonth: 5000,
    modules: ['POS', 'STOCK'],
    tagline: 'Para começar o seu negócio',
    highlight: false,
    sortOrder: 1,
    isPublic: true,
  },
  {
    tier: PlanTier.BUSINESS,
    name: 'Business',
    priceKz: 45000,
    maxStores: 3,
    maxUsers: 20,
    maxProducts: 20000,
    maxTxPerMonth: 50000,
    modules: ['POS', 'STOCK', 'ERP', 'ECOMMERCE'],
    tagline: 'O mais escolhido pelas lojas',
    highlight: true,
    sortOrder: 2,
    isPublic: true,
  },
  {
    tier: PlanTier.ENTERPRISE,
    name: 'Enterprise',
    priceKz: 150000,
    maxStores: -1,
    maxUsers: -1,
    maxProducts: -1,
    maxTxPerMonth: -1,
    modules: ['POS', 'STOCK', 'ERP', 'ECOMMERCE', 'OPENMANUS'],
    tagline: 'Para grandes operações',
    highlight: false,
    sortOrder: 3,
    isPublic: true,
  },
  {
    tier: PlanTier.WHITE_LABEL,
    name: 'White-Label',
    priceKz: 0, // negociado
    maxStores: -1,
    maxUsers: -1,
    maxProducts: -1,
    maxTxPerMonth: -1,
    modules: ['POS', 'STOCK', 'ERP', 'ECOMMERCE', 'OPENMANUS', 'WHITE_LABEL'],
    tagline: 'A sua marca, o nosso motor',
    highlight: false,
    sortOrder: 4,
    isPublic: true,
  },
];

async function main(): Promise<void> {
  // Planos SaaS (§2.4)
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { tier: plan.tier },
      update: plan,
      create: plan,
    });
  }
  console.log(`Seeded ${PLANS.length} plans.`);

  // Super Admin bootstrap
  const email = (process.env.SUPER_ADMIN_EMAIL ?? 'admin@nexus-erp.ao').toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD ?? 'ChangeMe!Admin2025';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  await prisma.platformUser.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
    },
  });
  console.log(`Seeded super admin: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
