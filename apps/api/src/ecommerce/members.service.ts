import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type MemberStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: MemberStatus;
  note: string | null;
  requestedAt: string | null;
  decidedAt: string | null;
}

/**
 * Loja de associados: só clientes aprovados pela empresa veem a segunda loja.
 * Estados: NONE (nunca pediu) → PENDING (pediu adesão) → APPROVED | REJECTED.
 */
@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  async statusOf(schema: string, email: string): Promise<{ status: MemberStatus }> {
    const e = email.toLowerCase();
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ s: string }[]>(Prisma.sql`SELECT member_status AS s FROM customers WHERE lower(email) = ${e} LIMIT 1`),
    );
    return { status: (rows[0]?.s as MemberStatus) ?? 'NONE' };
  }

  /** Falha (403 lógico) se o cliente não é associado aprovado. */
  async assertApproved(schema: string, email: string): Promise<void> {
    const { status } = await this.statusOf(schema, email);
    if (status !== 'APPROVED') throw new BadRequestException('Acesso reservado a associados aprovados.');
  }

  async request(schema: string, email: string, note?: string): Promise<{ status: MemberStatus }> {
    const e = email.toLowerCase();
    const n = (note ?? '').trim().slice(0, 300) || null;
    const updated = await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`
        UPDATE customers SET member_status = 'PENDING', member_note = ${n}, member_requested_at = now(), member_decided_at = NULL
        WHERE lower(email) = ${e} AND member_status IN ('NONE', 'REJECTED')`),
    );
    const cur = await this.statusOf(schema, e);
    if (!updated && cur.status === 'NONE') throw new NotFoundException('Cliente não encontrado.');
    return cur;
  }

  async list(schema: string, status?: string): Promise<MemberRow[]> {
    const filter = ['PENDING', 'APPROVED', 'REJECTED'].includes(status ?? '') ? status! : null;
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ id: string; name: string; email: string; phone: string | null; s: string; note: string | null; rq: Date | null; dc: Date | null }[]>(Prisma.sql`
        SELECT id, name, email, phone, member_status AS s, member_note AS note, member_requested_at AS rq, member_decided_at AS dc
        FROM customers
        WHERE member_status <> 'NONE' AND (${filter}::text IS NULL OR member_status = ${filter})
        ORDER BY (member_status = 'PENDING') DESC, COALESCE(member_requested_at, member_decided_at) DESC
        LIMIT 500`),
    );
    return rows.map((r) => ({
      id: r.id, name: r.name, email: r.email, phone: r.phone, status: r.s as MemberStatus, note: r.note,
      requestedAt: r.rq ? r.rq.toISOString() : null, decidedAt: r.dc ? r.dc.toISOString() : null,
    }));
  }

  async decide(schema: string, id: string, approve: boolean): Promise<{ ok: true }> {
    const status = approve ? 'APPROVED' : 'REJECTED';
    const n = await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE customers SET member_status = ${status}, member_decided_at = now() WHERE id = ${id}::uuid AND member_status <> 'NONE'`),
    );
    if (!n) throw new NotFoundException('Pedido de adesão não encontrado.');
    return { ok: true };
  }

  /** Remove o acesso (volta a NONE) — o cliente pode pedir de novo. */
  async revoke(schema: string, id: string): Promise<{ ok: true }> {
    const n = await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE customers SET member_status = 'NONE', member_note = NULL, member_decided_at = now() WHERE id = ${id}::uuid`),
    );
    if (!n) throw new NotFoundException('Associado não encontrado.');
    return { ok: true };
  }
}
