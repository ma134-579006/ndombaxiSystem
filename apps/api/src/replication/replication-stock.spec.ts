import { ReplicationService } from './replication.service';

/** Prisma de mentira: regista o que é executado e se foi dentro de uma transacção. */
function fakePrisma(opts: { failOnStockUpdate?: boolean } = {}) {
  const log: { sql: string; args: unknown[]; inTx: boolean }[] = [];
  const mk = (inTx: boolean) => ({
    $executeRawUnsafe: jest.fn(async (sql: string, ...args: unknown[]) => {
      log.push({ sql, args, inTx });
      if (opts.failOnStockUpdate && /UPDATE ".*"\."products" SET stock_qty/.test(sql)) throw new Error('ligação perdida');
      return 1;
    }),
    $queryRawUnsafe: jest.fn(async () => []), // linha ainda não existe na nuvem
  });
  const base = mk(false);
  const prisma = {
    ...base,
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = log.length;
      try { return await fn(mk(true)); }
      catch (e) { log.splice(snapshot); throw e; } // rollback: nada do que correu fica
    }),
  };
  return { prisma, log };
}

const SCHEMA = 'tenant_abcd1234';
const PID = '11111111-1111-4111-8111-111111111111';
const WID = '22222222-2222-4222-8222-222222222222';

describe('replicação do stock', () => {
  it('produto NOVO vindo do posto entra com stock 0: o stock vem dos movimentos (sem contar a dobrar)', async () => {
    const { prisma, log } = fakePrisma();
    const svc = new ReplicationService(prisma as never);
    const out = await svc.push(SCHEMA, [{
      table: 'products', id: PID, deviceId: 'd1', deleted: false,
      data: { id: PID, code: 'X1', name: 'Novo', stock_qty: 10, version: 1, updated_at: new Date().toISOString() },
    }]);
    expect(out[0].applied).toBe(true);
    const ins = log.find((l) => /INSERT INTO "tenant_abcd1234"\."products"/.test(l.sql))!;
    expect(JSON.parse(ins.args[0] as string).stock_qty).toBe(0);
  });

  it('movimento novo: grava e aplica ao saldo na MESMA transacção', async () => {
    const { prisma, log } = fakePrisma();
    const svc = new ReplicationService(prisma as never);
    await svc.push(SCHEMA, [{
      table: 'stock_movements', id: 'm1', deviceId: 'd1', deleted: false,
      data: { id: 'm1', product_id: PID, warehouse_id: WID, type: 'IN', quantity: 10, balance_after: 10 },
    }]);
    const dentro = log.filter((l) => l.inTx).map((l) => l.sql);
    expect(dentro.some((s) => /INSERT INTO "tenant_abcd1234"\."stock_movements"/.test(s))).toBe(true);
    expect(dentro.some((s) => /UPDATE "tenant_abcd1234"\."stock_items"/.test(s))).toBe(true);
    expect(dentro.some((s) => /UPDATE "tenant_abcd1234"\."products" SET stock_qty/.test(s))).toBe(true);
  });

  it('se aplicar ao saldo falhar, o movimento NÃO fica gravado (o posto volta a tentar e conta uma só vez)', async () => {
    const { prisma, log } = fakePrisma({ failOnStockUpdate: true });
    const svc = new ReplicationService(prisma as never);
    const out = await svc.push(SCHEMA, [{
      table: 'stock_movements', id: 'm2', deviceId: 'd1', deleted: false,
      data: { id: 'm2', product_id: PID, warehouse_id: WID, type: 'OUT', quantity: -3, balance_after: 7 },
    }]);
    expect(out[0].applied).toBe(false); // recusado → o posto repete
    expect(log.some((l) => /INSERT INTO "tenant_abcd1234"\."stock_movements"/.test(l.sql))).toBe(false); // rollback
  });
});
