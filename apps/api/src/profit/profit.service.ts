import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ProfitSummary {
  from: string;
  to: string;
  salesGross: number; // vendas com IVA
  salesNet: number; // vendas sem IVA (base tributável)
  ivaTotal: number; // IVA cobrado
  costTotal: number; // custo das mercadorias vendidas (CMV)
  grossProfit: number; // lucro bruto = vendas líquidas − custo
  marginPct: number; // margem bruta % sobre vendas líquidas
  otherExpenses: number; // despesas operacionais reais do período (módulo Despesas)
  netProfit: number; // lucro líquido = bruto − despesas
  salesCount: number;
  ticketAvg: number; // venda média
  cancelledCount: number; // nº de vendas anuladas no período
  cancelledAmount: number; // valor (c/ IVA) anulado no período
}

export interface ProfitPoint {
  bucket: string;
  salesNet: number;
  cost: number;
  profit: number;
}

export interface ProfitProduct {
  productCode: string;
  description: string;
  qty: number;
  salesNet: number;
  cost: number;
  profit: number;
  marginPct: number;
}

export interface ProfitAbcRow {
  productCode: string;
  description: string;
  sales: number;
  sharePct: number;
  cumulativePct: number;
  abcClass: 'A' | 'B' | 'C';
}

/**
 * Lucros da empresa (gestor): vendas, custo (CMV), lucro bruto e líquido,
 * num período [from, to]. Só conta facturas NÃO anuladas (status != 'A').
 * O lucro bruto = vendas líquidas − custo das mercadorias vendidas; o líquido
 * subtrai despesas aproximadas (sangrias de caixa) — base honesta e auditável.
 */
@Injectable()
export class ProfitService {
  constructor(private readonly prisma: PrismaService) {}

  private range(from?: string, to?: string): { from: Date; to: Date } {
    const toD = to ? new Date(to) : new Date();
    toD.setHours(23, 59, 59, 999);
    const fromD = from ? new Date(from) : new Date(toD.getTime() - 29 * 86400000);
    fromD.setHours(0, 0, 0, 0);
    return { from: fromD, to: toD };
  }

