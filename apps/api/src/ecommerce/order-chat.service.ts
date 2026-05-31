import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AssistantService } from '../ai/assistant.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

export interface OrderMessageRow {
  id: string;
  order_id: string;
  sender_type: string; // CUSTOMER / STAFF / ASSISTANT
  sender_id: string | null;
  sender_name: string;
  body: string;
  created_at: Date;
}

/** Estados em que o cliente pode conversar com a loja (depois de aprovado). */
const CHATTABLE = ['PAID', 'SHIPPED', 'DELIVERED'];

/**
 * Conversa em tempo real entre o cliente e a equipa da loja, por encomenda
 * (disponível depois da encomenda aprovada/paga). Quando nenhum membro da
 * equipa está online, o assistente OpenManus responde automaticamente,
 * esclarecendo as dúvidas do cliente.
 */
@Injectable()
export class OrderChatService {
  private readonly logger = new Logger(OrderChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly assistant: AssistantService,
  ) {}

  /** Garante que a encomenda existe e já está aprovada (chat aberto). */
  private async requireOpenOrder(
    schema: string,
    orderId: string,
  ): Promise<{ id: string; status: string; customer_name: string }> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ id: string; status: string; customer_name: string }[]>(
        Prisma.sql`SELECT id, status, customer_name FROM web_orders
                   WHERE id = ${orderId}::uuid LIMIT 1`,
      ),
    );
    if (!rows[0]) throw new NotFoundException('Encomenda não encontrada');
    if (!CHATTABLE.includes(rows[0].status)) {
      throw new BadRequestException(
        'A conversa fica disponível depois de a encomenda ser aprovada/paga.',
      );
    }
    return rows[0];
  }

  list(schema: string, orderId: string): Promise<OrderMessageRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<OrderMessageRow[]>(
        Prisma.sql`SELECT * FROM order_messages WHERE order_id = ${orderId}::uuid
                   ORDER BY created_at`,
      ),
    );
  }

  private async insert(
    schema: string,
    orderId: string,
    senderType: string,
    senderName: string,
    body: string,
    senderId?: string | null,
  ): Promise<OrderMessageRow> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<OrderMessageRow[]>(
        Prisma.sql`INSERT INTO order_messages
            (order_id, sender_type, sender_id, sender_name, body)
          VALUES (${orderId}::uuid, ${senderType}, ${senderId ?? null}::uuid,
                  ${senderName}, ${body})
          RETURNING *`,
      ),
    );
    const msg = rows[0];
    // Entrega em tempo real: room da encomenda (cliente) + room do tenant (equipa).
    this.realtime.publishToOrder(schema, orderId, 'order.message', msg);
    this.realtime.publish(schema, 'order.message', msg);
    return msg;
  }

  /** Mensagem enviada pelo CLIENTE (montra pública). */
  async postCustomerMessage(
    schema: string,
    orderId: string,
    body: string,
    senderName?: string,
  ): Promise<{ message: OrderMessageRow; assistant?: OrderMessageRow }> {
    const order = await this.requireOpenOrder(schema, orderId);
    const message = await this.insert(
      schema,
      orderId,
      'CUSTOMER',
      senderName?.trim() || order.customer_name,
      body,
    );

    // Fallback OpenManus: se nenhum membro da equipa estiver online, responde já.
    if (!this.realtime.isStaffOnline(schema)) {
      const assistant = await this.replyWithAssistant(schema, orderId, body);
      if (assistant) return { message, assistant };
    }
    return { message };
  }

  /** Mensagem enviada pela EQUIPA (gestor/admin no back-office). */
  async postStaffMessage(
    schema: string,
    orderId: string,
    body: string,
    senderId: string,
    senderName: string,
  ): Promise<OrderMessageRow> {
    await this.requireOpenOrder(schema, orderId);
    return this.insert(schema, orderId, 'STAFF', senderName || 'Equipa da loja', body, senderId);
  }

  /** Gera e regista uma resposta do assistente (best-effort). */
  private async replyWithAssistant(
    schema: string,
    orderId: string,
    customerText: string,
  ): Promise<OrderMessageRow | null> {
    try {
      const { displayName } = await this.assistant.greeting();
      const result = await this.assistant.chat(
        [
          {
            role: 'user',
            content: `Sou um cliente de uma loja online com uma encomenda já paga. ${customerText}`,
          },
        ],
        { channel: 'chat' },
      );
      return await this.insert(schema, orderId, 'ASSISTANT', displayName, result.reply);
    } catch (err) {
      // Sem provedor de IA configurado ou falha de rede — não bloqueia o chat.
      this.logger.debug(
        `Fallback OpenManus indisponível: ${err instanceof Error ? err.message : 'desconhecido'}`,
      );
      return null;
    }
  }
}
