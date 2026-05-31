import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '@nexus/types';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { orderRoom, RealtimeService, tenantRoom } from './realtime.service';

/**
 * Gateway WebSocket em tempo real. Dois tipos de ligação:
 *  • EQUIPA (autenticada): handshake `auth.token` (JWT do tenant) → entra na
 *    room do tenant e conta para a presença (dashboards + chat das encomendas).
 *  • CLIENTE (convidado, sem login): handshake `auth.storeCode` + `auth.orderId`
 *    → entra apenas na room da sua encomenda para conversar com a loja.
 */
@WebSocketGateway({ namespace: 'realtime', cors: { origin: true } })
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly realtime: RealtimeService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.setServer(server);
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const auth = client.handshake.auth ?? {};
      const query = client.handshake.query ?? {};
      const token = (auth.token as string | undefined) ?? (query.token as string | undefined);

      if (token) {
        // ── Ligação de EQUIPA (autenticada) ────────────────────
        const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
          secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        });
        if (!payload.tenantSchema) throw new Error('not a tenant token');

        const schema = payload.tenantSchema;
        await client.join(tenantRoom(schema));
        client.data.kind = 'staff';
        client.data.schema = schema;
        this.realtime.addStaff(schema, client.id);
        client.emit('connected', { room: tenantRoom(schema), role: 'staff' });
        this.logger.debug(`WS staff ${client.id} → ${tenantRoom(schema)}`);
        return;
      }

      // ── Ligação de CLIENTE (convidado) ─────────────────────────
      const storeCode = (auth.storeCode as string | undefined) ?? (query.storeCode as string | undefined);
      const orderId = (auth.orderId as string | undefined) ?? (query.orderId as string | undefined);
      if (!storeCode || !orderId) throw new Error('missing credentials');

      const company = await this.prisma.company.findUnique({ where: { code: storeCode } });
      if (!company || company.status !== 'ACTIVE') throw new Error('store unavailable');

      const schema = company.schemaName;
      await client.join(orderRoom(schema, orderId));
      client.data.kind = 'guest';
      client.emit('connected', { room: orderRoom(schema, orderId), role: 'guest' });
      this.logger.debug(`WS guest ${client.id} → ${orderRoom(schema, orderId)}`);
    } catch (err) {
      this.logger.warn(`WS auth falhou: ${err instanceof Error ? err.message : 'unknown'}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    if (client.data?.kind === 'staff' && typeof client.data?.schema === 'string') {
      this.realtime.removeStaff(client.data.schema, client.id);
    }
  }
}
