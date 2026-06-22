import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CustomerMsgRow {
  id: string;
  customer_id: string;
  sender_type: 'CUSTOMER' | 'STAFF';
  sender_id: string | null;
  sender_name: string;
  body: string;
  created_at: Date;
}
export interface CustomerContactRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  online: boolean;
  last_seen_at: Date | null;
  unread: number;
  last_at: Date | null;
}

const ONLINE_C = Prisma.sql`(c.last_seen_at IS NOT NULL AND c.last_seen_at > now() - interval '45 seconds')`;

/**
 * Chat LIVRE entre a equipa (gestor/caixa) e os clientes registados da loja
 * online — sem precisar de encomenda. Presença (online/offline) dos dois lados,
 * não-lidas por cliente, e apagar mensagens (estilo rede social).
 */
@Injectable()
export class CustomerChatService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Lado da EQUIPA (staff autenticado) ─────────────────────
  /** Clientes para conversar (com online + não-lidas). Os 100 mais relevantes. */
  contacts(schema: string): Promise<CustomerContactRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<CustomerContactRow[]>(
        Prisma.sql`
          SELECT c.id, c.name, c.email, c.phone, ${ONLINE_C} AS online, c.last_seen_at,
            (SELECT COUNT(*)::int FROM customer_messages m
               WHERE m.customer_id = c.id AND m.sender_type = 'CUSTOMER' AND m.deleted_at IS NULL
                 AND m.created_at > COALESCE(c.staff_read_at, to_timestamp(0))) AS unread,
            (SELECT MAX(m2.created_at) FROM customer_messages m2 WHERE m2.customer_id = c.id AND m2.deleted_at IS NULL) AS last_at
          FROM customers c
          ORDER BY unread DESC, online DESC, last_at DESC NULLS LAST, c.last_seen_at DESC NULLS LAST, c.name
          LIMIT 100`,
      ),
    );
  }

  staffMessages(schema: string, customerId: string): Promise<CustomerMsgRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<CustomerMsgRow[]>(
        Prisma.sql`SELECT id, customer_id, sender_type, sender_id, sender_name, body, created_at
                   FROM customer_messages WHERE customer_id = ${customerId}::uuid AND deleted_at IS NULL
                   ORDER BY created_at ASC LIMIT 300`,
      ),
    );
  }

  async staffSend(schema: string, customerId: string, sender: { id: string; name: string }, body: string): Promise<CustomerMsgRow> {
    const text = body.trim().slice(0, 2000);
    if (!text) throw new BadRequestException('Mensagem vazia.');
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<CustomerMsgRow[]>(
        Prisma.sql`INSERT INTO customer_messages (customer_id, sender_type, sender_id, sender_name, body)
                   VALUES (${customerId}::uuid, 'STAFF', ${sender.id}::uuid, ${sender.name}, ${text})
                   RETURNING id, customer_id, sender_type, sender_id, sender_name, body, created_at`,
      ),
    );
    return rows[0];
  }

  async staffRead(schema: string, customerId: string): Promise<{ ok: true }> {
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE customers SET staff_read_at = now() WHERE id = ${customerId}::uuid`),
    );
    return { ok: true };
  }

  async remove(schema: string, ids: string[]): Promise<{ deleted: number }> {
    if (!ids.length) return { deleted: 0 };
    return this.prisma.runInTenant(schema, async (tx) => {
      const idList = Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`));
      const n = await tx.$executeRaw(
        Prisma.sql`UPDATE customer_messages SET deleted_at = now() WHERE id IN (${idList}) AND deleted_at IS NULL`,
      );
      return { deleted: Number(n) };
    });
  }

  async staffUnread(schema: string): Promise<{ count: number }> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ n: number }[]>(
        Prisma.sql`SELECT COUNT(*)::int AS n FROM customer_messages m
                   JOIN customers c ON c.id = m.customer_id
                   WHERE m.sender_type = 'CUSTOMER' AND m.deleted_at IS NULL
                     AND m.created_at > COALESCE(c.staff_read_at, to_timestamp(0))`,
      ),
    );
    return { count: rows[0]?.n ?? 0 };
  }

  // ── Lado do CLIENTE (token de cliente → email) ─────────────
  private async resolveCustomer(tx: Prisma.TransactionClient, email: string): Promise<{ id: string; name: string } | null> {
    const r = await tx.$queryRaw<{ id: string; name: string }[]>(
      Prisma.sql`SELECT id, name FROM customers WHERE lower(email) = ${email.toLowerCase()} LIMIT 1`,
    );
    return r[0] ?? null;
  }

  /** Conversa do cliente com a loja + se há equipa online. Marca presença e lido. */
  async customerThread(schema: string, email: string): Promise<{ messages: CustomerMsgRow[]; staffOnline: boolean }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const c = await this.resolveCustomer(tx, email);
      if (!c) return { messages: [], staffOnline: false };
      await tx.$executeRaw(Prisma.sql`UPDATE customers SET last_seen_at = now(), customer_read_at = now() WHERE id = ${c.id}::uuid`);
      const messages = await tx.$queryRaw<CustomerMsgRow[]>(
        Prisma.sql`SELECT id, customer_id, sender_type, sender_id, sender_name, body, created_at
                   FROM customer_messages WHERE customer_id = ${c.id}::uuid AND deleted_at IS NULL
                   ORDER BY created_at ASC LIMIT 300`,
      );
      const on = await tx.$queryRaw<{ online: boolean }[]>(
        Prisma.sql`SELECT EXISTS (SELECT 1 FROM users WHERE is_active = TRUE AND last_seen_at > now() - interval '45 seconds') AS online`,
      );
      return { messages, staffOnline: !!on[0]?.online };
    });
  }

  async customerSend(schema: string, email: string, name: string | undefined, body: string): Promise<CustomerMsgRow> {
    const text = body.trim().slice(0, 2000);
    if (!text) throw new BadRequestException('Mensagem vazia.');
    return this.prisma.runInTenant(schema, async (tx) => {
      const c = await this.resolveCustomer(tx, email);
      if (!c) throw new BadRequestException('Cliente não encontrado.');
      await tx.$executeRaw(Prisma.sql`UPDATE customers SET last_seen_at = now() WHERE id = ${c.id}::uuid`);
      const rows = await tx.$queryRaw<CustomerMsgRow[]>(
        Prisma.sql`INSERT INTO customer_messages (customer_id, sender_type, sender_name, body)
                   VALUES (${c.id}::uuid, 'CUSTOMER', ${name?.trim() || c.name}, ${text})
                   RETURNING id, customer_id, sender_type, sender_id, sender_name, body, created_at`,
      );
      return rows[0];
    });
  }
}
