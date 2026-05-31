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
    if (balanceAfter < 0) {
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
    return balanceAfter;
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
