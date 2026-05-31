import { Prisma } from '@prisma/client';
import { AuditService } from './audit.service';
import type { PrismaService } from '../prisma/prisma.service';

interface Row {
  seq: bigint;
  timestamp: Date;
  actorType: string;
  actorId: string | null;
  tenantSchema: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  prevHash: string;
  hash: string;
}

/** Fake Prisma em memória que cobre as chamadas usadas pelo AuditService. */
function makeFakePrisma(rows: Row[]): PrismaService {
  const tx = {
    auditLog: {
      findFirst: async () =>
        rows.length ? { hash: rows[rows.length - 1].hash } : null,
      create: async ({ data }: { data: Omit<Row, 'seq'> }) => {
        // Imita o PostgreSQL: Prisma.DbNull é gravado e relido como NULL.
        const norm = (v: unknown) => (v === Prisma.DbNull ? null : v);
        rows.push({
          seq: BigInt(rows.length + 1),
          ...data,
          before: norm(data.before),
          after: norm(data.after),
        } as Row);
      },
    },
  };
  return {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    auditLog: {
      findMany: async () => [...rows].sort((a, b) => Number(a.seq - b.seq)),
    },
  } as unknown as PrismaService;
}

describe('AuditService (cadeia de hashes imutável)', () => {
  it('encadeia hashes e a cadeia valida', async () => {
    const rows: Row[] = [];
    const service = new AuditService(makeFakePrisma(rows));

    await service.record({ actorType: 'SYSTEM', action: 'A' });
    await service.record({ actorType: 'PLATFORM', action: 'B', actorId: 'x' });
    await service.record({ actorType: 'TENANT', action: 'C' });

    expect(rows).toHaveLength(3);
    expect(rows[0].prevHash).toBe('0'.repeat(64));
    expect(rows[1].prevHash).toBe(rows[0].hash);
    expect(rows[2].prevHash).toBe(rows[1].hash);

    const result = await service.verifyChain();
    expect(result.valid).toBe(true);
  });

  it('detecta adulteração de um registo', async () => {
    const rows: Row[] = [];
    const service = new AuditService(makeFakePrisma(rows));
    await service.record({ actorType: 'SYSTEM', action: 'A' });
    await service.record({ actorType: 'SYSTEM', action: 'B' });

    // adultera o conteúdo do primeiro registo sem recalcular o hash
    rows[0].action = 'HACKED';

    const result = await service.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(1n);
  });
});
