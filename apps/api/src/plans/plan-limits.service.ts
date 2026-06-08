import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Resource = 'stores' | 'users' | 'products';

/**
 * Faz cumprir os limites do PLANO da empresa (multi-loja / freemium):
 * máx. lojas / utilizadores / produtos. -1 = ilimitado. Conta os recursos
 * ACTIVOS no schema do tenant. NUNCA se aplica a vendas/transações.
 * O plano efectivo é o da subscrição ACTIVA (se houver), senão o da empresa.
 */
@Injectable()
export class PlanLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanCreate(schema: string, resource: Resource): Promise<void> {
    const company = await this.prisma.company.findUnique({
      where: { schemaName: schema },
      include: {
        plan: true,
        subscriptions: {
          where: { status: 'ACTIVE' },
          include: { plan: true },
          orderBy: { expiresAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!company) return; // sem empresa conhecida → não bloqueia
    const plan = company.subscriptions[0]?.plan ?? company.plan;
    if (!plan) return;

    const limit = resource === 'stores' ? plan.maxStores
      : resource === 'users' ? plan.maxUsers
        : plan.maxProducts;
    if (limit == null || limit < 0) return; // -1 = ilimitado

    const count = await this.prisma.runInTenant(schema, async (tx) => {
      const q = resource === 'stores'
        ? Prisma.sql`SELECT COUNT(*)::int AS n FROM stores WHERE is_active = TRUE`
        : resource === 'users'
          ? Prisma.sql`SELECT COUNT(*)::int AS n FROM users WHERE is_active = TRUE`
          : Prisma.sql`SELECT COUNT(*)::int AS n FROM products WHERE is_active = TRUE`;
      const rows = await tx.$queryRaw<{ n: number }[]>(q);
      return rows[0]?.n ?? 0;
    });

    if (count >= limit) {
      const label = resource === 'stores' ? 'lojas' : resource === 'users' ? 'utilizadores' : 'produtos';
      throw new BadRequestException(
        `Atingiu o limite do seu plano (${limit} ${label}). Atualize o plano em "Subscrição & Plano" para adicionar mais.`,
      );
    }
  }
}
