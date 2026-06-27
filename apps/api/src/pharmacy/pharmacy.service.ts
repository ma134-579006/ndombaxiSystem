import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Farmácia (vertical PHARMACY): assenta no stock com LOTES/VALIDADES já existente.
 * O forte é o controlo de validade (medicamentos a expirar/expirados) e a marcação
 * de produtos sujeitos a receita. A venda continua a ser feita no caixa (POS).
 */
@Injectable()
export class PharmacyService {
  constructor(private readonly prisma: PrismaService) {}

  /** KPIs: lotes a expirar (≤30 dias), expirados, e produtos sujeitos a receita. */
  async metrics(schema: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const exp = await tx.$queryRaw<{ expiring: number; expired: number }[]>(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + 30 AND quantity > 0)::int AS expiring,
          COUNT(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE AND quantity > 0)::int AS expired
        FROM product_batches`);
      const rx = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM products WHERE is_active = TRUE AND requires_prescription = TRUE`);
      const low = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS n FROM stock_items si WHERE si.min_qty IS NOT NULL AND si.min_qty > 0 AND si.quantity <= si.min_qty`).catch(() => [{ n: 0 }]);
      return {
        expiring: exp[0]?.expiring ?? 0, expired: exp[0]?.expired ?? 0,
        prescription: rx[0]?.n ?? 0, lowStock: low[0]?.n ?? 0,
      };
    });
  }

  /** Lotes a expirar dentro de `days` dias (e já expirados), com o produto. */
  async expiring(schema: string, days = 30) {
    const d = Math.max(1, Math.min(365, Math.floor(days)));
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT b.id, b.batch_code, b.quantity, b.expiry_date,
               (b.expiry_date - CURRENT_DATE) AS days_left,
               p.name AS product_name, p.code AS product_code, p.active_ingredient
        FROM product_batches b JOIN products p ON p.id = b.product_id
        WHERE b.expiry_date IS NOT NULL AND b.quantity > 0 AND b.expiry_date <= CURRENT_DATE + ${d}
        ORDER BY b.expiry_date ASC LIMIT 500`));
  }
}
