import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Mensagem do chat de equipa (gerente ↔ caixa). */
export interface ChatMessageRow {
  id: string;
  sender_id: string | null;
  sender_name: string;
  sender_role: string;
  body: string;
  created_at: Date;
}

/**
 * Chat interno da empresa (canal único de equipa): o operador de caixa fala com
 * o gerente/gestor e vice-versa. Mensagens guardadas no schema do tenant; o
 * indicador de não-lidas usa o `chat_read_at` de cada utilizador.
 */
@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  /** Últimas mensagens (ordem cronológica ascendente). */
  list(schema: string, limit = 200): Promise<ChatMessageRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx
        .$queryRaw<ChatMessageRow[]>(
          Prisma.sql`SELECT id, sender_id, sender_name, sender_role, body, created_at
                     FROM staff_messages ORDER BY created_at DESC LIMIT ${limit}`,
        )
        .then((rows) => rows.reverse()),
    );
  }

  /** Envia uma mensagem em nome do utilizador autenticado. */
  async send(
    schema: string,
    sender: { id: string; name: string; role: string },
    body: string,
  ): Promise<ChatMessageRow> {
    const text = body.trim().slice(0, 2000);
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<ChatMessageRow[]>(
        Prisma.sql`INSERT INTO staff_messages (sender_id, sender_name, sender_role, body)
                   VALUES (${sender.id}::uuid, ${sender.name}, ${sender.role}, ${text})
                   RETURNING id, sender_id, sender_name, sender_role, body, created_at`,
      ),
    );
    return rows[0];
  }

  /** Nº de mensagens não-lidas por este utilizador (de outros, após a última leitura). */
  async unread(schema: string, userId: string): Promise<{ count: number }> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ n: number }[]>(
        Prisma.sql`SELECT COUNT(*)::int AS n FROM staff_messages m
                   WHERE (m.sender_id IS NULL OR m.sender_id <> ${userId}::uuid)
                     AND m.created_at > COALESCE(
                       (SELECT chat_read_at FROM users WHERE id = ${userId}::uuid),
                       to_timestamp(0))`,
      ),
    );
    return { count: rows[0]?.n ?? 0 };
  }

  /** Marca tudo como lido para este utilizador (zera o badge). */
  async markRead(schema: string, userId: string): Promise<{ ok: true }> {
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE users SET chat_read_at = now() WHERE id = ${userId}::uuid`),
    );
    return { ok: true };
  }
}
