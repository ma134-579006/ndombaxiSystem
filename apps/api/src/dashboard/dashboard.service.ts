import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface SalesSummary {
  invoiceCount: number;
  netTotal: number;
  ivaTotal: number;
  grossTotal: number;
  averageTicket: number;
}

export interface SalesByDay {
  day: string;
  grossTotal: number;
  invoiceCount: number;
}

export interface TopProduct {
  productCode: string;
  description: string;
  quantity: number;
  grossTotal: number;
}

/** Intervalos suportados pelos gráficos do dashboard em tempo real. */
export type SalesRange = 'today' | 'yesterday' | '7d' | '1m' | '3m' | '6m' | '1y';

export const SALES_RANGES: readonly SalesRange[] = [
  'today',
  'yesterday',
  '7d',
  '1m',
  '3m',
  '6m',
  '1y',
] as const;

export type SeriesGranularity = 'hour' | 'day' | 'week' | 'month';

export interface SalesSeriesPoint {
  /** Início do balde temporal (ISO 8601). */
  bucket: string;
  grossTotal: number;
  ivaTotal: number;
  invoiceCount: number;
}

export interface SalesSeries {
  range: SalesRange;
  granularity: SeriesGranularity;
  points: SalesSeriesPoint[];
  summary: SalesSummary;
}

/**
 * Configuração de cada intervalo: granularidade do balde + janela temporal
 * (expressões SQL fixas — sem input do utilizador, logo seguras com Prisma.raw).
 * Os limites usam `now()` no fuso da BD para alinhar com o relógio de vendas.
 */
const RANGE_CONFIG: Record<
  SalesRange,
  { granularity: SeriesGranularity; start: string; end: string }
