import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { round2 } from '@nexus/agt-xml';
import { PrismaService } from '../prisma/prisma.service';
import { allocateDocumentNumber, formatCounterNumber } from '../common/document-counter';
import { TenantAuditService } from '../cashbox/tenant-audit.service';
import { CreatePayableDto, RecordPayablePaymentDto } from './dto/payable.dto';

export interface PayableRow {
  id: string;
  supplier_name: string | null;
  reference: string | null;
  original_amount: string;
  paid_amount: string;
  outstanding: string;
  due_date: string | null;
  status: string;
  days_overdue: number;
  created_at: Date;
}

export interface PayableSummary {
  outstanding: number;
  overdue: number;
  openCount: number;
  overdueCount: number;
}

type Actor = { id: string | null; name: string | null };

/**
 * Contas a pagar (fornecedores). Saldo em dívida, antiguidade e pagamentos
 * parciais que geram comprovativos (PG). Tudo auditado na cadeia do tenant.
 */
@Injectable()
export class PayablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: TenantAuditService,
  ) {}

  list(schema: string, filter?: string): Promise<PayableRow[]> {
    const where =
      filter === 'paid' ? Prisma.sql`WHERE p.status = 'PAID'`
      : filter === 'overdue' ? Prisma.sql`WHERE p.status NOT IN ('PAID','CANCELLED') AND p.due_date IS NOT NULL AND p.due_date < CURRENT_DATE`
      : filter === 'open' ? Prisma.sql`WHERE p.status NOT IN ('PAID','CANCELLED')`
      : Prisma.sql``;
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<PayableRow[]>(Prisma.sql`
        SELECT p.id, p.supplier_name, p.reference, p.original_amount, p.paid_amount,
               (p.original_amount - p.paid_amount) AS outstanding,
               to_char(p.due_date,'YYYY-MM-DD') AS due_date, p.status,
               CASE WHEN p.status NOT IN ('PAID','CANCELLED') AND p.due_date IS NOT NULL AND p.due_date < CURRENT_DATE
                    THEN (CURRENT_DATE - p.due_date) ELSE 0 END AS days_overdue,
               p.created_at
        FROM payables p
        ${where}
        ORDER BY (p.status IN ('PAID','CANCELLED')), p.due_date NULLS LAST, p.created_at DESC
        LIMIT 1000`),
    );
  }

  async summary(schema: string): Promise<PayableSummary> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ outstanding: string; overdue: string; open_count: number; overdue_count: number }[]>(Prisma.sql`
        SELECT
          COALESCE(SUM(original_amount - paid_amount) FILTER (WHERE status NOT IN ('PAID','CANCELLED')), 0) AS outstanding,
          COALESCE(SUM(original_amount - paid_amount) FILTER (WHERE status NOT IN ('PAID','CANCELLED') AND due_date IS NOT NULL AND due_date < CURRENT_DATE), 0) AS overdue,
          COUNT(*) FILTER (WHERE status NOT IN ('PAID','CANCELLED'))::int AS open_count,
          COUNT(*) FILTER (WHERE status NOT IN ('PAID','CANCELLED') AND due_date IS NOT NULL AND due_date < CURRENT_DATE)::int AS overdue_count
        FROM payables`);
      const r = rows[0];
      return {
        outstanding: round2(Number(r.outstanding)), overdue: round2(Number(r.overdue)),
        openCount: Number(r.open_count), overdueCount: Number(r.overdue_count),
      };
    });
  }

  async get(schema: string, id: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<PayableRow[]>(Prisma.sql`
        SELECT p.id, p.supplier_name, p.reference, p.original_amount, p.paid_amount,
               (p.original_amount - p.paid_amount) AS outstanding,
               to_char(p.due_date,'YYYY-MM-DD') AS due_date, p.status,
               CASE WHEN p.status NOT IN ('PAID','CANCELLED') AND p.due_date IS NOT NULL AND p.due_date < CURRENT_DATE
                    THEN (CURRENT_DATE - p.due_date) ELSE 0 END AS days_overdue,
               p.created_at
        FROM payables p WHERE p.id = ${id}::uuid LIMIT 1`);
      if (!rows[0]) throw new NotFoundException('Conta a pagar não encontrada.');
      const payments = await tx.$queryRaw(Prisma.sql`
        SELECT id, amount, method, reference_number, notes, paid_at, created_by_name
        FROM payable_payments WHERE payable_id = ${id}::uuid ORDER BY paid_at DESC`);
      return { ...rows[0], payments };
    });
  }

  async create(schema: string, dto: CreatePayableDto, actor: Actor): Promise<{ id: string }> {
    const due = (dto.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dto.dueDate))
      ? dto.dueDate
      : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO payables
          (supplier_id, supplier_name, reference, original_amount, paid_amount, due_date, status, notes, created_by, created_by_name)
        VALUES (${dto.supplierId ?? null}::uuid, ${dto.supplierName}, ${dto.reference ?? null}, ${round2(dto.amount)}, 0,
                ${due}::date, 'OPEN', ${dto.notes ?? null}, ${actor.id}::uuid, ${actor.name})
        RETURNING id`);
      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name,
        action: 'PAYABLE_CREATED', entity: 'payable', entityId: rows[0].id,
        details: { supplier: dto.supplierName, amount: round2(dto.amount), dueDate: due, reference: dto.reference ?? null },
      });
      return { id: rows[0].id };
    });
  }

  async recordPayment(schema: string, id: string, dto: RecordPayablePaymentDto, actor: Actor) {
    const amount = round2(dto.amount);
    if (amount <= 0) throw new BadRequestException('Valor inválido.');
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ original_amount: string; paid_amount: string; status: string; supplier_name: string | null }[]>(
        Prisma.sql`SELECT original_amount, paid_amount, status, supplier_name FROM payables WHERE id = ${id}::uuid FOR UPDATE`,
      );
      if (!rows[0]) throw new NotFoundException('Conta a pagar não encontrada.');
      if (rows[0].status === 'CANCELLED') throw new BadRequestException('Esta conta está cancelada.');
      const original = Number(rows[0].original_amount);
      const paid = Number(rows[0].paid_amount);
      const outstanding = round2(original - paid);
      if (rows[0].status === 'PAID' || outstanding <= 0) throw new BadRequestException('Esta conta já está liquidada.');
      if (amount > outstanding + 0.001) throw new BadRequestException(`Valor superior ao saldo em dívida (${outstanding}).`);

      const year = new Date().getFullYear();
      const seq = await allocateDocumentNumber(tx, 'PG', year);
      const referenceNumber = formatCounterNumber('PG', year, seq);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO payable_payments (payable_id, amount, method, reference_number, notes, created_by, created_by_name)
        VALUES (${id}::uuid, ${amount}, ${dto.method ?? 'CASH'}, ${referenceNumber}, ${dto.notes ?? null}, ${actor.id}::uuid, ${actor.name})`);

      const newPaid = round2(paid + amount);
      const status = newPaid >= original - 0.001 ? 'PAID' : 'PARTIAL';
      await tx.$executeRaw(Prisma.sql`UPDATE payables SET paid_amount = ${newPaid}, status = ${status} WHERE id = ${id}::uuid`);

      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name,
        action: 'PAYABLE_PAID', entity: 'payable', entityId: id,
        details: { referenceNumber, amount, method: dto.method ?? 'CASH', newStatus: status, supplier: rows[0].supplier_name },
      });

      return { referenceNumber, amount, paidAmount: newPaid, outstanding: round2(original - newPaid), status };
    });
  }
}
