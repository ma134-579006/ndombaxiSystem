import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const GENESIS_HASH = '0'.repeat(64);

export interface AuditEntry {
  actorType: 'PLATFORM' | 'TENANT' | 'SYSTEM';
  actorId?: string | null;
  tenantSchema?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/**
 * Auditoria imutável (§9.3): append-only + hash encadeado estilo blockchain.
 * Alterar um log retroactivamente quebra a cadeia de hashes.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  private computeHash(prevHash: string, entry: AuditEntry, ts: string): string {
    const canonical = JSON.stringify({
      prevHash,
      timestamp: ts,
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      tenantSchema: entry.tenantSchema ?? null,
      action: entry.action,
      entity: entry.entity ?? null,
      entityId: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip ?? null,
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const last = await tx.auditLog.findFirst({
          orderBy: { seq: 'desc' },
          select: { hash: true },
        });
        const prevHash = last?.hash ?? GENESIS_HASH;
        const timestamp = new Date().toISOString();
        const hash = this.computeHash(prevHash, entry, timestamp);

        await tx.auditLog.create({
          data: {
            timestamp: new Date(timestamp),
            actorType: entry.actorType,
            actorId: entry.actorId ?? null,
            tenantSchema: entry.tenantSchema ?? null,
            action: entry.action,
            entity: entry.entity ?? null,
            entityId: entry.entityId ?? null,
            before:
              entry.before == null
                ? Prisma.DbNull
                : (entry.before as Prisma.InputJsonValue),
            after:
              entry.after == null
                ? Prisma.DbNull
                : (entry.after as Prisma.InputJsonValue),
            ip: entry.ip ?? null,
            prevHash,
            hash,
          },
        });
      });
    } catch (err) {
      // Auditoria nunca deve derrubar a operação de negócio; regista o erro.
      this.logger.error(
        `Falha ao gravar audit log (${entry.action})`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  /** Verifica a integridade da cadeia de hashes. Retorna o seq onde quebrou, ou null. */
  async verifyChain(): Promise<{ valid: boolean; brokenAtSeq: bigint | null }> {
    const logs = await this.prisma.auditLog.findMany({
      orderBy: { seq: 'asc' },
    });
    let prevHash = GENESIS_HASH;
    for (const log of logs) {
      if (log.prevHash !== prevHash) {
        return { valid: false, brokenAtSeq: log.seq };
      }
      const recomputed = this.computeHash(
        prevHash,
        {
          actorType: log.actorType as AuditEntry['actorType'],
          actorId: log.actorId,
          tenantSchema: log.tenantSchema,
          action: log.action,
          entity: log.entity,
          entityId: log.entityId,
          before: log.before,
          after: log.after,
          ip: log.ip,
        },
        log.timestamp.toISOString(),
      );
      if (recomputed !== log.hash) {
        return { valid: false, brokenAtSeq: log.seq };
      }
      prevHash = log.hash;
    }
    return { valid: true, brokenAtSeq: null };
  }
}