> = {
  today: { granularity: 'hour', start: "date_trunc('day', now())", end: 'now()' },
  yesterday: {
    granularity: 'hour',
    start: "date_trunc('day', now()) - interval '1 day'",
    end: "date_trunc('day', now())",
  },
  '7d': {
    granularity: 'day',
    start: "date_trunc('day', now()) - interval '6 days'",
    end: 'now()',
  },
  '1m': {
    granularity: 'day',
    start: "date_trunc('day', now()) - interval '1 month'",
    end: 'now()',
  },
  '3m': {
    granularity: 'week',
    start: "date_trunc('week', now()) - interval '3 months'",
    end: 'now()',
  },
  '6m': {
    granularity: 'month',
    start: "date_trunc('month', now()) - interval '6 months'",
    end: 'now()',
  },
  '1y': {
    granularity: 'month',
    start: "date_trunc('month', now()) - interval '1 year'",
    end: 'now()',
  },
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Série temporal de vendas para os gráficos em tempo real. Cada intervalo
   * (`today`, `yesterday`, `7d`, `1m`, `3m`, `6m`, `1y`) usa a granularidade
   * adequada — horária para o(s) dia(s), diária/semanal/mensal para janelas
   * mais largas — agrupando por `system_entry_date` (timestamp da emissão).
   */
  async salesSeries(schema: string, range: SalesRange = '7d'): Promise<SalesSeries> {
    const cfg = RANGE_CONFIG[range] ?? RANGE_CONFIG['7d'];
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<
        { bucket: Date; gross: string; iva: string; net: string; count: number }[]
      >(
        Prisma.sql`SELECT date_trunc(${cfg.granularity}, system_entry_date) AS bucket,
                          COALESCE(SUM(gross_total), 0) AS gross,
                          COALESCE(SUM(iva_total), 0) AS iva,
                          COALESCE(SUM(net_total), 0) AS net,
                          COUNT(*)::int AS count
                   FROM invoices
                   WHERE status = 'N'
                     AND system_entry_date >= ${Prisma.raw(cfg.start)}
                     AND system_entry_date < ${Prisma.raw(cfg.end)}
                   GROUP BY bucket
                   ORDER BY bucket`,
      );

      const points: SalesSeriesPoint[] = rows.map((r) => ({
        bucket: r.bucket.toISOString(),
        grossTotal: Number(r.gross),
        ivaTotal: Number(r.iva),
        invoiceCount: r.count,
      }));

      // Totais do período derivam dos baldes (uma só passagem pela BD).
      let count = 0;
      let net = 0;
      let iva = 0;
      let gross = 0;
      for (const r of rows) {
        count += r.count;
        net += Number(r.net);
        iva += Number(r.iva);
        gross += Number(r.gross);
      }

      return {
        range,
        granularity: cfg.granularity,
        points,
        summary: {
          invoiceCount: count,
          netTotal: Math.round(net * 100) / 100,
          ivaTotal: Math.round(iva * 100) / 100,
          grossTotal: Math.round(gross * 100) / 100,
          averageTicket: count > 0 ? Math.round((gross / count) * 100) / 100 : 0,
        },
      };
    });
  }

  /** Resumo de vendas do dia (KPIs do topo do dashboard). */
  async salesToday(schema: string): Promise<SalesSummary> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<
        { count: number; net: string; iva: string; gross: string }[]
      >(
        Prisma.sql`SELECT COUNT(*)::int AS count,
                          COALESCE(SUM(net_total), 0) AS net,
                          COALESCE(SUM(iva_total), 0) AS iva,
                          COALESCE(SUM(gross_total), 0) AS gross
                   FROM invoices
                   WHERE invoice_date = CURRENT_DATE AND status = 'N'`,
      );
      return this.toSummary(rows[0]);
    });
  }

  /** Vendas dos últimos `days` dias, agrupadas por dia (para o gráfico). */
  async salesByDay(schema: string, days = 30): Promise<SalesByDay[]> {
    const span = Math.min(Math.max(days, 1), 365);
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<
        { day: Date; gross: string; count: number }[]
      >(
        Prisma.sql`SELECT invoice_date AS day,
                          COALESCE(SUM(gross_total), 0) AS gross,
                          COUNT(*)::int AS count
                   FROM invoices
                   WHERE status = 'N'
                     AND invoice_date >= CURRENT_DATE - (${span}::int - 1) * INTERVAL '1 day'
                   GROUP BY invoice_date
                   ORDER BY invoice_date`,
      );
      return rows.map((r) => ({
        day: r.day.toISOString().slice(0, 10),
        grossTotal: Number(r.gross),
        invoiceCount: r.count,
      }));
    });
  }

  /** Produtos mais vendidos por valor bruto. */
  async topProducts(schema: string, limit = 10): Promise<TopProduct[]> {
    const n = Math.min(Math.max(limit, 1), 100);
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<
        { product_code: string; description: string; qty: string; gross: string }[]
      >(
        Prisma.sql`SELECT ii.product_code, MAX(ii.description) AS description,
                          SUM(ii.quantity) AS qty, SUM(ii.gross_amount) AS gross
                   FROM invoice_items ii
                   JOIN invoices i ON i.id = ii.invoice_id AND i.status = 'N'
                   GROUP BY ii.product_code
                   ORDER BY gross DESC
                   LIMIT ${n}`,
      );
      return rows.map((r) => ({
        productCode: r.product_code,
        description: r.description,
        quantity: Number(r.qty),
        grossTotal: Number(r.gross),
      }));
    });
  }

  /** Produtos abaixo do stock mínimo (alerta de reposição). */
  async lowStock(schema: string): Promise<
    { productCode: string; productName: string; warehouseCode: string; quantity: number; minQty: number }[]
  > {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<
        { product_code: string; product_name: string; warehouse_code: string; quantity: string; min_qty: string }[]
      >(
        Prisma.sql`SELECT p.code AS product_code, p.name AS product_name, w.code AS warehouse_code,
                          si.quantity, si.min_qty
                   FROM stock_items si
                   JOIN products p ON p.id = si.product_id
                   JOIN warehouses w ON w.id = si.warehouse_id
                   WHERE si.quantity <= si.min_qty
                   ORDER BY p.name`,
      );
      return rows.map((r) => ({
        productCode: r.product_code,
        productName: r.product_name,
        warehouseCode: r.warehouse_code,
        quantity: Number(r.quantity),
        minQty: Number(r.min_qty),
      }));
    });
  }

  private toSummary(r: { count: number; net: string; iva: string; gross: string }): SalesSummary {
    const grossTotal = Number(r.gross);
    return {
      invoiceCount: r.count,
      netTotal: Number(r.net),
      ivaTotal: Number(r.iva),
      grossTotal,
      averageTicket: r.count > 0 ? Math.round((grossTotal / r.count) * 100) / 100 : 0,
    };
  }
}