  async summary(schema: string, from?: string, to?: string): Promise<ProfitSummary> {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<
        { sales_net: string; iva: string; sales_gross: string; cost: string; n: string }[]
      >(
        Prisma.sql`
          SELECT COALESCE(SUM(ii.net_amount),0) AS sales_net,
                 COALESCE(SUM(ii.iva_amount),0) AS iva,
                 COALESCE(SUM(ii.gross_amount),0) AS sales_gross,
                 COALESCE(SUM(ii.unit_cost * ii.quantity),0) AS cost,
                 COUNT(DISTINCT i.id) AS n
          FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
          WHERE i.status <> 'A' AND i.doc_type IN ('FT','FS')
            AND i.system_entry_date BETWEEN ${f} AND ${t}`,
      );
      const r = rows[0];
      const salesNet = Number(r.sales_net);
      const ivaTotal = Number(r.iva);
      const salesGross = Number(r.sales_gross);
      const costTotal = Number(r.cost);
      const salesCount = Number(r.n);

      // Despesas operacionais reais do período (renda, salários, energia…),
      // registadas no módulo de Despesas. Guarda to_regclass para tenants
      // antigos que ainda não tenham a tabela `expenses` (devolve 0).
      let otherExpenses = 0;
      const hasExpenses = await tx.$queryRaw<{ reg: string | null }[]>(
        Prisma.sql`SELECT to_regclass('expenses')::text AS reg`,
      );
      if (hasExpenses[0]?.reg) {
        const exp = await tx.$queryRaw<{ total: string }[]>(
          Prisma.sql`SELECT COALESCE(SUM(amount),0) AS total FROM expenses
                     WHERE expense_date BETWEEN ${f}::date AND ${t}::date`,
        );
        otherExpenses = Number(exp[0].total);
      }

      // Vendas anuladas no período (status 'A') — mostradas no dashboard/lucros.
      const canc = await tx.$queryRaw<{ amount: string; n: string }[]>(
        Prisma.sql`SELECT COALESCE(SUM(gross_total),0) AS amount, COUNT(*)::int AS n
                   FROM invoices
                   WHERE status = 'A' AND doc_type IN ('FT','FS')
                     AND system_entry_date BETWEEN ${f} AND ${t}`,
      );
      const cancelledAmount = Number(canc[0].amount);
      const cancelledCount = Number(canc[0].n);

      const grossProfit = round2(salesNet - costTotal);
      const netProfit = round2(grossProfit - otherExpenses);
      const marginPct = salesNet > 0 ? round2((grossProfit / salesNet) * 100) : 0;
      const ticketAvg = salesCount > 0 ? round2(salesGross / salesCount) : 0;

      return {
        from: f.toISOString(), to: t.toISOString(),
        salesGross: round2(salesGross), salesNet: round2(salesNet), ivaTotal: round2(ivaTotal),
        costTotal: round2(costTotal), grossProfit, marginPct, otherExpenses: round2(otherExpenses),
        netProfit, salesCount, ticketAvg,
        cancelledCount, cancelledAmount: round2(cancelledAmount),
      };
    });
  }

  /** Série temporal (granularidade automática: dia até 60d, senão semana). */
  async series(schema: string, from?: string, to?: string): Promise<ProfitPoint[]> {
    const { from: f, to: t } = this.range(from, to);
    const spanDays = Math.ceil((t.getTime() - f.getTime()) / 86400000);
    const gran = spanDays <= 62 ? 'day' : spanDays <= 366 ? 'week' : 'month';
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<ProfitPoint[]>(
        Prisma.sql`
          SELECT to_char(date_trunc(${gran}, i.system_entry_date), 'YYYY-MM-DD') AS bucket,
                 ROUND(SUM(ii.net_amount), 2)::float AS "salesNet",
                 ROUND(SUM(ii.unit_cost * ii.quantity), 2)::float AS cost,
                 ROUND(SUM(ii.net_amount) - SUM(ii.unit_cost * ii.quantity), 2)::float AS profit
          FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
          WHERE i.status <> 'A' AND i.doc_type IN ('FT','FS')
            AND i.system_entry_date BETWEEN ${f} AND ${t}
          GROUP BY 1 ORDER BY 1`,
      ),
    );
  }

  /** Lucro por produto (top, ordenado por lucro). */
  async byProduct(schema: string, from?: string, to?: string): Promise<ProfitProduct[]> {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<ProfitProduct[]>(
        Prisma.sql`
          SELECT ii.product_code AS "productCode", MAX(ii.description) AS description,
                 ROUND(SUM(ii.quantity), 3)::float AS qty,
                 ROUND(SUM(ii.net_amount), 2)::float AS "salesNet",
                 ROUND(SUM(ii.unit_cost * ii.quantity), 2)::float AS cost,
                 ROUND(SUM(ii.net_amount) - SUM(ii.unit_cost * ii.quantity), 2)::float AS profit,
                 CASE WHEN SUM(ii.net_amount) > 0
                      THEN ROUND((SUM(ii.net_amount) - SUM(ii.unit_cost * ii.quantity)) / SUM(ii.net_amount) * 100, 1)::float
                      ELSE 0 END AS "marginPct"
          FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
          WHERE i.status <> 'A' AND i.doc_type IN ('FT','FS')
            AND i.system_entry_date BETWEEN ${f} AND ${t}
          GROUP BY ii.product_code ORDER BY profit DESC LIMIT 100`,
      ),
    );
  }

  /**
   * Curva ABC: classifica os produtos por peso nas vendas líquidas do período.
   * A = até 80% acumulado (estrela), B = até 95%, C = restante (cauda).
   */
  async abc(schema: string, from?: string, to?: string): Promise<ProfitAbcRow[]> {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ product_code: string; description: string; sales: number }[]>(
        Prisma.sql`
          SELECT ii.product_code AS product_code, MAX(ii.description) AS description,
                 ROUND(SUM(ii.net_amount), 2)::float AS sales
          FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
          WHERE i.status <> 'A' AND i.doc_type IN ('FT','FS')
            AND i.system_entry_date BETWEEN ${f} AND ${t}
          GROUP BY ii.product_code HAVING SUM(ii.net_amount) > 0
          ORDER BY sales DESC`,
      );
      const total = rows.reduce((s, r) => s + Number(r.sales), 0);
      let cum = 0;
      return rows.map((r) => {
        const sales = Number(r.sales);
        cum += sales;
        const sharePct = total > 0 ? round2((sales / total) * 100) : 0;
        const cumulativePct = total > 0 ? round2((cum / total) * 100) : 0;
        const abcClass: 'A' | 'B' | 'C' = cumulativePct <= 80 ? 'A' : cumulativePct <= 95 ? 'B' : 'C';
        return { productCode: r.product_code, description: r.description, sales: round2(sales), sharePct, cumulativePct, abcClass };
      });
    });
  }
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = n < 0 ? -1 : 1;
  return (s * Math.round(Math.abs(n) * 100)) / 100 || 0;
}
