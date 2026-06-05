import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type MovementType = 'IN' | 'OUT' | 'ADJUST' | 'TRANSFER';

export interface MovementInput {
  productId: string;
  warehouseId: string;
  type: MovementType;
  /** Quantidade com sinal: +entrada / -saída. */
  quantity: number;
  unitCost?: number | null;
  reference?: string | null;
  referenceId?: string | null;
  createdBy?: string | null;
  /**
   * Permite que o saldo do armazém fique negativo (sem lançar). Usado pela
   * emissão fiscal: uma factura legal nunca pode ser bloqueada por falta de
   * stock — o saldo negativo sinaliza a necessidade de um acerto de inventário.
   */
  allowNegative?: boolean;
}

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aplica um movimento de stock dentro de uma transacção já existente:
   * bloqueia o saldo (product, warehouse), actualiza-o e regista no livro
   * append-only `stock_movements`. Reutilizado por compras, vendas e acertos.
   */
  static async applyMovement(
    tx: Prisma.TransactionClient,
    m: MovementInput,
  ): Promise<number> {
    // Garante a linha de saldo e bloqueia-a.
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO stock_items (product_id, warehouse_id, quantity)
                 VALUES (${m.productId}::uuid, ${m.warehouseId}::uuid, 0)
                 ON CONFLICT (product_id, warehouse_id) DO NOTHING`,
    );
    const rows = await tx.$queryRaw<{ quantity: string }[]>(
      Prisma.sql`SELECT quantity FROM stock_items
                 WHERE product_id = ${m.productId}::uuid AND warehouse_id = ${m.warehouseId}::uuid
                 FOR UPDATE`,
    );
    const current = Number(rows[0].quantity);
    const balanceAfter = current + m.quantity;
    if (balanceAfter < 0 && !m.allowNegative) {
      throw new BadRequestException(
        `Stock insuficiente: saldo ${current}, movimento ${m.quantity}`,
      );
    }

    await tx.$executeRaw(
      Prisma.sql`UPDATE stock_items SET quantity = ${balanceAfter}, updated_at = now()
                 WHERE product_id = ${m.productId}::uuid AND warehouse_id = ${m.warehouseId}::uuid`,
    );
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO stock_movements
          (product_id, warehouse_id, type, quantity, unit_cost, balance_after, reference, reference_id, created_by)
        VALUES (${m.productId}::uuid, ${m.warehouseId}::uuid, ${m.type}, ${m.quantity},
                ${m.unitCost ?? null}, ${balanceAfter}, ${m.reference ?? null},
                ${m.referenceId ?? null}::uuid, ${m.createdBy ?? null}::uuid)`,
    );

    // Mantém coerente o espelho global products.stock_qty (soma de todos os
    // armazéns). É a quantidade que o POS/loja online lêem; o detalhe por
    // armazém vive em stock_items + stock_movements (livro append-only).
    await tx.$executeRaw(
      Prisma.sql`UPDATE products SET stock_qty = stock_qty + ${m.quantity}, updated_at = now()
                 WHERE id = ${m.productId}::uuid`,
    );
    return balanceAfter;
  }

  /**
   * Resolve o armazém destino de uma saída fiscal (venda). Prefere o armazém
   * por defeito; se não houver default, usa o primeiro armazém activo. Devolve
   * null quando o tenant ainda não tem armazéns configurados (retrocompat: a
   * emissão cai no decremento global legado).
   */
  static async resolveDefaultWarehouse(
    tx: Prisma.TransactionClient,
  ): Promise<string | null> {
    // O "local de stock" é a LOJA (o conceito de armazém foi eliminado).
    const rows = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM stores
                 WHERE is_active = TRUE
                 ORDER BY is_default DESC, created_at ASC
                 LIMIT 1`,
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Entrada de stock em lote: dá entrada de `quantity` unidades (movimento IN)
   * com o `unitCost` indicado e actualiza o custo do produto (e o preço de
   * venda, se enviado). O lucro é calculado/mostrado no frontend.
   */
  async stockEntry(
    schema: string,
    input: {
      productId: string;
      warehouseId: string; // id da LOJA, ou 'ALL' = stock partilhado (loja principal)
      quantity: number;
      unitCost: number;
      salePrice?: number | null;
      batchCode?: string | null;
      expiryDate?: string | null;
      minQty?: number | null;
      createdBy?: string | null;
    },
  ): Promise<{ balanceAfter: number }> {
    if (input.quantity <= 0) throw new BadRequestException('A quantidade tem de ser maior que zero.');
    if (input.unitCost < 0) throw new BadRequestException('Custo unitário inválido.');
    return this.prisma.runInTenant(schema, async (tx) => {
      // "Todas as lojas (stock partilhado)" → entra na loja principal (default).
      let storeId = input.warehouseId;
      if (!storeId || storeId === 'ALL') {
        storeId = (await StockService.resolveDefaultWarehouse(tx)) ?? storeId;
      }
      const balanceAfter = await StockService.applyMovement(tx, {
        productId: input.productId,
        warehouseId: storeId,
        type: 'IN',
        quantity: input.quantity,
        unitCost: input.unitCost,
        reference: input.batchCode ? `Entrada de stock (lote ${input.batchCode})` : 'Entrada de stock',
        createdBy: input.createdBy ?? null,
      });
      await tx.$executeRaw(
        Prisma.sql`UPDATE products
                   SET cost_price = ${input.unitCost},
                       unit_price = COALESCE(${input.salePrice ?? null}, unit_price),
                       updated_at = now()
                   WHERE id = ${input.productId}::uuid`,
      );
      // Stock mínimo (opcional) — alerta de reposição por loja.
      if (input.minQty != null && input.minQty >= 0) {
        await tx.$executeRaw(
          Prisma.sql`UPDATE stock_items SET min_qty = ${input.minQty}, updated_at = now()
                     WHERE product_id = ${input.productId}::uuid AND warehouse_id = ${storeId}::uuid`,
        );
      }
      // Lote/validade (opcional) — registado na mesma entrada (sem 2º movimento).
      if (input.batchCode || input.expiryDate) {
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO product_batches (product_id, warehouse_id, batch_code, quantity, expiry_date)
                     VALUES (${input.productId}::uuid, ${storeId}::uuid, ${input.batchCode ?? null},
                             ${input.quantity}, ${input.expiryDate ? Prisma.sql`${input.expiryDate}::date` : Prisma.sql`NULL`})`,
        );
      }
      return { balanceAfter };
    });
  }

  /** Movimentos de stock (livro append-only) com filtros — para consulta. */
  async listMovements(
    schema: string,
    filters: { q?: string; warehouseId?: string; from?: string; to?: string } = {},
  ): Promise<unknown[]> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const conds: Prisma.Sql[] = [];
      if (filters.q?.trim()) {
        const like = `%${filters.q.trim()}%`;
        conds.push(Prisma.sql`(p.name ILIKE ${like} OR p.code ILIKE ${like})`);
      }
      if (filters.warehouseId) conds.push(Prisma.sql`m.warehouse_id = ${filters.warehouseId}::uuid`);
      if (filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from)) conds.push(Prisma.sql`m.created_at >= ${filters.from}::date`);
      if (filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to)) conds.push(Prisma.sql`m.created_at < (${filters.to}::date + 1)`);
      const where = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
      return tx.$queryRaw(
        Prisma.sql`SELECT m.created_at, m.type, m.quantity, m.balance_after, m.reference,
                          p.name AS product_name, p.code AS product_code, w.name AS warehouse_name
                   FROM stock_movements m
                   JOIN products p ON p.id = m.product_id
                   LEFT JOIN stores w ON w.id = m.warehouse_id
                   ${where}
                   ORDER BY m.created_at DESC
                   LIMIT 500`,
      );
    });
  }

  /**
   * Análise de stock: por produto/loja, calcula stock actual, valor em stock,
   * unidades vendidas e entradas no período, previsão de venda/dia e dias de
   * stock restantes. Filtros: período, loja, categoria e estado do stock.
   */
  async stockAnalysis(
    schema: string,
    filters: {
      from?: string; to?: string;
      warehouseId?: string; categoryId?: string;
      state?: 'all' | 'positive' | 'zero' | 'negative' | 'low';
    } = {},
  ): Promise<{
    rows: Array<Record<string, unknown>>;
    summary: { stockValue: number; products: number; positive: number; unitsSold: number; forecastValue: number };
    period: { from: string; to: string; days: number };
  }> {
    const to = filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to) ? filters.to : new Date().toISOString().slice(0, 10);
    const from = filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from)
      ? filters.from
      : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const days = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1);

    return this.prisma.runInTenant(schema, async (tx) => {
      const conds: Prisma.Sql[] = [];
      if (filters.warehouseId) conds.push(Prisma.sql`si.warehouse_id = ${filters.warehouseId}::uuid`);
      if (filters.categoryId) conds.push(Prisma.sql`p.category_id = ${filters.categoryId}::uuid`);
      if (filters.state === 'positive') conds.push(Prisma.sql`si.quantity > 0`);
      else if (filters.state === 'zero') conds.push(Prisma.sql`si.quantity = 0`);
      else if (filters.state === 'negative') conds.push(Prisma.sql`si.quantity < 0`);
      else if (filters.state === 'low') conds.push(Prisma.sql`si.quantity <= si.min_qty`);
      const where = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;

      const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(
        Prisma.sql`
          SELECT p.id AS product_id, p.code AS product_code, p.name AS product_name,
                 c.name AS category_name,
                 w.id AS store_id, w.name AS store_name,
                 p.cost_price, p.unit_price, si.quantity,
                 (si.quantity * p.cost_price) AS stock_value,
                 COALESCE(mv.units_sold, 0) AS units_sold,
                 COALESCE(mv.units_in, 0) AS units_in
          FROM stock_items si
          JOIN products p ON p.id = si.product_id
          JOIN stores w ON w.id = si.warehouse_id
          LEFT JOIN product_categories c ON c.id = p.category_id
          LEFT JOIN LATERAL (
            SELECT SUM(CASE WHEN m.type = 'OUT' THEN -m.quantity ELSE 0 END) AS units_sold,
                   SUM(CASE WHEN m.type = 'IN'  THEN  m.quantity ELSE 0 END) AS units_in
            FROM stock_movements m
            WHERE m.product_id = si.product_id AND m.warehouse_id = si.warehouse_id
              AND m.created_at >= ${from}::date AND m.created_at < (${to}::date + 1)
          ) mv ON TRUE
          ${where}
          ORDER BY p.name, w.name`,
      );

      const enriched: Array<Record<string, unknown>> = rows.map((r) => {
        const qty = Number(r.quantity) || 0;
        const sold = Number(r.units_sold) || 0;
        const perDay = sold / days;
        const daysLeft = perDay > 0 ? qty / perDay : null;
        return {
          ...r,
          sales_per_day: Math.round(perDay * 100) / 100,
          days_left: daysLeft != null ? Math.round(daysLeft) : null,
        };
      });

      const summary = {
        stockValue: enriched.reduce((s, r) => s + (Number(r.stock_value) || 0), 0),
        products: new Set(enriched.map((r) => r.product_id)).size,
        positive: enriched.filter((r) => (Number(r.quantity) || 0) > 0).length,
        unitsSold: enriched.reduce((s, r) => s + (Number(r.units_sold) || 0), 0),
        // Previsão = valor de venda das unidades estimadas para os próximos `days` dias.
        forecastValue: enriched.reduce((s, r) => s + (Number(r.sales_per_day) || 0) * days * (Number(r.unit_price) || 0), 0),
      };

      return { rows: enriched, summary, period: { from, to, days } };
    });
  }

  /** Acerto de inventário: fixa o saldo absoluto e regista a diferença como ADJUST. */
  async adjust(
    schema: string,
    input: {
      productId: string;
      warehouseId: string;
      newQuantity: number;
      reason?: string;
      createdBy?: string | null;
    },
  ): Promise<{ balanceAfter: number }> {
    if (input.newQuantity < 0) {
      throw new BadRequestException('Saldo não pode ser negativo');
    }
    return this.prisma.runInTenant(schema, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO stock_items (product_id, warehouse_id, quantity)
                   VALUES (${input.productId}::uuid, ${input.warehouseId}::uuid, 0)
                   ON CONFLICT (product_id, warehouse_id) DO NOTHING`,
      );
      const rows = await tx.$queryRaw<{ quantity: string }[]>(
        Prisma.sql`SELECT quantity FROM stock_items
                   WHERE product_id = ${input.productId}::uuid AND warehouse_id = ${input.warehouseId}::uuid
                   FOR UPDATE`,
      );
      const current = Number(rows[0].quantity);
      const delta = input.newQuantity - current;
      const balanceAfter = await StockService.applyMovement(tx, {
        productId: input.productId,
        warehouseId: input.warehouseId,
        type: 'ADJUST',
        quantity: delta,
        reference: input.reason ?? 'Acerto de inventário',
        createdBy: input.createdBy ?? null,
      });
      return { balanceAfter };
    });
  }
}
