import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { luandaDate } from '../common/luanda-date';

/**
 * Relatórios de gestão (estilo Vendus): vendas por utilizador, por categoria,
 * mapa de impostos (IVA) e métodos de pagamento, num período [from, to].
 * Só conta vendas válidas (status <> 'A') dos tipos FT/FS.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private range(from?: string, to?: string): { from: string; to: string } {
    const toD = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : luandaDate();
    const fromD = from && /^\d{4}-\d{2}-\d{2}$/.test(from)
      ? from
      : luandaDate(Date.now() - 29 * 86400000);
    return { from: fromD, to: toD };
  }

  /** Condição opcional de loja (multi-loja). */
  private storeCond(storeId?: string): Prisma.Sql {
    return storeId ? Prisma.sql` AND i.store_id = ${storeId}::uuid` : Prisma.empty;
  }

  /**
   * Linhas de venda do período, já LÍQUIDAS de devoluções parciais: linhas das
   * FT/FS não anuladas (+) e linhas das NC cuja fatura de origem NÃO foi
   * anulada (−, com o cliente/operador da venda de origem). Anulações totais
   * saem só por status <> 'A' — nunca se desconta a mesma venda duas vezes
   * (mesma regra dos Lucros).
   */
  private saleLines(f: string, t: string, storeId?: string): Prisma.Sql {
    const st = (alias: string) => (storeId ? Prisma.sql` AND ${Prisma.raw(alias)}.store_id = ${storeId}::uuid` : Prisma.empty);
    return Prisma.sql`(
      SELECT i.id AS sale_id, i.customer_id, i.cashier_id, i.store_id, ii.product_id, ii.iva_rate,
             ii.quantity AS qty, ii.net_amount AS net, ii.iva_amount AS iva, ii.gross_amount AS gross, TRUE AS is_sale,
             i.system_entry_date AS at
        FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
       WHERE i.status <> 'A' AND i.doc_type IN ('FT','FS')
         AND i.system_entry_date >= ${f}::date AND i.system_entry_date < (${t}::date + 1)${st('i')}
      UNION ALL
      SELECT src.id, src.customer_id, src.cashier_id, nc.store_id, nii.product_id, nii.iva_rate,
             -nii.quantity, -nii.net_amount, -nii.iva_amount, -nii.gross_amount, FALSE,
             nc.system_entry_date
        FROM invoices nc JOIN invoice_items nii ON nii.invoice_id = nc.id
        JOIN invoices src ON src.id = nc.source_invoice_id
       WHERE nc.doc_type = 'NC' AND src.status <> 'A'
         AND nc.system_entry_date >= ${f}::date AND nc.system_entry_date < (${t}::date + 1)${st('nc')}
    ) sl`;
  }

  /**
   * Vendas no tempo (hora de Luanda): por HORA do dia, DIA DA SEMANA, DIA ou MÊS —
   * as vistas "Por Hora", "Dias da Semana", "Diário"/"Vendas Diárias" e "Mensal"
   * do backoffice de referência. Mesma base líquida de devoluções dos outros
   * relatórios (saleLines).
   */
  async salesByTime(schema: string, by: 'hour' | 'weekday' | 'day' | 'month', from?: string, to?: string, storeId?: string) {
    const { from: f, to: t } = this.range(from, to);
    const local = Prisma.sql`(sl.at AT TIME ZONE 'Africa/Luanda')`;
    const bucket = by === 'hour' ? Prisma.sql`LPAD(EXTRACT(HOUR FROM ${local})::int::text, 2, '0')`
      : by === 'weekday' ? Prisma.sql`EXTRACT(ISODOW FROM ${local})::int::text`
      : by === 'month' ? Prisma.sql`to_char(${local}, 'YYYY-MM')`
      : Prisma.sql`to_char(${local}, 'YYYY-MM-DD')`;
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT ${bucket} AS bucket,
               COUNT(DISTINCT sl.sale_id) FILTER (WHERE sl.is_sale)::int AS sales,
               ROUND(SUM(sl.net), 2)::float AS net,
               ROUND(SUM(sl.gross), 2)::float AS gross
        FROM ${this.saleLines(f, t, storeId)}
        GROUP BY 1 ORDER BY 1`),
    );
  }

  /** Vendas por utilizador (operador): nº de vendas e total faturado. */
  async salesByUser(schema: string, from?: string, to?: string, storeId?: string) {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT COALESCE(u.name, '—') AS name,
               COUNT(DISTINCT sl.sale_id) FILTER (WHERE sl.is_sale)::int AS sales,
               ROUND(SUM(sl.net), 2)::float AS net,
               ROUND(SUM(sl.gross), 2)::float AS gross
        FROM ${this.saleLines(f, t, storeId)}
        LEFT JOIN users u ON u.id = sl.cashier_id
        GROUP BY u.name ORDER BY gross DESC`),
    );
  }

  /** Clientes que mais compram (top, por total faturado). */
  async salesByCustomer(schema: string, from?: string, to?: string, storeId?: string) {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT COALESCE(NULLIF(c.name, ''), 'Consumidor final') AS name,
               COUNT(DISTINCT sl.sale_id) FILTER (WHERE sl.is_sale)::int AS sales,
               ROUND(SUM(sl.net), 2)::float AS net,
               ROUND(SUM(sl.gross), 2)::float AS gross
        FROM ${this.saleLines(f, t, storeId)}
        LEFT JOIN customers c ON c.id = sl.customer_id
        GROUP BY COALESCE(NULLIF(c.name, ''), 'Consumidor final')
        ORDER BY gross DESC LIMIT 8`),
    );
  }

  /** Vendas por categoria de produto. */
  async salesByCategory(schema: string, from?: string, to?: string, storeId?: string) {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT COALESCE(c.name, 'Sem categoria') AS name,
               ROUND(SUM(sl.qty), 3)::float AS qty,
               ROUND(SUM(sl.net), 2)::float AS net,
               ROUND(SUM(sl.gross), 2)::float AS gross
        FROM ${this.saleLines(f, t, storeId)}
        LEFT JOIN products p ON p.id = sl.product_id
        LEFT JOIN product_categories c ON c.id = p.category_id
        GROUP BY c.name ORDER BY gross DESC`),
    );
  }

  /** Vendas por loja (multi-loja). storeId restringe a uma loja (permissões). */
  async salesByStore(schema: string, from?: string, to?: string, storeId?: string) {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT COALESCE(w.name, '—') AS name,
               COUNT(DISTINCT sl.sale_id) FILTER (WHERE sl.is_sale)::int AS sales,
               ROUND(SUM(sl.net), 2)::float AS net,
               ROUND(SUM(sl.gross), 2)::float AS gross
        FROM ${this.saleLines(f, t, storeId)}
        LEFT JOIN stores w ON w.id = sl.store_id
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
        SELECT i.id::text AS id, i.number, i.doc_type, i.system_entry_date, i.gross_total, i.net_total, i.iva_total,
               i.status, i.customer_tax_id, w.name AS store_name, u.name AS cashier_name,
               c.name AS customer_name
        FROM invoices i
        LEFT JOIN stores w ON w.id = i.store_id
        LEFT JOIN users u ON u.id = i.cashier_id
        LEFT JOIN customers c ON c.id = i.customer_id
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
  async salesByBrand(schema: string, from?: string, to?: string, storeId?: string) {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT COALESCE(NULLIF(p.brand, ''), 'Sem marca') AS name,
               ROUND(SUM(sl.qty), 3)::float AS qty,
               ROUND(SUM(sl.net), 2)::float AS net,
               ROUND(SUM(sl.gross), 2)::float AS gross
        FROM ${this.saleLines(f, t, storeId)}
        LEFT JOIN products p ON p.id = sl.product_id
        GROUP BY COALESCE(NULLIF(p.brand, ''), 'Sem marca') ORDER BY gross DESC`),
    );
  }

  /** Mapa de impostos (IVA) por taxa. */
  async taxMap(schema: string, from?: string, to?: string, storeId?: string) {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT sl.iva_rate::float AS rate,
               ROUND(SUM(sl.net), 2)::float AS net,
               ROUND(SUM(sl.iva), 2)::float AS iva,
               ROUND(SUM(sl.gross), 2)::float AS gross
        FROM ${this.saleLines(f, t, storeId)}
        GROUP BY sl.iva_rate ORDER BY sl.iva_rate`),
    );
  }

  /** Métodos de pagamento (a partir dos movimentos de caixa do tipo venda). */
  /**
   * Métodos de pagamento das VENDAS do período (FT/FS não anuladas), por loja se
   * pedido. Antes lia só `cash_movements`: vendas faturadas fora de um turno não
   * contavam ("Sem pagamentos"), e o gerente de loja via a empresa inteira.
   * O método vem do movimento de caixa da venda; sem movimento → crédito (se há
   * conta a receber) ou "Sem turno" (faturada sem caixa aberta).
   */
  async paymentMethods(schema: string, from?: string, to?: string, storeId?: string) {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, async (tx) => {
      const reg = await tx.$queryRaw<{ cm: string | null; rc: string | null }[]>(
        Prisma.sql`SELECT to_regclass('cash_movements')::text AS cm, to_regclass('receivables')::text AS rc`,
      );
      const cmJoin = reg[0]?.cm
        ? Prisma.sql`LEFT JOIN LATERAL (SELECT m.payment_type FROM cash_movements m WHERE m.type = 'SALE' AND m.reference_id = i.id LIMIT 1) cm ON TRUE`
        : Prisma.sql`LEFT JOIN LATERAL (SELECT NULL::text AS payment_type) cm ON TRUE`;
      const credit = reg[0]?.rc
        ? Prisma.sql`EXISTS (SELECT 1 FROM receivables r WHERE r.invoice_id = i.id)`
        : Prisma.sql`FALSE`;
      return tx.$queryRaw(Prisma.sql`
        SELECT COALESCE(cm.payment_type, CASE WHEN ${credit} THEN 'CREDIT' ELSE 'SEM_TURNO' END) AS method,
               COUNT(*)::int AS count,
               ROUND(SUM(i.gross_total), 2)::float AS total
        FROM invoices i
        ${cmJoin}
        WHERE i.doc_type IN ('FT','FS') AND i.status <> 'A'
          AND i.invoice_date >= ${f}::date AND i.invoice_date <= ${t}::date
          ${this.storeCond(storeId)}
        GROUP BY 1 ORDER BY total DESC`);
    });
  }
}
