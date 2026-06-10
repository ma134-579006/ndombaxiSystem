import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const GENESIS = '0'.repeat(64);

export interface TenantAuditEntry {
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  details?: unknown;
  ip?: string | null;
}

/**
 * Auditoria POR TENANT (no schema do tenant) — append-only com hash encadeado
 * (estilo blockchain), igual ao AuditService global mas isolado por empresa.
 * Regista tudo o que acontece no caixa/stock: vendas, baixas, cancelamentos,
 * entradas de stock, abertura/fecho de turno — com data/hora e funcionário.
 *
 * Aceita um `tx` opcional para participar na MESMA transacção da operação de
 * negócio (ex.: gravar a venda e o seu log atomicamente).
 */
@Injectable()
export class TenantAuditService {
  private readonly logger = new Logger(TenantAuditService.name);
  constructor(private readonly prisma: PrismaService) {}

  private hashOf(prev: string, e: TenantAuditEntry, ts: string): string {
    const canonical = JSON.stringify({
      prev, ts,
      actorId: e.actorId ?? null, actorName: e.actorName ?? null,
      action: e.action, entity: e.entity ?? null, entityId: e.entityId ?? null,
      details: e.details ?? null, ip: e.ip ?? null,
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  /** A auditoria mostra o NOME do funcionário. Se só houver o email (tokens
   *  antigos sem `name` no JWT), resolve o nome real na tabela users. */
  private async resolveActorName(tx: Prisma.TransactionClient, e: TenantAuditEntry): Promise<string | null> {
    const n = e.actorName ?? null;
    if (n && !n.includes('@')) return n;
    if (e.actorId) {
      try {
        const rows = await tx.$queryRaw<{ name: string | null }[]>(
          Prisma.sql`SELECT name FROM users WHERE id = ${e.actorId}::uuid LIMIT 1`,
        );
        if (rows[0]?.name) return rows[0].name;
      } catch { /* sem tabela users neste contexto — mantém o que veio */ }
    }
    return n;
  }

  /** Grava dentro de uma transacção já existente (search_path do tenant fixado). */
  async recordInTx(tx: Prisma.TransactionClient, e: TenantAuditEntry): Promise<void> {
    e = { ...e, actorName: await this.resolveActorName(tx, e) };
    const last = await tx.$queryRaw<{ hash: string }[]>(
      Prisma.sql`SELECT hash FROM tenant_audit_log ORDER BY seq DESC LIMIT 1`,
    );
    const prev = last[0]?.hash ?? GENESIS;
    const ts = new Date().toISOString();
    const hash = this.hashOf(prev, e, ts);
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO tenant_audit_log
          (timestamp, actor_id, actor_name, action, entity, entity_id, details, ip, prev_hash, hash)
        VALUES (${ts}::timestamptz, ${e.actorId ?? null}::uuid, ${e.actorName ?? null},
                ${e.action}, ${e.entity ?? null}, ${e.entityId ?? null},
                ${e.details == null ? Prisma.DbNull : JSON.stringify(e.details)}::jsonb,
                ${e.ip ?? null}, ${prev}, ${hash})`,
    );
  }

  /** Grava numa transacção própria (best-effort — nunca derruba a operação). */
  async record(schema: string, e: TenantAuditEntry): Promise<void> {
    try {
      await this.prisma.runInTenant(schema, (tx) => this.recordInTx(tx, e));
    } catch (err) {
      this.logger.error(
        `Falha ao gravar auditoria do tenant (${e.action})`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  /** Lista de eventos (gerente), com filtros opcionais. */
  async list(
    schema: string,
    filter: { action?: string; limit?: number } = {},
  ): Promise<unknown[]> {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const rows = (await this.prisma.runInTenant(schema, (tx) =>
      filter.action
        ? tx.$queryRaw(
            Prisma.sql`SELECT seq, timestamp, actor_name, action, entity, entity_id, details
                       FROM tenant_audit_log WHERE action = ${filter.action}
                       ORDER BY seq DESC LIMIT ${limit}`,
          )
        : tx.$queryRaw(
            Prisma.sql`SELECT seq, timestamp, actor_name, action, entity, entity_id, details
                       FROM tenant_audit_log ORDER BY seq DESC LIMIT ${limit}`,
          ),
    )) as Array<Record<string, unknown>>;
    // `seq` é int8 → vem como BigInt, que o JSON não serializa (causava 500).
    return rows.map((r) => ({ ...r, seq: typeof r.seq === 'bigint' ? Number(r.seq) : r.seq }));
  }

  /** Verifica a integridade da cadeia de hashes do tenant. */
  async verify(schema: string): Promise<{ valid: boolean; brokenAtSeq: number | null }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<
        {
          seq: number; timestamp: Date; actor_id: string | null; actor_name: string | null;
          action: string; entity: string | null; entity_id: string | null; details: unknown;
          ip: string | null; prev_hash: string; hash: string;
        }[]
      >(Prisma.sql`SELECT * FROM tenant_audit_log ORDER BY seq ASC`);
      let prev = GENESIS;
      for (const r of rows) {
        if (r.prev_hash !== prev) return { valid: false, brokenAtSeq: Number(r.seq) };
        const recomputed = this.hashOf(
          prev,
          {
            actorId: r.actor_id, actorName: r.actor_name, action: r.action,
            entity: r.entity, entityId: r.entity_id, details: r.details, ip: r.ip,
          },
          r.timestamp.toISOString(),
        );
        if (recomputed !== r.hash) return { valid: false, brokenAtSeq: Number(r.seq) };
        prev = r.hash;
      }
      return { valid: true, brokenAtSeq: null };
    });
  }
}
