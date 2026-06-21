import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Mensagem 1:1 do chat de equipa. */
export interface ChatMessageRow {
  id: string;
  sender_id: string | null;
  recipient_id: string | null;
  sender_name: string;
  sender_role: string;
  body: string;
  created_at: Date;
}

/** Contacto (outro membro da equipa) com presença e não-lidas. */
export interface ChatContactRow {
  id: string;
  name: string;
  role: string;
  online: boolean;
  last_seen_at: Date | null;
  unread: number;
  last_at: Date | null;
}

const ONLINE = Prisma.sql`(u.last_seen_at IS NOT NULL AND u.last_seen_at > now() - interval '40 seconds')`;

/**
 * Chat interno da empresa em modo 1:1 (DM): cada um sabe COM QUEM fala. Mostra
 * presença (online/offline), não-lidas por conversa, e permite apagar mensagens.
 */
@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  /** Marca presença do utilizador (heartbeat). */
  private async touch(tx: Prisma.TransactionClient, meId: string): Promise<void> {
    await tx.$executeRaw(Prisma.sql`UPDATE users SET last_seen_at = now() WHERE id = ${meId}::uuid`);
  }

  /** Lista os contactos (restante equipa) com online + não-lidas. Atualiza presença. */
  contacts(schema: string, meId: string): Promise<ChatContactRow[]> {
    return this.prisma.runInTenant(schema, async (tx) => {
      await this.touch(tx, meId);
      return tx.$queryRaw<ChatContactRow[]>(
        Prisma.sql`
          SELECT u.id, u.name, u.role, ${ONLINE} AS online, u.last_seen_at,
            (SELECT COUNT(*)::int FROM staff_messages m
               WHERE m.sender_id = u.id AND m.recipient_id = ${meId}::uuid AND m.deleted_at IS NULL
                 AND m.created_at > COALESCE((SELECT read_at FROM staff_chat_reads r WHERE r.user_id = ${meId}::uuid AND r.peer_id = u.id), to_timestamp(0))
            ) AS unread,
            (SELECT MAX(m2.created_at) FROM staff_messages m2
               WHERE m2.deleted_at IS NULL
                 AND ((m2.sender_id = u.id AND m2.recipient_id = ${meId}::uuid)
                   OR (m2.sender_id = ${meId}::uuid AND m2.recipient_id = u.id))
            ) AS last_at
          FROM users u
          WHERE u.id <> ${meId}::uuid AND u.is_active = TRUE
          ORDER BY online DESC, last_at DESC NULLS LAST, u.name`,
      );
    });
  }

  /** Mensagens da conversa entre mim e o par (ascendente). */
  messages(schema: string, meId: string, peerId: string): Promise<ChatMessageRow[]> {
    return this.prisma.runInTenant(schema, async (tx) => {
      await this.touch(tx, meId);
      return tx.$queryRaw<ChatMessageRow[]>(
        Prisma.sql`SELECT id, sender_id, recipient_id, sender_name, sender_role, body, created_at
                   FROM staff_messages
                   WHERE deleted_at IS NULL
                     AND ((sender_id = ${meId}::uuid AND recipient_id = ${peerId}::uuid)
                       OR (sender_id = ${peerId}::uuid AND recipient_id = ${meId}::uuid))
                   ORDER BY created_at ASC LIMIT 300`,
      );
    });
  }

  /** Envia uma mensagem para um destinatário específico. */
  async send(
    schema: string,
    sender: { id: string; name: string; role: string },
    recipientId: string,
    body: string,
  ): Promise<ChatMessageRow> {
    const text = body.trim().slice(0, 2000);
    return this.prisma.runInTenant(schema, async (tx) => {
      await this.touch(tx, sender.id);
      const rows = await tx.$queryRaw<ChatMessageRow[]>(
        Prisma.sql`INSERT INTO staff_messages (sender_id, recipient_id, sender_name, sender_role, body)
                   VALUES (${sender.id}::uuid, ${recipientId}::uuid, ${sender.name}, ${sender.role}, ${text})
                   RETURNING id, sender_id, recipient_id, sender_name, sender_role, body, created_at`,
      );
      return rows[0];
    });
  }

  /** Marca como lida a conversa com um par. */
  async markRead(schema: string, meId: string, peerId: string): Promise<{ ok: true }> {
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(
        Prisma.sql`INSERT INTO staff_chat_reads (user_id, peer_id, read_at)
                   VALUES (${meId}::uuid, ${peerId}::uuid, now())
                   ON CONFLICT (user_id, peer_id) DO UPDATE SET read_at = now()`,
      ),
    );
    return { ok: true };
  }

  /** Apaga (soft-delete) mensagens de uma conversa minha. */
  async remove(schema: string, meId: string, ids: string[]): Promise<{ deleted: number }> {
    if (!ids.length) return { deleted: 0 };
    return this.prisma.runInTenant(schema, async (tx) => {
      const idList = Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`));
      const n = await tx.$executeRaw(
        Prisma.sql`UPDATE staff_messages SET deleted_at = now()
                   WHERE id IN (${idList}) AND deleted_at IS NULL
                     AND (sender_id = ${meId}::uuid OR recipient_id = ${meId}::uuid)`,
      );
      return { deleted: Number(n) };
    });
  }

  /** Total de não-lidas (badge global). Atualiza presença. */
  async unread(schema: string, meId: string): Promise<{ count: number }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      await this.touch(tx, meId);
      const rows = await tx.$queryRaw<{ n: number }[]>(
        Prisma.sql`SELECT COUNT(*)::int AS n FROM staff_messages m
                   WHERE m.recipient_id = ${meId}::uuid AND m.deleted_at IS NULL
                     AND m.created_at > COALESCE((SELECT read_at FROM staff_chat_reads r WHERE r.user_id = ${meId}::uuid AND r.peer_id = m.sender_id), to_timestamp(0))`,
      );
      return { count: rows[0]?.n ?? 0 };
    });
  }
}
