import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Relatórios de gestão (estilo Vendus): vendas por utilizador, por categoria,
 * mapa de impostos (IVA) e métodos de pagamento, num período [from, to].
 * Só conta vendas válidas (status <> 'A') dos tipos FT/FS.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private range(from?: string, to?: string): { from: string; to: string } {
    const toD = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : new Date().toISOString().slice(0, 10);
    const fromD = from && /^\d{4}-\d{2}-\d{2}$/.test(from)
      ? from
      : new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    return { from: fromD, to: toD };
  }

  /** Vendas por utilizador (operador): nº de vendas e total faturado. */
  async salesByUser(schema: string, from?: string, to?: string) {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT COALESCE(u.name, '—') AS name,
               COUNT(DISTINCT i.id)::int AS sales,
               ROUND(SUM(ii.net_amount), 2)::float AS net,
               ROUND(SUM(ii.gross_amount), 2)::float AS gross
        FROM invoices i
        JOIN invoice_items ii ON ii.invoice_id = i.id
        LEFT JOIN users u ON u.id = i.cashier_id
        WHERE i.status <> 'A' AND i.doc_type IN ('FT','FS')
          AND i.system_entry_date >= ${f}::date AND i.system_entry_date < (${t}::date + 1)
        GROUP BY u.name ORDER BY gross DESC`),
    );
  }

  /** Vendas por categoria de produto. */
  async salesByCategory(schema: string, from?: string, to?: string) {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT COALESCE(c.name, 'Sem categoria') AS name,
               ROUND(SUM(ii.quantity), 3)::float AS qty,
               ROUND(SUM(ii.net_amount), 2)::float AS net,
               ROUND(SUM(ii.gross_amount), 2)::float AS gross
        FROM invoices i
        JOIN invoice_items ii ON ii.invoice_id = i.id
        LEFT JOIN products p ON p.id = ii.product_id
        LEFT JOIN product_categories c ON c.id = p.category_id
        WHERE i.status <> 'A' AND i.doc_type IN ('FT','FS')
          AND i.system_entry_date >= ${f}::date AND i.system_entry_date < (${t}::date + 1)
        GROUP BY c.name ORDER BY gross DESC`),
    );
  }

  /** Vendas por loja (multi-loja). */
  async salesByStore(schema: string, from?: string, to?: string) {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT COALESCE(w.name, '—') AS name,
               COUNT(DISTINCT i.id)::int AS sales,
               ROUND(SUM(ii.net_amount), 2)::float AS net,
               ROUND(SUM(ii.gross_amount), 2)::float AS gross
        FROM invoices i
        JOIN invoice_items ii ON ii.invoice_id = i.id
        LEFT JOIN stores w ON w.id = i.store_id
        WHERE i.status <> 'A' AND i.doc_type IN ('FT','FS')
          AND i.system_entry_date >= ${f}::date AND i.system_entry_date < (${t}::date + 1)
        GROUP BY w.name ORDER BY gross DESC`),
    );
  }

  /** Listagem de documentos (facturas/NC) por período, loja e tipo. */
  async documents(
    schema: string,
    filters: { from?: string; to?: string; storeId?: string; docType?: string } = {},
  ) {
    const { from: f, to: t } = this.range(filters.from, filters.to);
    return this.prisma.runInTenant(schema, (tx) => {
      const conds: Prisma.Sql[] = [
        Prisma.sql`i.system_entry_date >= ${f}::date`,
        Prisma.sql`i.system_entry_date < (${t}::date + 1)`,
      ];
      if (filters.storeId) conds.push(Prisma.sql`i.store_id = ${filters.storeId}::uuid`);
      if (filters.docType) conds.push(Prisma.sql`i.doc_type = ${filters.docType}`);
      return tx.$queryRaw(Prisma.sql`
        SELECT i.number, i.doc_type, i.system_entry_date, i.gross_total, i.net_total, i.iva_total,
               i.status, i.customer_tax_id, w.name AS store_name, u.name AS cashier_name
        FROM invoices i
        LEFT JOIN stores w ON w.id = i.store_id
        LEFT JOIN users u ON u.id = i.cashier_id
        WHERE ${Prisma.join(conds, ' AND ')}
        ORDER BY i.system_entry_date DESC LIMIT 1000`);
    });
  }

  /** Resumo de fecho de caixa: turnos fechados no período. */
  async cashSessions(schema: string, from?: string, to?: string) {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, async (tx) => {
      const has = await tx.$queryRaw<{ reg: string | null }[]>(
        Prisma.sql`SELECT to_regclass('cash_sessions')::text AS reg`,
      );
      if (!has[0]?.reg) return [];
      return tx.$queryRaw(Prisma.sql`
        SELECT cs.opened_at, cs.closed_at, cs.opened_by_name, cs.closed_by_name,
               cs.opening_float, cs.total_sales, cs.total_cash_in, cs.total_cash_out,
               cs.counted_cash, cs.expected_cash, cs.difference, cs.sales_count,
               w.name AS store_name
        FROM cash_sessions cs
        LEFT JOIN stores w ON w.id = cs.store_id
        WHERE cs.status = 'CLOSED'
          AND cs.closed_at >= ${f}::date AND cs.closed_at < (${t}::date + 1)
        ORDER BY cs.closed_at DESC LIMIT 500`);
    });
  }

  /** Vendas por marca (campo brand do produto). */
  async salesByBrand(schema: string, from?: string, to?: string) {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT COALESCE(NULLIF(p.brand, ''), 'Sem marca') AS name,
               ROUND(SUM(ii.quantity), 3)::float AS qty,
               ROUND(SUM(ii.net_amount), 2)::float AS net,
               ROUND(SUM(ii.gross_amount), 2)::float AS gross
        FROM invoices i
        JOIN invoice_items ii ON ii.invoice_id = i.id
        LEFT JOIN products p ON p.id = ii.product_id
        WHERE i.status <> 'A' AND i.doc_type IN ('FT','FS')
          AND i.system_entry_date >= ${f}::date AND i.system_entry_date < (${t}::date + 1)
        GROUP BY COALESCE(NULLIF(p.brand, ''), 'Sem marca') ORDER BY gross DESC`),
    );
  }

  /** Mapa de impostos (IVA) por taxa. */
  async taxMap(schema: string, from?: string, to?: string) {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT ii.iva_rate::float AS rate,
               ROUND(SUM(ii.net_amount), 2)::float AS net,
               ROUND(SUM(ii.iva_amount), 2)::float AS iva,
               ROUND(SUM(ii.gross_amount), 2)::float AS gross
        FROM invoices i
        JOIN invoice_items ii ON ii.invoice_id = i.id
        WHERE i.status <> 'A' AND i.doc_type IN ('FT','FS')
          AND i.system_entry_date >= ${f}::date AND i.system_entry_date < (${t}::date + 1)
        GROUP BY ii.iva_rate ORDER BY ii.iva_rate`),
    );
  }

  /** Métodos de pagamento (a partir dos movimentos de caixa do tipo venda). */
  async paymentMethods(schema: string, from?: string, to?: string) {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, async (tx) => {
      const has = await tx.$queryRaw<{ reg: string | null }[]>(
        Prisma.sql`SELECT to_regclass('cash_movements')::text AS reg`,
      );
      if (!has[0]?.reg) return [];
      return tx.$queryRaw(Prisma.sql`
        SELECT COALESCE(payment_type, 'OUTRO') AS method,
               COUNT(*)::int AS count,
               ROUND(SUM(amount), 2)::float AS total
        FROM cash_movements
        WHERE type = 'SALE'
          AND created_at >= ${f}::date AND created_at < (${t}::date + 1)
        GROUP BY payment_type ORDER BY total DESC`);
    });
  }
}
