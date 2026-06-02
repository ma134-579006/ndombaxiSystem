import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { round2 } from '@nexus/agt-xml';
import { PrismaService } from '../prisma/prisma.service';

export interface CashflowSummary {
  from: string;
  to: string;
  salesTotal: number;       // vendas não anuladas (c/ IVA)
  creditCreated: number;    // vendas a crédito criadas (não entraram em dinheiro)
  immediateSales: number;   // vendas liquidadas na hora = salesTotal − creditCreated
  debtCollected: number;    // recebimentos de contas a receber
  inflows: number;          // entradas = immediateSales + debtCollected
  outflows: number;         // saídas = gastos/despesas
  net: number;              // saldo do período = inflows − outflows
}

export interface CashflowPoint { day: string; inflow: number; outflow: number; net: number }

export interface CashflowForecast {
  basisDays: number;
  avgDailyInflow: number;
  avgDailyOutflow: number;
  projectedInflow30: number;   // média diária × 30
  projectedOutflow30: number;
  receivablesDueSoon: number;  // contas a receber que vencem nos próximos 30 dias
  projectedNet30: number;      // projInflow + dueSoon − projOutflow
}

/**
 * Fluxo de caixa da empresa: entradas (vendas liquidadas + cobrança de dívidas)
 * vs saídas (gastos/despesas), com previsão para os próximos 30 dias. Tudo
 * derivado de dados reais (facturas, contas a receber, gastos) — sem inventar.
 * Guardas to_regclass para tenants antigos sem as tabelas novas (contam 0).
 */
@Injectable()
export class CashflowService {
  constructor(private readonly prisma: PrismaService) {}

  private range(from?: string, to?: string): { from: Date; to: Date } {
    const toD = to ? new Date(to) : new Date();
    toD.setHours(23, 59, 59, 999);
    const fromD = from ? new Date(from) : new Date(toD.getTime() - 29 * 86400000);
    fromD.setHours(0, 0, 0, 0);
    return { from: fromD, to: toD };
  }

  private async tableExists(tx: Prisma.TransactionClient, name: string): Promise<boolean> {
    const r = await tx.$queryRaw<{ reg: string | null }[]>(
      Prisma.sql`SELECT to_regclass(${name})::text AS reg`,
    );
    return !!r[0]?.reg;
  }

