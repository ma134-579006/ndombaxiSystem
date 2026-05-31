import { PrismaClient, PlanTier } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const PLANS = [
  {
    tier: PlanTier.STARTER,
    name: 'Starter',
    priceUsd: 49,
    maxStores: 1,
    maxUsers: 5,
    maxProducts: 1000,
    maxTxPerMonth: 5000,
    modules: ['POS', 'STOCK'],
  },
  {
    tier: PlanTier.BUSINESS,
    name: 'Business',
    priceUsd: 149,
    maxStores: 3,
    maxUsers: 20,
    maxProducts: 20000,
    maxTxPerMonth: 50000,
    modules: ['POS', 'STOCK', 'ERP', 'ECOMMERCE'],
  },
  {
    tier: PlanTier.ENTERPRISE,
    name: 'Enterprise',
    priceUsd: 499,
    maxStores: -1,
    maxUsers: -1,
    maxProducts: -1,
    maxTxPerMonth: -1,
    modules: ['POS', 'STOCK', 'ERP', 'ECOMMERCE', 'OPENMANUS'],
  },
  {
    tier: PlanTier.WHITE_LABEL,
    name: 'White-Label',
    priceUsd: 0, // negociado
    maxStores: -1,
    maxUsers: -1,
    maxProducts: -1,
    maxTxPerMonth: -1,
    modules: ['POS', 'STOCK', 'ERP', 'ECOMMERCE', 'OPENMANUS', 'WHITE_LABEL'],
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
