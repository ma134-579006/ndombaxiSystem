import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { round2 } from '@nexus/agt-xml';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAuditService } from '../cashbox/tenant-audit.service';

export interface CommissionRow {
  userId: string;
  name: string;
  rate: number;       // % comissão
  sales: number;      // vendas (c/ IVA) no período
  salesCount: number;
  commission: number; // sales × rate / 100
}

export interface CommissionReport {
  from: string;
  to: string;
  rows: CommissionRow[];
  totalSales: number;
  totalCommission: number;
}

type Actor = { id: string | null; name: string | null };

/**
 * Comissões de vendedores: por cada operador (cashier das facturas), soma as
 * vendas do período e aplica a % de comissão configurada no utilizador.
 */
@Injectable()
export class CommissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: TenantAuditService,
  ) {}

  private range(from?: string, to?: string): { from: Date; to: Date } {
    const toD = to ? new Date(to) : new Date();
    toD.setHours(23, 59, 59, 999);
    const fromD = from ? new Date(from) : new Date(toD.getTime() - 29 * 86400000);
    fromD.setHours(0, 0, 0, 0);
    return { from: fromD, to: toD };
  }

  private async hasRateColumn(tx: Prisma.TransactionClient): Promise<boolean> {
    const r = await tx.$queryRaw<{ ok: number }[]>(
      Prisma.sql`SELECT 1 AS ok FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'users'
                   AND column_name = 'commission_rate' LIMIT 1`,
    );
    return r.length > 0;
  }

  async report(schema: string, from?: string, to?: string): Promise<CommissionReport> {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, async (tx) => {
      const hasRate = await this.hasRateColumn(tx);
      const rateExpr = hasRate ? Prisma.sql`COALESCE(u.commission_rate, 0)` : Prisma.sql`0`;
      const rows = await tx.$queryRaw<{ user_id: string; name: string; rate: number; sales: number; n: number }[]>(
        Prisma.sql`
          SELECT i.cashier_id AS user_id,
                 COALESCE(u.name, u.email, '—') AS name,
                 ${rateExpr}::float AS rate,
                 ROUND(SUM(i.gross_total), 2)::float AS sales,
                 COUNT(*)::int AS n
          FROM invoices i LEFT JOIN users u ON u.id = i.cashier_id
          WHERE i.status <> 'A' AND i.doc_type IN ('FT','FS')
            AND i.cashier_id IS NOT NULL
            AND i.system_entry_date BETWEEN ${f} AND ${t}
          GROUP BY i.cashier_id, u.name, u.email${hasRate ? Prisma.sql`, u.commission_rate` : Prisma.empty}
          ORDER BY sales DESC`,
      );

      let totalSales = 0, totalCommission = 0;
      const out: CommissionRow[] = rows.map((r) => {
        const sales = Number(r.sales);
        const rate = Number(r.rate);
        const commission = round2((sales * rate) / 100);
        totalSales += sales; totalCommission += commission;
        return { userId: r.user_id, name: r.name, rate, sales: round2(sales), salesCount: Number(r.n), commission };
      });
      return {
        from: f.toISOString(), to: t.toISOString(),
        rows: out, totalSales: round2(totalSales), totalCommission: round2(totalCommission),
      };
    });
  }

  /** Define a % de comissão de um vendedor (auditado). */
  async setRate(schema: string, userId: string, rate: number, actor: Actor): Promise<{ userId: string; rate: number }> {
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new BadRequestException('Percentagem inválida (0–100).');
    }
    const r = round2(rate);
    return this.prisma.runInTenant(schema, async (tx) => {
      if (!(await this.hasRateColumn(tx))) {
        throw new BadRequestException('Empresa criada antes desta versão — recrie/atualize o esquema para usar comissões.');
      }
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`UPDATE users SET commission_rate = ${r} WHERE id = ${userId}::uuid RETURNING id`,
      );
      if (rows.length === 0) throw new BadRequestException('Utilizador não encontrado.');
      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name,
        action: 'COMMISSION_RATE_SET', entity: 'user', entityId: userId,
        details: { rate: r },
      });
      return { userId, rate: r };
    });
  }
}
