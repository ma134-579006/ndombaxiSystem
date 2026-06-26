import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

  /** Fecha a comanda (a conta). O pagamento/fatura é feito no caixa. */
  async closeOrder(schema: string, orderId: string) {
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE restaurant_orders SET status = 'CLOSED', closed_at = now() WHERE id = ${orderId}::uuid AND status = 'OPEN'`));
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
