import type { JwtPayload } from '@nexus/types';
import { PushService, type PushOpDto } from './push.service';

/**
 * Testa a subida de operações feitas SEM REDE, sem precisar de base de dados.
 *
 * Três propriedades que, se falharem, custam dinheiro real ao lojista:
 *   1. ORDEM — a abertura do turno tem de entrar ANTES das vendas. Se entrasse
 *      depois, a venda era emitida na mesma (o movimento de caixa é
 *      best-effort) mas o dinheiro não ficava no turno e o fecho não batia.
 *   2. IDEMPOTÊNCIA — reenviar a mesma abertura (rede a oscilar) não pode criar
 *      um segundo turno; tem de devolver o primeiro.
 *   3. ISOLAMENTO — uma operação recusada não pode segurar as seguintes.
 */

/** Erro tal como o Postgres o devolve numa violação de índice único. */
function uniqueViolation(index: string): Error {
  return new Error(`duplicate key value violates unique constraint "${index}" (23505)`);
}

const USER = { sub: 'user-1', name: 'Ana', email: 'ana@x.ao', storeId: 'store-1' } as unknown as JwtPayload;

function op(over: Partial<PushOpDto>): PushOpDto {
  return {
    opId: '00000000-0000-4000-8000-000000000001',
    seq: 1,
    entity: 'cashSession',
    op: 'create',
    localId: 'local-1',
    payload: {},
    createdAt: '2026-08-02T08:00:00.000Z',
    ...over,
  };
}

/**
 * Monta o serviço com dependências falsas. `rows` alimenta as respostas de
 * `$queryRaw` por ordem — o livro de operações é consultado primeiro e devolve
 * vazio (operação nunca vista), que é o caminho normal.
 */
function makeService(opts: {
  rows?: unknown[][];
  openImpl?: jest.Mock;
  emitImpl?: jest.Mock;
  movementImpl?: jest.Mock;
  closeImpl?: jest.Mock;
} = {}) {
  const queue = [...(opts.rows ?? [])];
  const tx = {
    $queryRaw: jest.fn(() => Promise.resolve(queue.length ? queue.shift() : [])),
    $executeRaw: jest.fn(() => Promise.resolve(1)),
  };
  const prisma = {
    runInTenant: jest.fn((_schema: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const cashbox = {
    open: opts.openImpl ?? jest.fn(() => Promise.resolve({ id: 'session-server-1' })),
    addMovement: opts.movementImpl ?? jest.fn(() => Promise.resolve({ id: 'mov-1' })),
    close: opts.closeImpl ?? jest.fn(() => Promise.resolve({ type: 'Z', expected: 100, counted: 100 })),
  };
  const invoices = { emit: opts.emitImpl ?? jest.fn(() => Promise.resolve({ id: 'inv-1', number: 'FT A/1' })) };
  const pos = { createCustomer: jest.fn(), updateCustomer: jest.fn() };

  const service = new PushService(
    prisma as never, invoices as never, pos as never, cashbox as never,
  );
  return { service, cashbox, invoices, tx };
}

describe('PushService — turnos de caixa offline', () => {
  it('aplica a ABERTURA do turno antes das vendas, mesmo recebendo fora de ordem', async () => {
    const order: string[] = [];
    const { service } = makeService({
      openImpl: jest.fn(() => { order.push('abrir-turno'); return Promise.resolve({ id: 'session-1' }); }),
      emitImpl: jest.fn(() => { order.push('venda'); return Promise.resolve({ id: 'inv-1' }); }),
    });

    // O lote chega com a venda ANTES da abertura (ordem de rede, não de negócio).
    await service.push('t1', [
      op({ opId: '00000000-0000-4000-8000-00000000000b', seq: 2, entity: 'sale', payload: { lines: [] } }),
      op({ opId: '00000000-0000-4000-8000-00000000000a', seq: 1, entity: 'cashSession', payload: { openingFloat: 5000 } }),
    ], USER);

    expect(order).toEqual(['abrir-turno', 'venda']); // `seq` mandou, não a ordem do array
  });

  it('passa o opId como client_op_id — é o Postgres que impede o turno duplicado', async () => {
    const { service, cashbox } = makeService();
    await service.push('t1', [op({ payload: { openingFloat: 2500, registerCode: 'C1' } })], USER);

    expect(cashbox.open).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ openingFloat: 2500, registerCode: 'C1' }),
      expect.objectContaining({ id: 'user-1' }),
      '00000000-0000-4000-8000-000000000001', // ← o opId
    );
  });

  it('reenvio da mesma abertura devolve DUPLICATE com o turno original (não cria outro)', async () => {
    const { service } = makeService({
      openImpl: jest.fn(() => Promise.reject(uniqueViolation('cash_sessions_client_op_uidx'))),
      // 1.ª consulta = livro (vazio); 2.ª = a linha já existente encontrada por client_op_id
      rows: [[], [{ id: 'session-ja-existente' }]],
    });

    const [res] = await service.push('t1', [op({ payload: { openingFloat: 1000 } })], USER);

    expect(res.status).toBe('duplicate');
    expect(res.serverId).toBe('session-ja-existente');
  });

  it('um turno recusado NÃO impede as operações seguintes de entrar', async () => {
    const { service, cashbox } = makeService({
      openImpl: jest.fn(() => Promise.reject(new Error('Já tem um turno aberto.'))),
    });

    const results = await service.push('t1', [
      op({ opId: '00000000-0000-4000-8000-00000000000c', seq: 1, payload: { openingFloat: 1 } }),
      op({
        opId: '00000000-0000-4000-8000-00000000000d', seq: 2,
        entity: 'cashMovement', payload: { type: 'CASH_OUT', amount: 5000, reference: 'sangria' },
      }),
    ], USER);

    expect(results[0].status).toBe('rejected');
    expect(results[0].code).toBe('SHIFT_REJECTED');
    expect(results[1].status).toBe('applied'); // a sangria entrou na mesma
    expect(cashbox.addMovement).toHaveBeenCalled();
  });

  it('o FECHO do turno delega no CashboxService — o servidor recalcula o esperado', async () => {
    const { service, cashbox } = makeService();
    const [res] = await service.push('t1', [
      op({ op: 'update', payload: { countedCash: 84350, notes: 'faltou troco' } }),
    ], USER);

    expect(res.status).toBe('applied');
    expect(cashbox.close).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ countedCash: 84350, notes: 'faltou troco' }),
      expect.objectContaining({ id: 'user-1' }),
    );
  });

  it('um movimento de caixa não pode ser alterado nem eliminado', async () => {
    const { service } = makeService();
    const [res] = await service.push('t1', [
      op({ entity: 'cashMovement', op: 'delete', payload: {} }),
    ], USER);

    expect(res.status).toBe('rejected');
    expect(res.code).toBe('OP_NOT_ALLOWED');
  });

  it('uma entidade ainda não suportada é recusada explicitamente (não em silêncio)', async () => {
    const { service } = makeService();
    const [res] = await service.push('t1', [op({ entity: 'purchaseOrder' })], USER);

    expect(res.status).toBe('rejected');
    expect(res.code).toBe('ENTITY_NOT_SUPPORTED');
  });
});
