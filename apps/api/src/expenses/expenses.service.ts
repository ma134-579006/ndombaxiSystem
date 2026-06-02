import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAuditService } from '../cashbox/tenant-audit.service';
import { CreateExpenseDto } from './dto/expense.dto';

export interface ExpenseRow {
  id: string;
  category: string;
  description: string | null;
  amount: string;
  supplier: string | null;
  payment_method: string | null;
  document_ref: string | null;
  expense_date: string;
  created_by_name: string | null;
  created_at: Date;
}

export interface ExpenseCategoryTotal {
  category: string;
  total: number;
  count: number;
}

type Actor = { id: string | null; name: string | null };

/**
 * Despesas operacionais da empresa (gestor). É a base do LUCRO LÍQUIDO real:
 * lucro bruto − despesas do período. Todas as operações ficam na auditoria
 * do tenant (criação e eliminação), com data/hora e funcionário.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: TenantAuditService,
  ) {}

  private range(from?: string, to?: string): { from: string; to: string } {
    const toD = to ? new Date(to) : new Date();
    const fromD = from ? new Date(from) : new Date(toD.getTime() - 29 * 86400000);
    return { from: fromD.toISOString().slice(0, 10), to: toD.toISOString().slice(0, 10) };
  }

  /** Lista despesas do período, opcionalmente filtradas por categoria. */
  list(schema: string, from?: string, to?: string, category?: string): Promise<ExpenseRow[]> {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, (tx) =>
      category
        ? tx.$queryRaw<ExpenseRow[]>(Prisma.sql`
            SELECT id, category, description, amount, supplier, payment_method,
                   document_ref, to_char(expense_date,'YYYY-MM-DD') AS expense_date,
                   created_by_name, created_at
            FROM expenses
            WHERE expense_date BETWEEN ${f}::date AND ${t}::date AND category = ${category}
            ORDER BY expense_date DESC, created_at DESC LIMIT 1000`)
        : tx.$queryRaw<ExpenseRow[]>(Prisma.sql`
            SELECT id, category, description, amount, supplier, payment_method,
                   document_ref, to_char(expense_date,'YYYY-MM-DD') AS expense_date,
                   created_by_name, created_at
            FROM expenses
            WHERE expense_date BETWEEN ${f}::date AND ${t}::date
            ORDER BY expense_date DESC, created_at DESC LIMIT 1000`),
    );
  }

  /** Total por categoria no período (para o gráfico de repartição). */
  async summary(schema: string, from?: string, to?: string): Promise<{ from: string; to: string; total: number; byCategory: ExpenseCategoryTotal[] }> {
    const { from: f, to: t } = this.range(from, to);
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ category: string; total: number; count: number }[]>(Prisma.sql`
        SELECT category, ROUND(SUM(amount),2)::float AS total, COUNT(*)::int AS count
        FROM expenses
        WHERE expense_date BETWEEN ${f}::date AND ${t}::date
        GROUP BY category ORDER BY total DESC`);
      const total = rows.reduce((s, r) => s + Number(r.total), 0);
      return { from: f, to: t, total: Math.round(total * 100) / 100, byCategory: rows };
    });
  }

  /** Regista uma despesa (auditada). */
  async create(schema: string, dto: CreateExpenseDto, actor: Actor): Promise<ExpenseRow> {
    const date = (dto.expenseDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<ExpenseRow[]>(Prisma.sql`
        INSERT INTO expenses
          (category, description, amount, supplier, payment_method, document_ref,
           expense_date, created_by, created_by_name)
        VALUES (${dto.category}, ${dto.description ?? null}, ${dto.amount},
                ${dto.supplier ?? null}, ${dto.paymentMethod ?? null}, ${dto.documentRef ?? null},
                ${date}::date, ${actor.id}::uuid, ${actor.name})
        RETURNING id, category, description, amount, supplier, payment_method,
                  document_ref, to_char(expense_date,'YYYY-MM-DD') AS expense_date,
                  created_by_name, created_at`);
      const row = rows[0];
      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name,
        action: 'EXPENSE_ADDED', entity: 'expense', entityId: row.id,
        details: { category: dto.category, amount: dto.amount, supplier: dto.supplier ?? null, date },
      });
      return row;
    });
  }

  /** Elimina uma despesa (auditada). */
  async remove(schema: string, id: string, actor: Actor): Promise<{ id: string }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ category: string; amount: string }[]>(
        Prisma.sql`DELETE FROM expenses WHERE id = ${id}::uuid RETURNING category, amount`,
      );
      if (rows.length === 0) throw new NotFoundException('Despesa não encontrada.');
      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name,
        action: 'EXPENSE_DELETED', entity: 'expense', entityId: id,
        details: { category: rows[0].category, amount: Number(rows[0].amount) },
      });
      return { id };
    });
  }
}
