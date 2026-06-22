import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IVA_RATE, IvaCode, isIvaCode } from '@nexus/agt-xml';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../erp/stock.service';

export interface ConsumptionRow {
  id: string;
  user_id: string | null;
  employee_id: string | null;
  staff_name: string;
  product_id: string | null;
  product_code: string;
  description: string;
  quantity: string;
  unit_price: string;
  total: string;
  reason: string;
  status: string;
  payroll_item_id: string | null;
  store_id: string | null;
  created_at: Date;
}

export interface ConsumptionActor {
  userId?: string | null;
  name?: string | null;
  storeId?: string | null;
}

/**
 * Consumo próprio dos funcionários (em especial o operador de caixa): regista o
 * produto consumido, baixa o stock e cria um lançamento PENDING que a folha
 * salarial desconta automaticamente no salário (motivo: consumo próprio).
 */
@Injectable()
export class SelfConsumptionService {
  constructor(private readonly prisma: PrismaService) {}

  async register(
    schema: string,
    actor: ConsumptionActor,
    input: { productId: string; quantity: number },
  ): Promise<ConsumptionRow & { employeeLinked: boolean }> {
    const qty = Number(input.quantity);
    if (!Number.isFinite(qty) || qty <= 0) throw new BadRequestException('Quantidade inválida.');
    if (!input.productId) throw new BadRequestException('Produto em falta.');

    return this.prisma.runInTenant(schema, async (tx) => {
      const prods = await tx.$queryRaw<
        { id: string; code: string; name: string; unit_price: string; iva_code: string; shared_stock: boolean }[]
      >(
        Prisma.sql`SELECT id, code, name, unit_price, iva_code, shared_stock
                   FROM products WHERE id = ${input.productId}::uuid LIMIT 1`,
      );
      const p = prods[0];
      if (!p) throw new NotFoundException('Produto não encontrado.');

      // Preço com IVA (o operador "paga" o preço de venda) → valor a descontar.
      const rate = isIvaCode(p.iva_code) ? IVA_RATE[p.iva_code as IvaCode] : 0;
      const unitGross = Math.round(Number(p.unit_price) * (1 + rate / 100) * 100) / 100;
      const total = Math.round(unitGross * qty * 100) / 100;

      const emp = await this.resolveEmployee(tx, actor.userId, actor.name);

      // Baixa de stock: por loja (movimento auditável) ou no espelho global.
      if (!p.shared_stock && actor.storeId) {
        await StockService.applyMovement(tx, {
          productId: p.id,
          warehouseId: actor.storeId,
          type: 'OUT',
          quantity: -qty,
          reference: 'CONSUMO PRÓPRIO',
          createdBy: actor.userId ?? null,
          allowNegative: true,
        });
      } else {
        await tx.$executeRaw(
          Prisma.sql`UPDATE products SET stock_qty = stock_qty - ${qty}, updated_at = now()
                     WHERE id = ${p.id}::uuid`,
        );
      }

      const rows = await tx.$queryRaw<ConsumptionRow[]>(
        Prisma.sql`INSERT INTO employee_consumptions
            (user_id, employee_id, staff_name, product_id, product_code, description,
             quantity, unit_price, total, reason, status, store_id)
          VALUES (${actor.userId ?? null}::uuid, ${emp?.id ?? null}::uuid,
                  ${emp?.full_name ?? actor.name ?? 'Funcionário'}, ${p.id}::uuid,
                  ${p.code}, ${p.name}, ${qty}, ${unitGross}, ${total},
                  'SELF_CONSUMPTION', 'PENDING', ${actor.storeId ?? null}::uuid)
          RETURNING *`,
      );
      return { ...rows[0], employeeLinked: !!emp };
    });
  }

  /** Encontra o funcionário ligado ao login; tenta auto-ligar por nome único. */
  private async resolveEmployee(
    tx: Prisma.TransactionClient,
    userId?: string | null,
    name?: string | null,
  ): Promise<{ id: string; full_name: string } | null> {
    if (userId) {
      const byUser = await tx.$queryRaw<{ id: string; full_name: string }[]>(
        Prisma.sql`SELECT id, full_name FROM employees
                   WHERE user_id = ${userId}::uuid AND status = 'ACTIVE' LIMIT 1`,
      );
      if (byUser[0]) return byUser[0];
    }
    if (name && name.trim()) {
      const byName = await tx.$queryRaw<{ id: string; full_name: string }[]>(
        Prisma.sql`SELECT id, full_name FROM employees
                   WHERE status = 'ACTIVE' AND user_id IS NULL
                     AND lower(full_name) = lower(${name.trim()}) LIMIT 2`,
      );
      if (byName.length === 1) {
        if (userId) {
          await tx.$executeRaw(
            Prisma.sql`UPDATE employees SET user_id = ${userId}::uuid, updated_at = now()
                       WHERE id = ${byName[0].id}::uuid`,
          );
        }
        return byName[0];
      }
    }
    return null;
  }

  /** Consumos do próprio utilizador (para a aba do operador). */
  listMine(schema: string, userId: string, limit = 50): Promise<ConsumptionRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<ConsumptionRow[]>(
        Prisma.sql`SELECT * FROM employee_consumptions
                   WHERE user_id = ${userId}::uuid
                   ORDER BY created_at DESC LIMIT ${limit}`,
      ),
    );
  }

  /** Todos os consumos (vista do RH/gestor); filtra por estado opcional. */
  listAll(schema: string, status?: string): Promise<ConsumptionRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<ConsumptionRow[]>(
        status
          ? Prisma.sql`SELECT * FROM employee_consumptions WHERE status = ${status} ORDER BY created_at DESC`
          : Prisma.sql`SELECT * FROM employee_consumptions ORDER BY created_at DESC`,
      ),
    );
  }
}
