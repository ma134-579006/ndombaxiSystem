import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../erp/stock.service';

/** IVA por código (espelha o frontend) — para congelar o preço c/ IVA na comanda. */
const IVA_RATE: Record<string, number> = { NOR: 14, INT: 7, RED: 5, ISE: 0, NS: 0 };

export interface TableRow {
  id: string; code: string; name: string; area: string | null; seats: number;
  is_active: boolean; sort_order: number;
}

@Injectable()
export class RestaurantService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Mesas ──────────────────────────────────────────────────
  listTables(schema: string): Promise<TableRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<TableRow[]>(Prisma.sql`SELECT id, code, name, area, seats, is_active, sort_order
        FROM restaurant_tables WHERE is_active = TRUE ORDER BY sort_order, name`),
    );
  }

  async createTable(schema: string, input: { code?: string; name: string; area?: string; seats?: number }): Promise<TableRow> {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Indique o nome da mesa.');
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<TableRow[]>(Prisma.sql`INSERT INTO restaurant_tables (code, name, area, seats)
        VALUES (${input.code?.trim() || name}, ${name}, ${input.area?.trim() || null}, ${input.seats ?? 4})
        RETURNING id, code, name, area, seats, is_active, sort_order`),
    );
    return rows[0];
  }

  async removeTable(schema: string, id: string): Promise<{ ok: true }> {
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE restaurant_tables SET is_active = FALSE WHERE id = ${id}::uuid`));
    return { ok: true };
  }

  // ── Comandas (orders) ──────────────────────────────────────
  /** Mesas + a comanda OPEN de cada uma (se houver) — para o "mapa de mesas". */
  async tableMap(schema: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT t.id, t.code, t.name, t.area, t.seats,
          o.id AS order_id, o.total AS order_total, o.guests, o.opened_at_label,
          o.created_at AS opened_at
        FROM restaurant_tables t
        LEFT JOIN LATERAL (
          SELECT id, total, guests, created_at, to_char(created_at, 'HH24:MI') AS opened_at_label
          FROM restaurant_orders WHERE table_id = t.id AND status = 'OPEN'
          ORDER BY created_at DESC LIMIT 1
        ) o ON TRUE
        WHERE t.is_active = TRUE ORDER BY t.sort_order, t.name`),
    );
  }

  async openOrder(schema: string, tableId: string, opener: { id: string; name: string }, guests = 1, customerName?: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const t = await tx.$queryRaw<{ name: string }[]>(Prisma.sql`SELECT name FROM restaurant_tables WHERE id = ${tableId}::uuid`);
      if (!t[0]) throw new NotFoundException('Mesa não encontrada.');
      const existing = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM restaurant_orders WHERE table_id = ${tableId}::uuid AND status = 'OPEN' LIMIT 1`);
      if (existing[0]) return existing[0]; // já tem comanda aberta → devolve-a
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO restaurant_orders (table_id, table_name, guests, customer_name, opened_by, opened_by_name)
        VALUES (${tableId}::uuid, ${t[0].name}, ${guests}, ${customerName?.trim() || null}, ${opener.id}::uuid, ${opener.name})
        RETURNING id`);
      return rows[0];
    });
  }

  async getOrder(schema: string, orderId: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const o = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT * FROM restaurant_orders WHERE id = ${orderId}::uuid`);
      if (!o[0]) throw new NotFoundException('Comanda não encontrada.');
      const items = await tx.$queryRaw(Prisma.sql`SELECT id, product_code, description, unit_price, quantity, kitchen_status, notes, created_at
        FROM restaurant_order_items WHERE order_id = ${orderId}::uuid ORDER BY created_at`);
      return { order: o[0], items };
    });
  }

  private async recomputeTotal(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    await tx.$executeRaw(Prisma.sql`UPDATE restaurant_orders SET total = COALESCE(
      (SELECT SUM(unit_price * quantity) FROM restaurant_order_items WHERE order_id = ${orderId}::uuid), 0)
      WHERE id = ${orderId}::uuid`);
  }

  async addItem(schema: string, orderId: string, productCode: string, quantity: number, by: string, notes?: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const ord = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status FROM restaurant_orders WHERE id = ${orderId}::uuid`);
      if (!ord[0]) throw new NotFoundException('Comanda não encontrada.');
      if (ord[0].status !== 'OPEN') throw new BadRequestException('A comanda não está aberta.');
      const p = await tx.$queryRaw<{ id: string; name: string; unit_price: string; iva_code: string }[]>(
        Prisma.sql`SELECT id, name, unit_price, iva_code FROM products WHERE code = ${productCode} AND is_active = TRUE LIMIT 1`);
      if (!p[0]) throw new NotFoundException('Produto não encontrado.');
      const gross = Math.round(Number(p[0].unit_price) * (1 + (IVA_RATE[p[0].iva_code] ?? 14) / 100) * 100) / 100;
      const qty = quantity > 0 ? quantity : 1;
      await tx.$executeRaw(Prisma.sql`INSERT INTO restaurant_order_items (order_id, product_id, product_code, description, unit_price, quantity, notes, created_by)
        VALUES (${orderId}::uuid, ${p[0].id}::uuid, ${productCode}, ${p[0].name}, ${gross}, ${qty}, ${notes?.trim() || null}, ${by}::uuid)`);
      await this.recomputeTotal(tx, orderId);
      return { ok: true };
    });
  }

  async removeItem(schema: string, itemId: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const it = await tx.$queryRaw<{ order_id: string }[]>(Prisma.sql`SELECT order_id FROM restaurant_order_items WHERE id = ${itemId}::uuid`);
      if (!it[0]) return { ok: true };
      await tx.$executeRaw(Prisma.sql`DELETE FROM restaurant_order_items WHERE id = ${itemId}::uuid`);
      await this.recomputeTotal(tx, it[0].order_id);
      return { ok: true };
    });
  }

  async setItemKitchen(schema: string, itemId: string, status: string) {
    if (!['PENDING', 'PREPARING', 'READY', 'SERVED'].includes(status)) throw new BadRequestException('Estado inválido.');
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE restaurant_order_items SET kitchen_status = ${status} WHERE id = ${itemId}::uuid`));
    return { ok: true };
  }

  /**
   * Fecha a comanda (a conta). O pagamento/fatura é no CAIXA, onde a emissão
   * baixa os ingredientes (ficha técnica) — fonte única, sem duplicar. EXCEÇÃO:
   * se for lançada no FOLIO do quarto (hotelaria), não passa pelo caixa, por isso
   * aqui é que se baixam os ingredientes.
   */
  async closeOrder(schema: string, orderId: string, chargeToReservationId?: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const ord = await tx.$queryRaw<{ status: string; total: string; table_name: string | null }[]>(
        Prisma.sql`SELECT status, total, table_name FROM restaurant_orders WHERE id = ${orderId}::uuid`);
      if (!ord[0]) throw new NotFoundException('Comanda não encontrada.');
      if (ord[0].status !== 'OPEN') throw new BadRequestException('A comanda já não está aberta.');

      await tx.$executeRaw(Prisma.sql`UPDATE restaurant_orders SET status = 'CLOSED', closed_at = now() WHERE id = ${orderId}::uuid`);

      // Lançar no folio do quarto (hotelaria): consumo soma na conta do hóspede.
      if (chargeToReservationId) {
        const res = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status FROM hotel_reservations WHERE id = ${chargeToReservationId}::uuid`);
        if (!res[0]) throw new NotFoundException('Reserva não encontrada.');
        // Folio não passa pelo caixa → baixa aqui os ingredientes consumidos.
        const items = await tx.$queryRaw<{ product_id: string | null; quantity: string }[]>(
          Prisma.sql`SELECT product_id, quantity FROM restaurant_order_items WHERE order_id = ${orderId}::uuid`);
        await this.deductIngredients(tx, items);
        await tx.$executeRaw(Prisma.sql`INSERT INTO hotel_folio_items (reservation_id, description, unit_price, quantity)
          VALUES (${chargeToReservationId}::uuid, ${`Restaurante/Bar — ${ord[0].table_name ?? 'mesa'}`}, ${Number(ord[0].total)}, 1)`);
        await tx.$executeRaw(Prisma.sql`UPDATE hotel_reservations SET total = (nights * rate) + COALESCE(
          (SELECT SUM(unit_price * quantity) FROM hotel_folio_items WHERE reservation_id = ${chargeToReservationId}::uuid), 0), updated_at = now()
          WHERE id = ${chargeToReservationId}::uuid`);
      }
      return { ok: true, chargedToFolio: !!chargeToReservationId };
    });
  }

  /** Baixa o stock dos ingredientes (receita) de cada prato vendido. */
  private async deductIngredients(tx: Prisma.TransactionClient, items: { product_id: string | null; quantity: string }[]): Promise<void> {
    const wh = await StockService.resolveDefaultWarehouse(tx);
    for (const it of items) {
      if (!it.product_id) continue;
      const recipe = await tx.$queryRaw<{ ingredient_id: string; quantity: string }[]>(
        Prisma.sql`SELECT ingredient_id, quantity FROM product_recipes WHERE product_id = ${it.product_id}::uuid`);
      for (const ing of recipe) {
        const consume = Number(ing.quantity) * Number(it.quantity);
        if (consume <= 0) continue;
        if (wh) {
          await StockService.applyMovement(tx, {
            productId: ing.ingredient_id, warehouseId: wh, type: 'OUT', quantity: -consume,
            reference: 'Consumo de receita (restaurante)', allowNegative: true,
          });
        } else {
          await tx.$executeRaw(Prisma.sql`UPDATE products SET stock_qty = stock_qty - ${consume} WHERE id = ${ing.ingredient_id}::uuid`);
        }
      }
    }
  }

  // ── Receitas / fichas técnicas ─────────────────────────────
  getRecipe(schema: string, productId: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`SELECT r.id, r.ingredient_id, r.quantity, p.name AS ingredient_name, p.code AS ingredient_code
        FROM product_recipes r JOIN products p ON p.id = r.ingredient_id
        WHERE r.product_id = ${productId}::uuid ORDER BY p.name`));
  }

  /** Substitui a receita de um prato pela lista indicada (ingrediente + quantidade). */
  async setRecipe(schema: string, productId: string, items: { ingredientCode: string; quantity: number }[]) {
    return this.prisma.runInTenant(schema, async (tx) => {
      await tx.$executeRaw(Prisma.sql`DELETE FROM product_recipes WHERE product_id = ${productId}::uuid`);
      for (const it of items) {
        if (!it.ingredientCode || !(it.quantity > 0)) continue;
        const ing = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM products WHERE code = ${it.ingredientCode} AND is_active = TRUE LIMIT 1`);
        if (!ing[0]) continue;
        if (ing[0].id === productId) continue; // o prato não pode ser ingrediente de si próprio
        await tx.$executeRaw(Prisma.sql`INSERT INTO product_recipes (product_id, ingredient_id, quantity)
          VALUES (${productId}::uuid, ${ing[0].id}::uuid, ${it.quantity})
          ON CONFLICT (product_id, ingredient_id) DO UPDATE SET quantity = EXCLUDED.quantity`);
      }
      // CUSTO DO PRATO = soma do custo dos ingredientes (ficha técnica). Assim o
      // lucro no caixa = preço de venda − custo dos ingredientes consumidos.
      await tx.$executeRaw(Prisma.sql`
        UPDATE products SET cost_price = COALESCE((
          SELECT SUM(r.quantity * ing.cost_price)
          FROM product_recipes r JOIN products ing ON ing.id = r.ingredient_id
          WHERE r.product_id = ${productId}::uuid), 0), updated_at = now()
        WHERE id = ${productId}::uuid`);
      return { ok: true };
    });
  }

  /** Recalcula o custo (ficha técnica) de TODOS os pratos com receita — útil
   *  quando o custo dos ingredientes muda (nova compra altera o custo médio). */
  async recomputeAllRecipeCosts(schema: string) {
    await this.prisma.runInTenant(schema, (tx) => tx.$executeRaw(Prisma.sql`
      UPDATE products p SET cost_price = sub.c, updated_at = now()
      FROM (SELECT r.product_id, SUM(r.quantity * ing.cost_price) AS c
            FROM product_recipes r JOIN products ing ON ing.id = r.ingredient_id
            GROUP BY r.product_id) sub
      WHERE p.id = sub.product_id`));
    return { ok: true };
  }

  async cancelOrder(schema: string, orderId: string) {
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE restaurant_orders SET status = 'CANCELLED', closed_at = now() WHERE id = ${orderId}::uuid AND status = 'OPEN'`));
    return { ok: true };
  }

  /** Ecrã de cozinha (KDS): itens por preparar/em preparação, com a mesa. */
  async kitchen(schema: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT i.id, i.description, i.quantity, i.kitchen_status, i.notes, i.created_at,
          o.table_name, o.id AS order_id
        FROM restaurant_order_items i
        JOIN restaurant_orders o ON o.id = i.order_id
        WHERE o.status = 'OPEN' AND i.kitchen_status IN ('PENDING','PREPARING')
        ORDER BY i.created_at`),
    );
  }
}
