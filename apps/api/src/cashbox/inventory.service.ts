import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../erp/stock.service';
import { TenantAuditService } from './tenant-audit.service';
import { allocateDocumentNumber, formatCounterNumber } from '../common/document-counter';
import type { CountItemDto, CreateCountDto, StockWriteOffDto } from './dto/cashbox.dto';

interface Actor { id?: string | null; name?: string | null }

/**
 * Inventário profissional:
 *  • baixa de stock (quebra/perda) com motivo obrigatório — auditada
 *  • contagens de inventário: cria a folha com o saldo do sistema, o operador
 *    regista a contagem física, e ao fechar aplica os ajustes (ADJUST) ao stock,
 *    tudo auditado. (estilo supermercado: contagem cíclica/anual)
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: TenantAuditService,
  ) {}

  /** Baixa de stock (quebra/perda/avaria) — movimento OUT auditado. */
  async writeOff(schema: string, dto: StockWriteOffDto, actor: Actor): Promise<{ balanceAfter: number }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const balanceAfter = await StockService.applyMovement(tx, {
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        type: 'ADJUST',
        quantity: -Math.abs(dto.quantity),
        reference: `Baixa: ${dto.reason}`,
        createdBy: actor.id ?? null,
        allowNegative: false,
      });
      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name, action: 'STOCK_WRITE_OFF',
        entity: 'product', entityId: dto.productId,
        details: { warehouseId: dto.warehouseId, quantity: dto.quantity, reason: dto.reason, balanceAfter },
      });
      return { balanceAfter };
    });
  }

  /** Cria uma folha de contagem com o saldo actual do sistema para o armazém. */
  async createCount(schema: string, dto: CreateCountDto, actor: Actor): Promise<{ id: string; reference: string }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const year = new Date().getFullYear();
      const seq = await allocateDocumentNumber(tx, 'INV', year);
      const reference = formatCounterNumber('INV', year, seq);

      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO stock_counts (warehouse_id, reference, status, notes, created_by)
          VALUES (${dto.warehouseId}::uuid, ${reference}, 'COUNTING', ${dto.notes ?? null}, ${actor.id ?? null}::uuid)
          RETURNING id`,
      );
      const countId = rows[0].id;

      // Snapshot do stock do armazém para esta folha.
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO stock_count_items (count_id, product_id, product_code, description, system_qty)
          SELECT ${countId}::uuid, p.id, p.code, p.name, COALESCE(si.quantity, 0)
          FROM products p
          LEFT JOIN stock_items si ON si.product_id = p.id AND si.warehouse_id = ${dto.warehouseId}::uuid
          WHERE p.is_active = TRUE`,
      );

      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name, action: 'INVENTORY_OPEN',
        entity: 'stock_count', entityId: countId, details: { reference, warehouseId: dto.warehouseId },
      });
      return { id: countId, reference };
    });
  }

  /** Lista as folhas de contagem. */
  listCounts(schema: string): Promise<unknown[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT sc.id, sc.reference, sc.status, sc.created_at, sc.closed_at, w.name AS warehouse_name,
                          (SELECT COUNT(*)::int FROM stock_count_items WHERE count_id = sc.id) AS items
                   FROM stock_counts sc JOIN stores w ON w.id = sc.warehouse_id
                   ORDER BY sc.created_at DESC LIMIT 100`,
      ),
    );
  }

  /** Detalhe de uma folha (itens com diferenças). */
  async getCount(schema: string, id: string): Promise<unknown> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const head = await tx.$queryRaw<{ id: string; reference: string; status: string; warehouse_id: string }[]>(
        Prisma.sql`SELECT id, reference, status, warehouse_id FROM stock_counts WHERE id = ${id}::uuid LIMIT 1`,
      );
      if (!head[0]) throw new NotFoundException('Contagem não encontrada');
      const items = await tx.$queryRaw(
        Prisma.sql`SELECT id, product_id, product_code, description, system_qty, counted_qty, difference
                   FROM stock_count_items WHERE count_id = ${id}::uuid ORDER BY description`,
      );
      return { ...head[0], items };
    });
  }

  /** Regista a contagem física de um item (calcula a diferença). */
  async countItem(schema: string, countId: string, dto: CountItemDto): Promise<void> {
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(
        Prisma.sql`UPDATE stock_count_items
            SET counted_qty = ${dto.countedQty},
                difference = ${dto.countedQty} - system_qty
            WHERE count_id = ${countId}::uuid AND product_id = ${dto.productId}::uuid`,
      ),
    );
  }

  // ── Lotes & validade (FEFO) ────────────────────────────────
  /** Regista um lote com validade (e dá entrada de stock se quantidade > 0). */
  async addBatch(
    schema: string,
    dto: { productId: string; warehouseId: string; batchCode?: string; quantity: number; expiryDate?: string },
    actor: Actor,
  ): Promise<{ id: string }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO product_batches (product_id, warehouse_id, batch_code, quantity, expiry_date)
          VALUES (${dto.productId}::uuid, ${dto.warehouseId}::uuid, ${dto.batchCode ?? null},
                  ${dto.quantity}, ${dto.expiryDate ?? null}::date)
          RETURNING id`,
      );
      if (dto.quantity > 0) {
        await StockService.applyMovement(tx, {
          productId: dto.productId, warehouseId: dto.warehouseId, type: 'IN', quantity: dto.quantity,
          reference: `Lote ${dto.batchCode ?? ''}`.trim(), createdBy: actor.id ?? null, allowNegative: true,
        });
        await this.audit.recordInTx(tx, {
          actorId: actor.id, actorName: actor.name, action: 'STOCK_IN', entity: 'product_batch', entityId: rows[0].id,
          details: { productId: dto.productId, quantity: dto.quantity, expiryDate: dto.expiryDate ?? null, batch: dto.batchCode ?? null },
        });
      }
      return rows[0];
    });
  }

  /** Lotes a expirar em <= `days` dias (ou já expirados). */
  expiring(schema: string, days = 30): Promise<unknown[]> {
    const d = Math.min(Math.max(days, 1), 365);
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT b.id, b.batch_code, b.quantity, b.expiry_date, p.name AS product_name,
                          (b.expiry_date - CURRENT_DATE) AS days_left
                   FROM product_batches b JOIN products p ON p.id = b.product_id
                   WHERE b.quantity > 0 AND b.expiry_date IS NOT NULL
                     AND b.expiry_date <= CURRENT_DATE + ${d}::int
                   ORDER BY b.expiry_date ASC LIMIT 100`,
      ),
    );
  }

  /**
   * Transferência de stock entre armazéns (atómica): OUT de origem + IN no
   * destino, com o mesmo nº de guia. Auditada. Não permite saldo negativo na
   * origem (transferência é movimento real de mercadoria).
   */
  async transfer(
    schema: string,
    dto: { productId: string; fromWarehouseId: string; toWarehouseId: string; quantity: number },
    actor: Actor,
  ): Promise<{ reference: string }> {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('Origem e destino têm de ser armazéns diferentes.');
    }
    return this.prisma.runInTenant(schema, async (tx) => {
      const year = new Date().getFullYear();
      const seq = await allocateDocumentNumber(tx, 'TRF', year);
      const reference = formatCounterNumber('TRF', year, seq);
      // saída da origem (bloqueia se não houver stock)
      await StockService.applyMovement(tx, {
        productId: dto.productId, warehouseId: dto.fromWarehouseId, type: 'TRANSFER',
        quantity: -Math.abs(dto.quantity), reference: `${reference} (saída)`, createdBy: actor.id ?? null,
        allowNegative: false,
      });
      // entrada no destino
      await StockService.applyMovement(tx, {
        productId: dto.productId, warehouseId: dto.toWarehouseId, type: 'TRANSFER',
        quantity: Math.abs(dto.quantity), reference: `${reference} (entrada)`, createdBy: actor.id ?? null,
        allowNegative: true,
      });
      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name, action: 'STOCK_TRANSFER',
        entity: 'product', entityId: dto.productId,
        details: { reference, from: dto.fromWarehouseId, to: dto.toWarehouseId, quantity: dto.quantity },
      });
      return { reference };
    });
  }

  /**
   * Previsão de reposição: para cada produto, calcula a média diária de vendas
   * dos últimos `days` dias (a partir dos movimentos OUT) e estima os dias de
   * stock restantes. Sugere reposição quando dias_restantes <= leadDays.
   */
  forecast(schema: string, days = 30, leadDays = 7): Promise<unknown[]> {
    const d = Math.min(Math.max(days, 7), 180);
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(
        Prisma.sql`
          WITH sold AS (
            SELECT product_id, SUM(-quantity) AS qty_sold
            FROM stock_movements
            WHERE type = 'OUT' AND created_at >= now() - (${d}::int || ' days')::interval
            GROUP BY product_id
          )
          SELECT p.id, p.code, p.name, p.stock_qty::float AS stock,
                 COALESCE(s.qty_sold, 0)::float AS sold,
                 ROUND((COALESCE(s.qty_sold,0) / ${d}::numeric), 3)::float AS avg_per_day,
                 CASE WHEN COALESCE(s.qty_sold,0) > 0
                      THEN ROUND(p.stock_qty / (s.qty_sold / ${d}::numeric), 1)::float
                      ELSE NULL END AS days_left
          FROM products p
          LEFT JOIN sold s ON s.product_id = p.id
          WHERE p.is_active = TRUE AND COALESCE(s.qty_sold,0) > 0
            AND (p.stock_qty / NULLIF(s.qty_sold / ${d}::numeric, 0)) <= ${leadDays}::numeric
          ORDER BY days_left ASC NULLS LAST
          LIMIT 100`,
      ),
    );
  }

  /**
   * Fecha a contagem: aplica os ajustes (ADJUST) ao stock para cada item com
   * diferença, e marca a folha como CLOSED. Tudo auditado.
   */
  async closeCount(schema: string, countId: string, actor: Actor): Promise<{ adjusted: number }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const head = await tx.$queryRaw<{ status: string; warehouse_id: string; reference: string }[]>(
        Prisma.sql`SELECT status, warehouse_id, reference FROM stock_counts WHERE id = ${countId}::uuid FOR UPDATE`,
      );
      if (!head[0]) throw new NotFoundException('Contagem não encontrada');
      if (head[0].status === 'CLOSED') throw new BadRequestException('Contagem já fechada.');

      const items = await tx.$queryRaw<{ product_id: string; counted_qty: string | null; system_qty: string }[]>(
        Prisma.sql`SELECT product_id, counted_qty, system_qty FROM stock_count_items
                   WHERE count_id = ${countId}::uuid AND counted_qty IS NOT NULL`,
      );

      let adjusted = 0;
      for (const it of items) {
        const counted = Number(it.counted_qty);
        const system = Number(it.system_qty);
        const delta = counted - system;
        if (delta === 0) continue;
        await StockService.applyMovement(tx, {
          productId: it.product_id,
          warehouseId: head[0].warehouse_id,
          type: 'ADJUST',
          quantity: delta,
          reference: `Inventário ${head[0].reference}`,
          referenceId: countId,
          createdBy: actor.id ?? null,
          allowNegative: true,
        });
        adjusted += 1;
      }

      await tx.$executeRaw(
        Prisma.sql`UPDATE stock_counts SET status = 'CLOSED', closed_at = now() WHERE id = ${countId}::uuid`,
      );
      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name, action: 'INVENTORY_CLOSE',
        entity: 'stock_count', entityId: countId,
        details: { reference: head[0].reference, itemsAdjusted: adjusted },
      });
      return { adjusted };
    });
  }
}
