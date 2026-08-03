import { ReplicationService, type IncomingRow } from './replication.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Isto aceita escritas genéricas em tabelas da empresa — o tipo de coisa que
 * corrompe sistemas. Estes testes verificam as barreiras que impedem o
 * desastre, e a mais importante de todas é esta: **um posto não pode reescrever
 * um documento fiscal**.
 */

const SCHEMA = 'tenant_ab12cd34';

function fake(existing: Record<string, unknown> | null = null) {
  const executed: { sql: string; params: unknown[] }[] = [];
  const prisma = {
    $executeRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
      executed.push({ sql, params });
      // Simula o `ON CONFLICT DO NOTHING`: se já existia, 0 linhas.
      if (sql.includes('ON CONFLICT DO NOTHING') && existing) return 0;
      return 1;
    }),
    $queryRawUnsafe: jest.fn(async () => (existing ? [existing] : [])),
  } as unknown as PrismaService;
  return { svc: new ReplicationService(prisma), executed };
}

function row(over: Partial<IncomingRow> = {}): IncomingRow {
  return {
    table: 'products',
    id: '11111111-1111-4111-8111-111111111111',
    data: { id: '11111111-1111-4111-8111-111111111111', name: 'Pão', version: 2 },
    deviceId: 'posto-1',
    ...over,
  };
}

describe('ReplicationService — o que um posto PODE escrever na nuvem', () => {
  it('RECUSA tabelas da nuvem (um posto não altera quem tem acesso)', async () => {
    const { svc } = fake();
    const [r] = await svc.push(SCHEMA, [row({ table: 'users', data: { id: 'u1', role: 'COMPANY_ADMIN' } })]);
    expect(r.applied).toBe(false);
    expect(r.reason).toMatch(/cloud|não sobe/);
  });

  it('RECUSA séries fiscais (partiria a numeração de outro posto)', async () => {
    const { svc } = fake();
    const [r] = await svc.push(SCHEMA, [row({ table: 'fiscal_series', data: { id: 's1', last_sequence: 999 } })]);
    expect(r.applied).toBe(false);
  });

  it('RECUSA saldos derivados', async () => {
    const { svc } = fake();
    const [r] = await svc.push(SCHEMA, [row({ table: 'stock_items', data: { id: 'x', qty: 40 } })]);
    expect(r.applied).toBe(false);
  });

  it('RECUSA uma tabela que a política não conhece', async () => {
    const { svc } = fake();
    const [r] = await svc.push(SCHEMA, [row({ table: 'tabela_inventada', data: { id: 'x' } })]);
    expect(r.applied).toBe(false);
    expect(r.reason).toMatch(/não classificada/);
  });

  it('RECUSA um nome de coluna que não é um nome de coluna', async () => {
    const { svc, executed } = fake();
    const [r] = await svc.push(SCHEMA, [row({ data: { 'name"; DROP TABLE users; --': 'x' } })]);
    expect(r.applied).toBe(false);
    expect(executed.map((e) => e.sql).join(' ')).not.toContain('DROP TABLE');
  });

  it('RECUSA um schema que não tem forma de schema de empresa', async () => {
    const { svc } = fake();
    await expect(svc.push('nao_e_schema; DROP', [row()])).rejects.toThrow(/Invalid tenant schema/);
  });

  it('RECUSA um lote demasiado grande', async () => {
    const { svc } = fake();
    const muitas = Array.from({ length: ReplicationService.MAX_BATCH + 1 }, () => row());
    await expect(svc.push(SCHEMA, muitas)).rejects.toThrow(/demasiado grande/);
  });
});

describe('ReplicationService — documentos fiscais são IMUTÁVEIS', () => {
  it('uma fatura NOVA entra', async () => {
    const { svc, executed } = fake(null);
    const [r] = await svc.push(SCHEMA, [row({ table: 'invoices', data: { id: 'f1', number: 'FT A1/1' } })]);
    expect(r.applied).toBe(true);
    const ins = executed.find((e) => e.sql.includes('invoices'));
    expect(ins?.sql).toContain('ON CONFLICT DO NOTHING');
  });

  it('uma fatura que JÁ EXISTE não é reescrita — mesmo que o posto insista', async () => {
    // Esta é a barreira que impede um posto de adulterar o histórico fiscal.
    const { svc, executed } = fake({ id: 'f1', number: 'FT A1/1', gross_total: 1000 });
    const [r] = await svc.push(SCHEMA, [
      row({ table: 'invoices', data: { id: 'f1', number: 'FT A1/1', gross_total: 999999 } }),
    ]);
    expect(r.applied).toBe(false);
    expect(r.reason).toMatch(/não se reescrevem/);
    // E, decisivo: nunca se gerou um UPDATE para a tabela de faturas.
    const tocouFaturas = executed.filter((e) => e.sql.includes('invoices'));
    expect(tocouFaturas.every((e) => !/DO UPDATE/i.test(e.sql))).toBe(true);
  });

  it('movimentos de stock também só entram (alterar seria apagar história)', async () => {
    const { svc, executed } = fake(null);
    const [r] = await svc.push(SCHEMA, [row({ table: 'stock_movements', data: { id: 'm1', delta: -3 } })]);
    expect(r.applied).toBe(true);
    expect(executed.find((e) => e.sql.includes('stock_movements'))?.sql)
      .toContain('ON CONFLICT DO NOTHING');
  });
});

describe('ReplicationService — catálogo e conflitos', () => {
  it('um produto novo entra', async () => {
    const { svc } = fake(null);
    const [r] = await svc.push(SCHEMA, [row()]);
    expect(r.applied).toBe(true);
  });

  it('o posto GANHA quando tem versão mais alta', async () => {
    const { svc, executed } = fake({ id: '11111111-1111-4111-8111-111111111111', version: 1 });
    const [r] = await svc.push(SCHEMA, [row({ data: { id: '11111111-1111-4111-8111-111111111111', name: 'Novo', version: 5 } })]);
    expect(r.applied).toBe(true);
    expect(executed.some((e) => /DO UPDATE/i.test(e.sql))).toBe(true);
  });

  it('o posto PERDE quando a nuvem tem versão mais alta — e nada é escrito', async () => {
    const { svc, executed } = fake({ id: '11111111-1111-4111-8111-111111111111', version: 9 });
    const [r] = await svc.push(SCHEMA, [row({ data: { id: '11111111-1111-4111-8111-111111111111', name: 'Antigo', version: 2 } })]);
    expect(r.applied).toBe(false);
    expect(executed.some((e) => /DO UPDATE/i.test(e.sql))).toBe(false);
  });

  it('e o que perdeu fica REGISTADO com as duas versões', async () => {
    const { svc, executed } = fake({ id: '11111111-1111-4111-8111-111111111111', version: 9 });
    await svc.push(SCHEMA, [row({ data: { id: '11111111-1111-4111-8111-111111111111', name: 'Antigo', version: 2 } })]);
    const log = executed.find((e) => e.sql.includes('sync_conflicts') && e.sql.includes('INSERT'));
    expect(log).toBeDefined();
    // As DUAS versões ficam guardadas — nada se perde em silêncio.
    expect(String(log?.params[4])).toContain('Antigo');
    expect(String(log?.params[5])).toContain('"version":9');
  });

  it('uma linha recusada NÃO impede as outras do mesmo lote', async () => {
    const { svc } = fake(null);
    const out = await svc.push(SCHEMA, [
      row({ table: 'users', data: { id: 'u1' } }),   // recusada
      row(),                                          // esta tem de passar
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].applied).toBe(false);
    expect(out[1].applied).toBe(true);
  });
});
