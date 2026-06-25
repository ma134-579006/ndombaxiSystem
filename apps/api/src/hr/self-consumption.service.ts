import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IVA_RATE, IvaCode, isIvaCode } from '@nexus/agt-xml';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../erp/stock.service';

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtKz = (n: number) => `${n.toLocaleString('pt-PT')} Kz`;

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

  /**
   * Limite de consumo do MÊS CORRENTE: salário mensal − consumo já registado
   * neste mês. O funcionário nunca pode exceder o salário; ao atingir o limite
   * fica bloqueado até ao mês seguinte. Sincroniza com RH (salário do employee).
   */
  private async monthlyCap(
    tx: Prisma.TransactionClient,
    employeeId: string,
  ): Promise<{ monthlyPay: number; consumed: number; available: number }> {
    const rows = await tx.$queryRaw<{ pay: string; consumed: string }[]>(
      Prisma.sql`SELECT
          (COALESCE(e.base_salary,0)+COALESCE(e.taxable_allowances,0)+COALESCE(e.exempt_allowances,0))::text AS pay,
          COALESCE((SELECT SUM(c.total) FROM employee_consumptions c
                    WHERE c.employee_id = e.id
                      AND c.created_at >= date_trunc('month', now())),0)::text AS consumed
        FROM employees e WHERE e.id = ${employeeId}::uuid`,
    );
    const monthlyPay = round2(Number(rows[0]?.pay) || 0);
    const consumed = round2(Number(rows[0]?.consumed) || 0);
    const available = Math.max(0, round2(monthlyPay - consumed));
    return { monthlyPay, consumed, available };
  }

  /** Valida que o consumo cabe no limite do mês; lança erro claro caso contrário. */
  private assertWithinCap(
    cap: { monthlyPay: number; consumed: number; available: number },
    amount: number,
  ): void {
    if (cap.monthlyPay <= 0) {
      throw new BadRequestException('O teu salário ainda não está definido em RH. Fala com o gestor.');
    }
    if (cap.available <= 0) {
      throw new BadRequestException(
        `Atingiste o limite de consumo deste mês (salário ${fmtKz(cap.monthlyPay)}). Só podes voltar a consumir no próximo mês.`,
      );
    }
    if (round2(amount) > cap.available) {
      throw new BadRequestException(
        `Este consumo (${fmtKz(round2(amount))}) excede o que ainda podes consumir este mês (${fmtKz(cap.available)}).`,
      );
    }
  }

  /** Limite disponível do funcionário (para a aba do operador no POS). */
  async limit(
    schema: string,
    actor: ConsumptionActor,
  ): Promise<{ monthlyPay: number; consumed: number; available: number; employeeLinked: boolean }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const emp = await this.resolveEmployee(tx, actor.userId, actor.name);
      if (!emp) return { monthlyPay: 0, consumed: 0, available: 0, employeeLinked: false };
      const cap = await this.monthlyCap(tx, emp.id);
      return { ...cap, employeeLinked: true };
    });
  }

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
      if (!emp) throw new BadRequestException('Sem ficha de funcionário associada. Fala com o gestor para te registar em RH.');
      // Limite do mês: nunca pode exceder o salário mensal (bloqueia até ao mês seguinte).
      this.assertWithinCap(await this.monthlyCap(tx, emp.id), total);

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

  /**
   * Regista VÁRIOS consumos de uma só vez (carrinho), numa transacção única:
   * resolve o funcionário uma vez, baixa o stock e cria os lançamentos PENDING.
   */
  async registerMany(
    schema: string,
    actor: ConsumptionActor,
    items: { productId: string; quantity: number }[],
  ): Promise<{ registered: number; total: number; employeeLinked: boolean }> {
    const clean = (items ?? []).filter((i) => i.productId && Number(i.quantity) > 0);
    if (clean.length === 0) throw new BadRequestException('Sem itens para registar.');

    return this.prisma.runInTenant(schema, async (tx) => {
      const emp = await this.resolveEmployee(tx, actor.userId, actor.name);
      if (!emp) throw new BadRequestException('Sem ficha de funcionário associada. Fala com o gestor para te registar em RH.');
      const cap = await this.monthlyCap(tx, emp.id);
      if (cap.monthlyPay <= 0) throw new BadRequestException('O teu salário ainda não está definido em RH. Fala com o gestor.');
      if (cap.available <= 0) throw new BadRequestException(`Atingiste o limite de consumo deste mês (salário ${fmtKz(cap.monthlyPay)}). Só podes voltar a consumir no próximo mês.`);
      let total = 0;
      let registered = 0;

      for (const it of clean) {
        const qty = Number(it.quantity);
        const prods = await tx.$queryRaw<
          { id: string; code: string; name: string; unit_price: string; iva_code: string; shared_stock: boolean }[]
        >(
          Prisma.sql`SELECT id, code, name, unit_price, iva_code, shared_stock
                     FROM products WHERE id = ${it.productId}::uuid LIMIT 1`,
        );
        const p = prods[0];
        if (!p) continue; // ignora produtos inexistentes (não falha o lote)

        const rate = isIvaCode(p.iva_code) ? IVA_RATE[p.iva_code as IvaCode] : 0;
        const unitGross = Math.round(Number(p.unit_price) * (1 + rate / 100) * 100) / 100;
        const lineTotal = Math.round(unitGross * qty * 100) / 100;

        // Não deixa o total do carrinho exceder o limite do mês (salário restante).
        if (round2(total + lineTotal) > cap.available) {
          throw new BadRequestException(
            `Este consumo excede o que ainda podes consumir este mês (${fmtKz(cap.available)}). Reduz a quantidade ou aguarda o próximo mês.`,
          );
        }

        if (!p.shared_stock && actor.storeId) {
          await StockService.applyMovement(tx, {
            productId: p.id, warehouseId: actor.storeId, type: 'OUT', quantity: -qty,
            reference: 'CONSUMO PRÓPRIO', createdBy: actor.userId ?? null, allowNegative: true,
          });
        } else {
          await tx.$executeRaw(
            Prisma.sql`UPDATE products SET stock_qty = stock_qty - ${qty}, updated_at = now()
                       WHERE id = ${p.id}::uuid`,
          );
        }

        await tx.$executeRaw(
          Prisma.sql`INSERT INTO employee_consumptions
              (user_id, employee_id, staff_name, product_id, product_code, description,
               quantity, unit_price, total, reason, status, store_id)
            VALUES (${actor.userId ?? null}::uuid, ${emp?.id ?? null}::uuid,
                    ${emp?.full_name ?? actor.name ?? 'Funcionário'}, ${p.id}::uuid,
                    ${p.code}, ${p.name}, ${qty}, ${unitGross}, ${lineTotal},
                    'SELF_CONSUMPTION', 'PENDING', ${actor.storeId ?? null}::uuid)`,
        );
        total += lineTotal;
        registered += 1;
      }

      if (registered === 0) throw new NotFoundException('Nenhum produto válido para registar.');
      return { registered, total: Math.round(total * 100) / 100, employeeLinked: !!emp };
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