  async summary(schema: string, from?: string, to?: string): Promise<CashflowSummary> {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, async (tx) => {
      const sales = await tx.$queryRaw<{ total: string }[]>(
        Prisma.sql`SELECT COALESCE(SUM(gross_total),0) AS total FROM invoices
                   WHERE status <> 'A' AND doc_type IN ('FT','FS')
                     AND system_entry_date BETWEEN ${f} AND ${t}`,
      );
      const salesTotal = Number(sales[0].total);

      let creditCreated = 0, debtCollected = 0;
      if (await this.tableExists(tx, 'receivables')) {
        const cc = await tx.$queryRaw<{ total: string }[]>(
          Prisma.sql`SELECT COALESCE(SUM(original_amount),0) AS total FROM receivables
                     WHERE created_at BETWEEN ${f} AND ${t}`,
        );
        creditCreated = Number(cc[0].total);
      }
      if (await this.tableExists(tx, 'receivable_payments')) {
        const dc = await tx.$queryRaw<{ total: string }[]>(
          Prisma.sql`SELECT COALESCE(SUM(amount),0) AS total FROM receivable_payments
                     WHERE paid_at BETWEEN ${f} AND ${t}`,
        );
        debtCollected = Number(dc[0].total);
      }

      let outflows = 0;
      if (await this.tableExists(tx, 'expenses')) {
        const ex = await tx.$queryRaw<{ total: string }[]>(
          Prisma.sql`SELECT COALESCE(SUM(amount),0) AS total FROM expenses
                     WHERE expense_date BETWEEN ${f}::date AND ${t}::date`,
        );
        outflows += Number(ex[0].total);
      }
      if (await this.tableExists(tx, 'payable_payments')) {
        const pp = await tx.$queryRaw<{ total: string }[]>(
          Prisma.sql`SELECT COALESCE(SUM(amount),0) AS total FROM payable_payments
                     WHERE paid_at BETWEEN ${f} AND ${t}`,
        );
        outflows += Number(pp[0].total);
      }

      const immediateSales = round2(salesTotal - creditCreated);
      const inflows = round2(immediateSales + debtCollected);
      const net = round2(inflows - outflows);
      return {
        from: f.toISOString(), to: t.toISOString(),
        salesTotal: round2(salesTotal), creditCreated: round2(creditCreated),
        immediateSales, debtCollected: round2(debtCollected),
        inflows, outflows: round2(outflows), net,
      };
    });
  }

  /** Série diária de entradas vs saídas (para o gráfico). */
  async series(schema: string, from?: string, to?: string): Promise<CashflowPoint[]> {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, async (tx) => {
      const map = new Map<string, { inflow: number; outflow: number }>();
      const bump = (day: string, key: 'inflow' | 'outflow', v: number) => {
        const cur = map.get(day) ?? { inflow: 0, outflow: 0 };
        cur[key] = round2(cur[key] + v);
        map.set(day, cur);
      };

      const sales = await tx.$queryRaw<{ day: Date; total: string }[]>(
        Prisma.sql`SELECT date_trunc('day', system_entry_date) AS day, COALESCE(SUM(gross_total),0) AS total
                   FROM invoices WHERE status <> 'A' AND doc_type IN ('FT','FS')
                     AND system_entry_date BETWEEN ${f} AND ${t} GROUP BY 1`,
      );
      for (const r of sales) bump(r.day.toISOString().slice(0, 10), 'inflow', Number(r.total));

      if (await this.tableExists(tx, 'receivables')) {
        const cc = await tx.$queryRaw<{ day: Date; total: string }[]>(
          Prisma.sql`SELECT date_trunc('day', created_at) AS day, COALESCE(SUM(original_amount),0) AS total
                     FROM receivables WHERE created_at BETWEEN ${f} AND ${t} GROUP BY 1`,
        );
        for (const r of cc) bump(r.day.toISOString().slice(0, 10), 'inflow', -Number(r.total));
      }
      if (await this.tableExists(tx, 'receivable_payments')) {
        const dc = await tx.$queryRaw<{ day: Date; total: string }[]>(
          Prisma.sql`SELECT date_trunc('day', paid_at) AS day, COALESCE(SUM(amount),0) AS total
                     FROM receivable_payments WHERE paid_at BETWEEN ${f} AND ${t} GROUP BY 1`,
        );
        for (const r of dc) bump(r.day.toISOString().slice(0, 10), 'inflow', Number(r.total));
      }
      if (await this.tableExists(tx, 'expenses')) {
        const ex = await tx.$queryRaw<{ day: string; total: string }[]>(
          Prisma.sql`SELECT to_char(expense_date,'YYYY-MM-DD') AS day, COALESCE(SUM(amount),0) AS total
                     FROM expenses WHERE expense_date BETWEEN ${f}::date AND ${t}::date GROUP BY 1`,
        );
        for (const r of ex) bump(r.day, 'outflow', Number(r.total));
      }
      if (await this.tableExists(tx, 'payable_payments')) {
        const pp = await tx.$queryRaw<{ day: Date; total: string }[]>(
          Prisma.sql`SELECT date_trunc('day', paid_at) AS day, COALESCE(SUM(amount),0) AS total
                     FROM payable_payments WHERE paid_at BETWEEN ${f} AND ${t} GROUP BY 1`,
        );
        for (const r of pp) bump(r.day.toISOString().slice(0, 10), 'outflow', Number(r.total));
      }

      return [...map.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, v]) => ({ day, inflow: round2(v.inflow), outflow: round2(v.outflow), net: round2(v.inflow - v.outflow) }));
    });
  }

  /** Previsão para os próximos 30 dias (médias dos últimos 30 + dívidas a vencer). */
  async forecast(schema: string): Promise<CashflowForecast> {
    const basisDays = 30;
    const to = new Date();
    const from = new Date(to.getTime() - (basisDays - 1) * 86400000);
    const s = await this.summary(schema, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));

    let receivablesDueSoon = 0;
    await this.prisma.runInTenant(schema, async (tx) => {
      if (await this.tableExists(tx, 'receivables')) {
        const due = await tx.$queryRaw<{ total: string }[]>(
          Prisma.sql`SELECT COALESCE(SUM(original_amount - paid_amount),0) AS total FROM receivables
                     WHERE status NOT IN ('PAID','CANCELLED') AND due_date IS NOT NULL
                       AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30`,
        );
        receivablesDueSoon = Number(due[0].total);
      }
    });

    const avgDailyInflow = round2(s.inflows / basisDays);
    const avgDailyOutflow = round2(s.outflows / basisDays);
    const projectedInflow30 = round2(avgDailyInflow * 30);
    const projectedOutflow30 = round2(avgDailyOutflow * 30);
    const projectedNet30 = round2(projectedInflow30 + receivablesDueSoon - projectedOutflow30);
    return {
      basisDays, avgDailyInflow, avgDailyOutflow,
      projectedInflow30, projectedOutflow30,
      receivablesDueSoon: round2(receivablesDueSoon), projectedNet30,
    };
  }
}
