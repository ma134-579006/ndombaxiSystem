import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AdvanceActor { userId?: string | null; name?: string | null; storeId?: string | null }

export interface AdvanceRow {
  id: string; user_id: string | null; employee_id: string | null; staff_name: string;
  amount: string; reason: string | null; status: string; requested_at: Date;
  reviewer_name: string | null; reviewed_at: Date | null; review_note: string | null;
  period_year: number | null; period_month: number | null;
}

interface EmpSalary { id: string; full_name: string; monthlyPay: number }

/**
 * Adiantamento salarial: o funcionário (em especial o caixa) pede um adiantamento
 * (1 Kz até ao que ganha), o gestor/gerente aprova ou rejeita, e ao processar a
 * folha do mês do PAGAMENTO o valor aprovado é descontado automaticamente — no
 * mês exato — e fica DEDUCTED. O limite nunca excede o salário do funcionário
 * (menos adiantamentos por descontar).
 */
@Injectable()
export class SalaryAdvanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Encontra o funcionário ligado ao login (auto-liga por nome único) + salário. */
  private async resolveEmployee(
    tx: Prisma.TransactionClient, userId?: string | null, name?: string | null,
  ): Promise<EmpSalary | null> {
    const pay = (r: { base_salary: string; taxable_allowances: string; exempt_allowances: string }) =>
      Math.round((Number(r.base_salary) + Number(r.taxable_allowances) + Number(r.exempt_allowances)) * 100) / 100;
    type Row = { id: string; full_name: string; base_salary: string; taxable_allowances: string; exempt_allowances: string };
    if (userId) {
      const byUser = await tx.$queryRaw<Row[]>(
        Prisma.sql`SELECT id, full_name, base_salary, taxable_allowances, exempt_allowances
                   FROM employees WHERE user_id = ${userId}::uuid AND status = 'ACTIVE' LIMIT 1`,
      );
      if (byUser[0]) return { id: byUser[0].id, full_name: byUser[0].full_name, monthlyPay: pay(byUser[0]) };
    }
    if (name && name.trim()) {
      const byName = await tx.$queryRaw<Row[]>(
        Prisma.sql`SELECT id, full_name, base_salary, taxable_allowances, exempt_allowances
                   FROM employees WHERE status = 'ACTIVE' AND user_id IS NULL
                     AND lower(full_name) = lower(${name.trim()}) LIMIT 2`,
      );
      if (byName.length === 1) {
        if (userId) {
          await tx.$executeRaw(Prisma.sql`UPDATE employees SET user_id = ${userId}::uuid, updated_at = now() WHERE id = ${byName[0].id}::uuid`);
        }
        return { id: byName[0].id, full_name: byName[0].full_name, monthlyPay: pay(byName[0]) };
      }
    }
    return null;
  }

  /** Soma dos adiantamentos por descontar (PENDING+APPROVED) deste funcionário. */
  private async outstanding(tx: Prisma.TransactionClient, employeeId: string): Promise<number> {
    const rows = await tx.$queryRaw<{ total: string }[]>(
      Prisma.sql`SELECT COALESCE(SUM(amount),0)::text AS total FROM salary_advances
                 WHERE employee_id = ${employeeId}::uuid AND status IN ('PENDING','APPROVED')`,
    );
    return Number(rows[0]?.total) || 0;
  }

  /** Limite disponível do funcionário (salário − adiantamentos por descontar). */
  async limit(schema: string, actor: AdvanceActor): Promise<{ monthlyPay: number; outstanding: number; available: number; employeeLinked: boolean }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const emp = await this.resolveEmployee(tx, actor.userId, actor.name);
      if (!emp) return { monthlyPay: 0, outstanding: 0, available: 0, employeeLinked: false };
      const out = await this.outstanding(tx, emp.id);
      const available = Math.max(0, Math.round((emp.monthlyPay - out) * 100) / 100);
      return { monthlyPay: emp.monthlyPay, outstanding: out, available, employeeLinked: true };
    });
  }

  /** O funcionário pede um adiantamento. */
  async request(schema: string, actor: AdvanceActor, amount: number, reason?: string): Promise<AdvanceRow> {
    if (!Number.isFinite(amount) || amount < 1) throw new BadRequestException('O valor mínimo do adiantamento é 1 Kz.');
    const amt = Math.round(amount * 100) / 100;
    return this.prisma.runInTenant(schema, async (tx) => {
      const emp = await this.resolveEmployee(tx, actor.userId, actor.name);
      if (!emp) throw new BadRequestException('Sem ficha de funcionário associada. Fala com o gestor para te registar em RH.');
      if (emp.monthlyPay <= 0) throw new BadRequestException('O teu salário ainda não está definido em RH. Fala com o gestor.');
      const out = await this.outstanding(tx, emp.id);
      const available = Math.max(0, Math.round((emp.monthlyPay - out) * 100) / 100);
      if (amt > available) {
        throw new BadRequestException(`O valor excede o limite disponível (${available.toLocaleString('pt-PT')} Kz). O salário é ${emp.monthlyPay.toLocaleString('pt-PT')} Kz e já tens ${out.toLocaleString('pt-PT')} Kz por descontar.`);
      }
      const rows = await tx.$queryRaw<AdvanceRow[]>(
        Prisma.sql`INSERT INTO salary_advances (user_id, employee_id, staff_name, amount, reason, status, store_id)
          VALUES (${actor.userId ?? null}::uuid, ${emp.id}::uuid, ${emp.full_name}, ${amt}, ${reason?.trim() || null}, 'PENDING', ${actor.storeId ?? null}::uuid)
          RETURNING id, user_id, employee_id, staff_name, amount, reason, status, requested_at, reviewer_name, reviewed_at, review_note, period_year, period_month`,
      );
      return rows[0];
    });
  }

  /** Adiantamentos do próprio utilizador (aba do operador). */
  listMine(schema: string, userId: string, limit = 50): Promise<AdvanceRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<AdvanceRow[]>(
        Prisma.sql`SELECT id, user_id, employee_id, staff_name, amount, reason, status, requested_at, reviewer_name, reviewed_at, review_note, period_year, period_month
                   FROM salary_advances WHERE user_id = ${userId}::uuid ORDER BY requested_at DESC LIMIT ${limit}`,
      ),
    );
  }

  /** Pedidos PENDENTES (para o sino do gestor) — com salário p/ contexto. */
  listPending(schema: string): Promise<(AdvanceRow & { monthly_pay: string | null })[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<(AdvanceRow & { monthly_pay: string | null })[]>(
        Prisma.sql`SELECT a.id, a.user_id, a.employee_id, a.staff_name, a.amount, a.reason, a.status,
                          a.requested_at, a.reviewer_name, a.reviewed_at, a.review_note, a.period_year, a.period_month,
                          (COALESCE(e.base_salary,0)+COALESCE(e.taxable_allowances,0)+COALESCE(e.exempt_allowances,0))::text AS monthly_pay
                   FROM salary_advances a
                   LEFT JOIN employees e ON e.id = a.employee_id
                   WHERE a.status = 'PENDING' ORDER BY a.requested_at ASC`,
      ),
    );
  }

  async pendingCount(schema: string): Promise<{ count: number }> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM salary_advances WHERE status = 'PENDING'`),
    );
    return { count: rows[0]?.n ?? 0 };
  }

  /** O gestor/gerente aprova ou rejeita um pedido PENDENTE. */
  async review(schema: string, id: string, decision: 'APPROVED' | 'REJECTED', reviewerId?: string, reviewerName?: string, note?: string): Promise<AdvanceRow> {
    if (decision !== 'APPROVED' && decision !== 'REJECTED') throw new BadRequestException('Decisão inválida.');
    return this.prisma.runInTenant(schema, async (tx) => {
      const existing = await tx.$queryRaw<{ status: string }[]>(
        Prisma.sql`SELECT status FROM salary_advances WHERE id = ${id}::uuid FOR UPDATE`,
      );
      if (existing.length === 0) throw new NotFoundException('Pedido não encontrado.');
      if (existing[0].status !== 'PENDING') throw new BadRequestException(`Este pedido já foi ${existing[0].status === 'APPROVED' ? 'aprovado' : existing[0].status === 'REJECTED' ? 'rejeitado' : 'processado'}.`);
      const rows = await tx.$queryRaw<AdvanceRow[]>(
        Prisma.sql`UPDATE salary_advances
            SET status = ${decision}, reviewed_by = ${reviewerId ?? null}::uuid, reviewer_name = ${reviewerName ?? null},
                reviewed_at = now(), review_note = ${note?.trim() || null}
            WHERE id = ${id}::uuid
            RETURNING id, user_id, employee_id, staff_name, amount, reason, status, requested_at, reviewer_name, reviewed_at, review_note, period_year, period_month`,
      );
      return rows[0];
    });
  }
}
