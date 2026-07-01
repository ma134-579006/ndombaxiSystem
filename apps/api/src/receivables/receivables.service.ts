import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { round2 } from '@nexus/agt-xml';
import { PrismaService } from '../prisma/prisma.service';
import { allocateDocumentNumber, formatCounterNumber } from '../common/document-counter';
import { TenantAuditService } from '../cashbox/tenant-audit.service';
import { CreateReceivableDto, RecordPaymentDto } from './dto/receivable.dto';

export interface ReceivableRow {
  id: string;
  customer_name: string | null;
  invoice_number: string | null;
  original_amount: string;
  paid_amount: string;
  outstanding: string;
  due_date: string | null;
  status: string;
  days_overdue: number;
  created_at: Date;
}

export interface ReceivableSummary {
  outstanding: number;
  overdue: number;
  openCount: number;
  overdueCount: number;
}

type Actor = { id: string | null; name: string | null };

/**
 * Contas a receber (venda a crédito / fiado). Saldo em dívida, antiguidade
 * (dias em atraso) e recebimentos parciais que geram recibos (RC). Tudo
 * auditado na cadeia de hash do tenant.
 */
@Injectable()
export class ReceivablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: TenantAuditService,
  ) {}

  /** Lista contas a receber (filtro opcional: open | overdue | paid). */
  list(schema: string, filter?: string): Promise<ReceivableRow[]> {
    const where =
      filter === 'paid' ? Prisma.sql`WHERE r.status = 'PAID'`
      : filter === 'overdue' ? Prisma.sql`WHERE r.status <> 'PAID' AND r.due_date IS NOT NULL AND r.due_date < CURRENT_DATE`
      : filter === 'open' ? Prisma.sql`WHERE r.status <> 'PAID'`
      : Prisma.sql``;
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<ReceivableRow[]>(Prisma.sql`
        SELECT r.id, r.customer_name, r.invoice_number,
               r.original_amount, r.paid_amount,
               (r.original_amount - r.paid_amount) AS outstanding,
               to_char(r.due_date,'YYYY-MM-DD') AS due_date, r.status,
               CASE WHEN r.status <> 'PAID' AND r.due_date IS NOT NULL AND r.due_date < CURRENT_DATE
                    THEN (CURRENT_DATE - r.due_date) ELSE 0 END AS days_overdue,
               r.created_at
        FROM receivables r
        ${where}
        ORDER BY (r.status = 'PAID'), r.due_date NULLS LAST, r.created_at DESC
        LIMIT 1000`),
    );
  }

  /** KPIs: total em dívida, total vencido e contagens. */
  async summary(schema: string): Promise<ReceivableSummary> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ outstanding: string; overdue: string; open_count: number; overdue_count: number }[]>(Prisma.sql`
        SELECT
          COALESCE(SUM(original_amount - paid_amount) FILTER (WHERE status <> 'PAID'), 0) AS outstanding,
          COALESCE(SUM(original_amount - paid_amount) FILTER (WHERE status <> 'PAID' AND due_date IS NOT NULL AND due_date < CURRENT_DATE), 0) AS overdue,
          COUNT(*) FILTER (WHERE status <> 'PAID')::int AS open_count,
          COUNT(*) FILTER (WHERE status <> 'PAID' AND due_date IS NOT NULL AND due_date < CURRENT_DATE)::int AS overdue_count
        FROM receivables`);
      const r = rows[0];
      return {
        outstanding: round2(Number(r.outstanding)),
        overdue: round2(Number(r.overdue)),
        openCount: Number(r.open_count),
        overdueCount: Number(r.overdue_count),
      };
    });
  }

  /** Detalhe de uma conta + histórico de recibos. */
  async get(schema: string, id: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<ReceivableRow[]>(Prisma.sql`
        SELECT r.id, r.customer_name, r.invoice_number, r.original_amount, r.paid_amount,
               (r.original_amount - r.paid_amount) AS outstanding,
               to_char(r.due_date,'YYYY-MM-DD') AS due_date, r.status,
               CASE WHEN r.status <> 'PAID' AND r.due_date IS NOT NULL AND r.due_date < CURRENT_DATE
                    THEN (CURRENT_DATE - r.due_date) ELSE 0 END AS days_overdue,
               r.created_at
        FROM receivables r WHERE r.id = ${id}::uuid LIMIT 1`);
      if (!rows[0]) throw new NotFoundException('Conta a receber não encontrada.');
      const payments = await tx.$queryRaw(Prisma.sql`
        SELECT id, amount, method, receipt_number, notes, paid_at, created_by_name
        FROM receivable_payments WHERE receivable_id = ${id}::uuid ORDER BY paid_at DESC`);
      return { ...rows[0], payments };
    });
  }

  /** Criação manual de uma conta a receber. */
  async create(schema: string, dto: CreateReceivableDto, actor: Actor): Promise<{ id: string }> {
    const due = (dto.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dto.dueDate))
      ? dto.dueDate
      : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO receivables
          (customer_id, customer_name, original_amount, paid_amount, due_date, status, notes, created_by, created_by_name)
        VALUES (${dto.customerId ?? null}::uuid, ${dto.customerName}, ${round2(dto.amount)}, 0,
                ${due}::date, 'OPEN', ${dto.notes ?? null}, ${actor.id}::uuid, ${actor.name})
        RETURNING id`);
      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name,
        action: 'RECEIVABLE_CREATED', entity: 'receivable', entityId: rows[0].id,
        details: { customer: dto.customerName, amount: round2(dto.amount), dueDate: due, manual: true },
      });
      return { id: rows[0].id };
    });
  }

  /** Regista um recebimento e gera o recibo (RC). */
  async recordPayment(schema: string, id: string, dto: RecordPaymentDto, actor: Actor) {
    const amount = round2(dto.amount);
    if (amount <= 0) throw new BadRequestException('Valor inválido.');
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ original_amount: string; paid_amount: string; status: string; customer_name: string | null; invoice_id: string | null }[]>(
        Prisma.sql`SELECT original_amount, paid_amount, status, customer_name, invoice_id
                   FROM receivables WHERE id = ${id}::uuid FOR UPDATE`,
      );
      if (!rows[0]) throw new NotFoundException('Conta a receber não encontrada.');
      const original = Number(rows[0].original_amount);
      const paid = Number(rows[0].paid_amount);
      const outstanding = round2(original - paid);
      if (rows[0].status === 'PAID' || outstanding <= 0) {
        throw new BadRequestException('Esta conta já está liquidada.');
      }
      if (amount > outstanding + 0.001) {
        throw new BadRequestException(`Valor superior ao saldo em dívida (${outstanding}).`);
      }

      const year = new Date().getFullYear();
      const seq = await allocateDocumentNumber(tx, 'RC', year);
      const receiptNumber = formatCounterNumber('RC', year, seq);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO receivable_payments
          (receivable_id, amount, method, receipt_number, notes, created_by, created_by_name)
        VALUES (${id}::uuid, ${amount}, ${dto.method ?? 'CASH'}, ${receiptNumber},
                ${dto.notes ?? null}, ${actor.id}::uuid, ${actor.name})`);

      const newPaid = round2(paid + amount);
      const status = newPaid >= original - 0.001 ? 'PAID' : 'PARTIAL';
      await tx.$executeRaw(Prisma.sql`
        UPDATE receivables SET paid_amount = ${newPaid}, status = ${status} WHERE id = ${id}::uuid`);

      // Estado do documento (DP 71/25): a fatura a crédito passa a PAID quando
      // liquidada, ou PARTIALLY_PAID enquanto há saldo. Nunca toca em anuladas.
      if (rows[0].invoice_id) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE invoices SET doc_state = ${status === 'PAID' ? 'PAID' : 'PARTIALLY_PAID'}
          WHERE id = ${rows[0].invoice_id}::uuid AND doc_state <> 'ANNULLED'`);
      }

      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name,
        action: 'RECEIVABLE_PAID', entity: 'receivable', entityId: id,
        details: { receiptNumber, amount, method: dto.method ?? 'CASH', newStatus: status, customer: rows[0].customer_name },
      });

      return { receiptNumber, amount, paidAmount: newPaid, outstanding: round2(original - newPaid), status };
    });
  }
}
