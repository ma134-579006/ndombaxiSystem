import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

/** Prefixo de room por tenant: cada empresa só recebe os seus eventos. */
export function tenantRoom(schema: string): string {
  return `tenant:${schema}`;
}

/** Room por encomenda: cliente (convidado) e equipa conversam aqui. */
export function orderRoom(schema: string, orderId: string): string {
  return `order:${schema}:${orderId}`;
}

/**
 * Ponte entre a lógica de negócio e o servidor WebSocket. Mantém a referência
 * ao servidor socket.io (injectada pelo gateway) e publica eventos por tenant,
 * para os dashboards em tempo real (§8).
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;
  /** Sockets de equipa (autenticados) ligados, por schema → presença. */
  private readonly staff = new Map<string, Set<string>>();

  setServer(server: Server): void {
    this.server = server;
  }

  /** Emite um evento apenas para os clientes do tenant indicado. */
  publish(schema: string, event: string, payload: unknown): void {
    if (!this.server) {
      // Em ambientes sem WS (ex. testes) ignora silenciosamente.
      return;
    }
    this.server.to(tenantRoom(schema)).emit(event, payload);
    this.logger.debug(`WS → ${tenantRoom(schema)} :: ${event}`);
  }

  /** Emite um evento para a room de uma encomenda (cliente + equipa). */
  publishToOrder(schema: string, orderId: string, event: string, payload: unknown): void {
    if (!this.server) return;
    this.server.to(orderRoom(schema, orderId)).emit(event, payload);
    this.logger.debug(`WS → ${orderRoom(schema, orderId)} :: ${event}`);
  }

  // ── Presença da equipa (para o fallback OpenManus) ─────────
  addStaff(schema: string, socketId: string): void {
    if (!this.staff.has(schema)) this.staff.set(schema, new Set());
    this.staff.get(schema)!.add(socketId);
  }

  removeStaff(schema: string, socketId: string): void {
    const set = this.staff.get(schema);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) this.staff.delete(schema);
  }

  /** True se houver pelo menos um membro da equipa online neste tenant. */
  isStaffOnline(schema: string): boolean {
    return (this.staff.get(schema)?.size ?? 0) > 0;
  }
}
