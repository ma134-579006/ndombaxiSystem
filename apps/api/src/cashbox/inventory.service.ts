import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../erp/stock.service';
import { TenantAuditService } from './tenant-audit.service';
import { allocateDocumentNumber, formatCounterNumber } from '../common/document-counter';
import type { CountItemDto, CreateCountDto, StockWriteOffDto } from './dto/cashbox.dto';
import { luandaYear } from '../common/luanda-date';

interface Actor { id?: string | null; name?: string | null }

export interface StockCheckRow { id: string; code: string; name: string; isActive: boolean; shown: number; stores: number }
export interface StockCheck {
  checked: number;
  semSaldoPorLoja: { total: number; items: StockCheckRow[] };
  diferencas: { total: number; items: StockCheckRow[] };
}

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
      // Coordena com os LOTES: abate primeiro os de validade mais próxima (FEFO),
      // para o lote caducado SAIR da lista de validades após a baixa.
      let remaining = Math.abs(dto.quantity);
      const lots = await tx.$queryRaw<{ id: string; quantity: number }[]>(Prisma.sql`
        SELECT id, quantity::float AS quantity FROM product_batches
        WHERE product_id = ${dto.productId}::uuid AND warehouse_id = ${dto.warehouseId}::uuid AND quantity > 0
        ORDER BY expiry_date ASC NULLS LAST`);
      for (const lot of lots) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, lot.quantity);
        await tx.$executeRaw(Prisma.sql`UPDATE product_batches SET quantity = quantity - ${take} WHERE id = ${lot.id}::uuid`);
        remaining -= take;
      }
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
      await this.assertActiveStore(tx, dto.warehouseId);
      // Uma contagem aberta por loja: duas contagens em paralelo aplicavam o mesmo acerto duas vezes.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${'stock-count:' + dto.warehouseId}))`);
      const aberta = await tx.$queryRaw<{ reference: string }[]>(Prisma.sql`
        SELECT reference FROM stock_counts WHERE warehouse_id = ${dto.warehouseId}::uuid AND status = 'COUNTING' LIMIT 1`);
      if (aberta[0]) throw new BadRequestException(`Já existe uma contagem aberta nesta loja (${aberta[0].reference}). Feche-a primeiro.`);
      const year = luandaYear();
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

  /**
   * Regista a contagem física de um item. O saldo do sistema é re-lido NO
   * MOMENTO da contagem (vendas feitas entre abrir a folha e contar já estão
   * refletidas na prateleira) — assim o ajuste ao fechar não as conta duas vezes.
   */
  async countItem(schema: string, countId: string, dto: CountItemDto): Promise<void> {
    await this.prisma.runInTenant(schema, async (tx) => {
      const head = await tx.$queryRaw<{ status: string; warehouse_id: string }[]>(
        Prisma.sql`SELECT status, warehouse_id FROM stock_counts WHERE id = ${countId}::uuid LIMIT 1`,
      );
      if (!head[0]) throw new NotFoundException('Contagem não encontrada');
      if (head[0].status === 'CLOSED') throw new BadRequestException('Contagem já fechada — abra uma nova folha.');
      const n = await tx.$executeRaw(
        Prisma.sql`UPDATE stock_count_items i
            SET system_qty = COALESCE((SELECT si.quantity FROM stock_items si
                                       WHERE si.product_id = i.product_id
                                         AND si.warehouse_id = ${head[0].warehouse_id}::uuid), 0),
                counted_qty = ${dto.countedQty},
                difference = ${dto.countedQty} - COALESCE((SELECT si.quantity FROM stock_items si
                                       WHERE si.product_id = i.product_id
                                         AND si.warehouse_id = ${head[0].warehouse_id}::uuid), 0)
            WHERE i.count_id = ${countId}::uuid AND i.product_id = ${dto.productId}::uuid`,
      );
      if (n === 0) throw new NotFoundException('Produto não pertence a esta contagem.');
    });
  }

  // ── Lotes & validade (FEFO) ────────────────────────────────
  /** Regista um lote com validade (e dá entrada de stock se quantidade > 0). */
  async addBatch(
    schema: string,
    dto: { productId: string; warehouseId: string; batchCode?: string; quantity: number; expiryDate?: string },
    actor: Actor,
  ): Promise<{ id: string }> {
    // O corpo chega sem DTO validado: "5" (string) somava como texto ("5"+"10").
    const quantity = Number(dto.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) throw new BadRequestException('Quantidade do lote inválida.');
    dto = { ...dto, quantity };
    return this.prisma.runInTenant(schema, async (tx) => {
      await this.assertActiveStore(tx, dto.warehouseId);
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
    const quantity = Number(dto.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new BadRequestException('Quantidade inválida.');
    dto = { ...dto, quantity };
    return this.prisma.runInTenant(schema, async (tx) => {
      await this.assertActiveStore(tx, dto.fromWarehouseId);
      await this.assertActiveStore(tx, dto.toWarehouseId);
      const year = luandaYear();
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

  private async assertActiveStore(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const r = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM stores WHERE id::text = ${id} AND is_active = TRUE LIMIT 1`,
    );
    if (!r[0]) throw new BadRequestException('Loja/armazém inexistente ou inativo.');
  }

  // ── Verificação de coerência do stock ──────────────────────
  /**
   * O stock tem DOIS números que têm de bater: `products.stock_qty` (o que o cartão
   * do produto, o Caixa e a loja mostram) e a soma dos saldos por loja
   * (`stock_items`, onde as vendas e entradas realmente mexem). Só relata:
   *  • `semSaldoPorLoja` — mostra stock mas não tem saldo em nenhuma loja (típico de
   *    produtos migrados/importados). Reparável sem ambiguidade (ver stockRepair).
   *  • `diferencas` — os dois números diferem. NÃO se corrige sozinho: não há como saber
   *    qual dos dois é o certo (ex.: vendas feitas depois da migração deixam a soma por
   *    loja negativa e o total certo). Resolve-se com uma contagem de inventário.
   */
  async stockCheck(schema: string): Promise<StockCheck> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const semWhere = Prisma.sql`COALESCE(p.is_production, FALSE) = FALSE AND p.stock_qty <> 0
        AND NOT EXISTS (SELECT 1 FROM stock_items si WHERE si.product_id = p.id)`;
      const semSaldoPorLoja = await tx.$queryRaw<StockCheckRow[]>(Prisma.sql`
        SELECT p.id, p.code, p.name, p.is_active AS "isActive", p.stock_qty::float AS shown, 0::float AS stores
        FROM products p WHERE ${semWhere} ORDER BY p.name LIMIT 200`);
      const semTotal = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS n FROM products p WHERE ${semWhere}`);
      const difFrom = Prisma.sql`FROM products p
        JOIN (SELECT product_id, SUM(quantity) AS total FROM stock_items GROUP BY product_id) s ON s.product_id = p.id
        WHERE ROUND(p.stock_qty::numeric, 3) <> ROUND(s.total::numeric, 3)`;
      const diferencas = await tx.$queryRaw<StockCheckRow[]>(Prisma.sql`
        SELECT p.id, p.code, p.name, p.is_active AS "isActive", p.stock_qty::float AS shown, s.total::float AS stores
        ${difFrom} ORDER BY p.name LIMIT 200`);
      const difTotal = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n ${difFrom}`);
      const checked = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM products`);
      return {
        checked: checked[0]?.n ?? 0,
        semSaldoPorLoja: { total: semTotal[0]?.n ?? 0, items: semSaldoPorLoja },
        diferencas: { total: difTotal[0]?.n ?? 0, items: diferencas },
      };
    });
  }

  /**
   * Repara só o caso SEM ambiguidade: produto com stock mas sem saldo em nenhuma loja.
   * Cria o saldo na loja principal (igual ao total mostrado) com um movimento
   * "Saldo inicial (acerto)" — o total mostrado NÃO muda, apenas passa a existir o saldo
   * por loja que as vendas e as contagens usam. Auditado.
   */
  async stockRepair(schema: string, actor: Actor): Promise<{ fixed: number }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const store = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM stores WHERE is_active = TRUE ORDER BY is_default DESC, created_at ASC LIMIT 1`,
      );
      if (!store[0]) throw new BadRequestException('Não há nenhuma loja ativa onde registar o saldo.');
      const where = Prisma.sql`COALESCE(p.is_production, FALSE) = FALSE AND p.stock_qty > 0
        AND NOT EXISTS (SELECT 1 FROM stock_items si WHERE si.product_id = p.id)`;
      // Movimento primeiro (a condição depende de ainda não haver stock_items).
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO stock_movements (product_id, warehouse_id, type, quantity, balance_after, reference, created_by)
        SELECT p.id, ${store[0].id}::uuid, 'ADJUST', p.stock_qty, p.stock_qty, 'Saldo inicial (acerto)', ${actor.id ?? null}::uuid
        FROM products p WHERE ${where}`);
      const fixed = await tx.$executeRaw(Prisma.sql`
        INSERT INTO stock_items (product_id, warehouse_id, quantity)
        SELECT p.id, ${store[0].id}::uuid, p.stock_qty FROM products p WHERE ${where}
        ON CONFLICT (product_id, warehouse_id) DO NOTHING`);
      if (fixed > 0) {
        await this.audit.recordInTx(tx, {
          actorId: actor.id, actorName: actor.name, action: 'STOCK_RECONCILE', entity: 'product',
          details: { fixed, storeId: store[0].id },
        });
      }
      return { fixed };
    });
  }
}
