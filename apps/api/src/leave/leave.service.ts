import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAuditService } from '../cashbox/tenant-audit.service';

export interface LeaveRow {
  id: string;
  employee_name: string | null;
  type: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: string;
  reviewed_by_name: string | null;
  created_at: Date;
}

type Actor = { id: string | null; name: string | null };
type CreateLeave = { employeeId: string; type: string; startDate: string; endDate: string; reason?: string };

const LEAVE_TYPES = ['FERIAS', 'FALTA', 'LICENCA', 'OUTRO'];

/**
 * Férias / ausências (RH): o gestor regista pedidos por funcionário, aprova ou
 * rejeita; conta os dias e o saldo de férias gozadas no ano. Tudo auditado.
 */
@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: TenantAuditService,
  ) {}

  /** Funcionários activos (para o seletor do pedido). */
  employees(schema: string): Promise<{ id: string; full_name: string }[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ id: string; full_name: string }[]>(
        Prisma.sql`SELECT id, full_name FROM employees WHERE status = 'ACTIVE' ORDER BY full_name`,
      ),
    );
  }

  list(schema: string, status?: string): Promise<LeaveRow[]> {
    const where = status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status)
      ? Prisma.sql`WHERE status = ${status}` : Prisma.sql``;
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<LeaveRow[]>(Prisma.sql`
        SELECT id, employee_name, type, to_char(start_date,'YYYY-MM-DD') AS start_date,
               to_char(end_date,'YYYY-MM-DD') AS end_date, days, reason, status,
               reviewed_by_name, created_at
        FROM leave_requests ${where}
        ORDER BY (status = 'PENDING') DESC, created_at DESC LIMIT 1000`),
    );
  }

  async summary(schema: string): Promise<{ pending: number; ferasDaysYear: number }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const r = await tx.$queryRaw<{ pending: number; ferias: number }[]>(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
               COALESCE(SUM(days) FILTER (WHERE status = 'APPROVED' AND type = 'FERIAS'
                         AND date_part('year', start_date) = date_part('year', CURRENT_DATE)), 0)::int AS ferias
        FROM leave_requests`);
      return { pending: Number(r[0].pending), ferasDaysYear: Number(r[0].ferias) };
    });
  }

  async create(schema: string, dto: CreateLeave, actor: Actor): Promise<{ id: string }> {
    if (!LEAVE_TYPES.includes(dto.type)) throw new BadRequestException('Tipo inválido.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(dto.endDate)) {
      throw new BadRequestException('Datas inválidas.');
    }
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end < start) throw new BadRequestException('A data final é anterior à inicial.');
    const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;

    return this.prisma.runInTenant(schema, async (tx) => {
      const emp = await tx.$queryRaw<{ full_name: string }[]>(
        Prisma.sql`SELECT full_name FROM employees WHERE id = ${dto.employeeId}::uuid LIMIT 1`,
      );
      if (!emp[0]) throw new BadRequestException('Funcionário não encontrado.');
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO leave_requests
          (employee_id, employee_name, type, start_date, end_date, days, reason, status, created_by, created_by_name)
        VALUES (${dto.employeeId}::uuid, ${emp[0].full_name}, ${dto.type}, ${dto.startDate}::date,
                ${dto.endDate}::date, ${days}, ${dto.reason ?? null}, 'PENDING', ${actor.id}::uuid, ${actor.name})
        RETURNING id`);
      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name,
        action: 'LEAVE_REQUESTED', entity: 'leave_request', entityId: rows[0].id,
        details: { employee: emp[0].full_name, type: dto.type, days, from: dto.startDate, to: dto.endDate },
      });
      return { id: rows[0].id };
    });
  }

  async review(schema: string, id: string, decision: 'APPROVED' | 'REJECTED', actor: Actor): Promise<{ id: string; status: string }> {
    if (decision !== 'APPROVED' && decision !== 'REJECTED') throw new BadRequestException('Decisão inválida.');
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; employee_name: string | null }[]>(Prisma.sql`
        UPDATE leave_requests
        SET status = ${decision}, reviewed_by = ${actor.id}::uuid, reviewed_by_name = ${actor.name}, reviewed_at = now()
        WHERE id = ${id}::uuid AND status = 'PENDING'
        RETURNING id, employee_name`);
      if (rows.length === 0) throw new NotFoundException('Pedido não encontrado ou já decidido.');
      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name,
        action: 'LEAVE_REVIEWED', entity: 'leave_request', entityId: id,
        details: { decision, employee: rows[0].employee_name },
      });
      return { id, status: decision };
    });
  }

  /** Funcionário ligado ao login (por user_id; ou por nome único, ligando-o). */
  private async employeeOf(tx: Prisma.TransactionClient, userId: string, name?: string | null): Promise<{ id: string } | null> {
    const byUser = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM employees WHERE user_id = ${userId}::uuid AND status = 'ACTIVE' LIMIT 1`,
    );
    if (byUser[0]) return byUser[0];
    if (name && name.trim()) {
      const byName = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM employees WHERE status = 'ACTIVE' AND user_id IS NULL AND lower(full_name) = lower(${name.trim()}) LIMIT 2`,
      );
      if (byName.length === 1) {
        await tx.$executeRaw(Prisma.sql`UPDATE employees SET user_id = ${userId}::uuid, updated_at = now() WHERE id = ${byName[0].id}::uuid`);
        return byName[0];
      }
    }
    return null;
  }

  /** Os meus pedidos (operador da caixa). */
  async mine(schema: string, userId: string, name?: string | null): Promise<{ linked: boolean; rows: unknown[] }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const emp = await this.employeeOf(tx, userId, name);
      if (!emp) return { linked: false, rows: [] };
      const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`
        SELECT id, type, start_date::text AS start_date, end_date::text AS end_date, days, reason, status, reviewed_by_name, created_at
        FROM leave_requests WHERE employee_id = ${emp.id}::uuid ORDER BY created_at DESC LIMIT 40`);
      return { linked: true, rows };
    });
  }

  /** O operador pede férias/ausência para SI; fica PENDENTE e o gestor é notificado (sino + RH). */
  async requestMine(schema: string, dto: Omit<CreateLeave, 'employeeId'>, actor: Actor & { id: string }): Promise<{ id: string }> {
    const emp = await this.prisma.runInTenant(schema, (tx) => this.employeeOf(tx, actor.id, actor.name));
    if (!emp) throw new BadRequestException('Sem ficha de funcionário associada. Fala com o gestor para te registar em RH.');
    return this.create(schema, { ...dto, employeeId: emp.id } as CreateLeave, actor);
  }
}
