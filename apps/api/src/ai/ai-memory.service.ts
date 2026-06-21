import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AiMsgRow {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: Date;
}

/**
 * Memória do assistente IA POR UTILIZADOR (e por empresa): guarda o histórico
 * para o assistente "lembrar" conversas anteriores (chat e chamada) e dar
 * respostas com contexto. Gestão de TOKEN profissional: o contexto enviado ao
 * modelo é cortado a um ORÇAMENTO de caracteres (mantém as mensagens recentes),
 * evitando reenviar a conversa toda e gastar tokens desnecessariamente.
 */
@Injectable()
export class AiMemoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Histórico recente do utilizador (ascendente), para mostrar/retomar. */
  history(schema: string, userId: string, limit = 60): Promise<AiMsgRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx
        .$queryRaw<AiMsgRow[]>(
          Prisma.sql`SELECT id, role, content, created_at FROM ai_messages
                     WHERE user_id = ${userId}::uuid ORDER BY created_at DESC LIMIT ${limit}`,
        )
        .then((rows) => rows.reverse()),
    );
  }

  /** Guarda uma mensagem (user/assistant) na memória do utilizador. */
  async append(schema: string, userId: string, role: 'user' | 'assistant', content: string): Promise<void> {
    const text = (content ?? '').trim();
    if (!text) return;
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(
        Prisma.sql`INSERT INTO ai_messages (user_id, role, content)
                   VALUES (${userId}::uuid, ${role}, ${text.slice(0, 8000)})`,
      ),
    );
  }

  /**
   * Contexto para o modelo: as mensagens MAIS RECENTES que cabem no orçamento
   * de caracteres (≈ token budget). Devolve em ordem cronológica.
   */
  async context(
    schema: string,
    userId: string,
    charBudget = 12000,
  ): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
    const rows = await this.history(schema, userId, 80);
    const out: { role: 'user' | 'assistant'; content: string }[] = [];
    let total = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const c = rows[i].content.slice(0, 4000);
      if (total + c.length > charBudget && out.length > 0) break;
      out.push({ role: rows[i].role, content: c });
      total += c.length;
    }
    return out.reverse();
  }

  /** Limpa a memória do assistente do utilizador (nova conversa). */
  async clear(schema: string, userId: string): Promise<{ ok: true }> {
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`DELETE FROM ai_messages WHERE user_id = ${userId}::uuid`),
    );
    return { ok: true };
  }
}
