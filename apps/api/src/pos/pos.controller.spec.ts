import type { JwtPayload } from '@nexus/types';
import { PosController } from './pos.controller';
import type { EmitInvoiceDto } from './dto/emit-invoice.dto';

/**
 * Fecha a janela de DUPLICAÇÃO FISCAL da venda offline.
 *
 * O cenário real, e o motivo de isto existir: o posto reenvia uma venda da fila,
 * o servidor GRAVA a fatura, mas a resposta perde-se no caminho (rede a cair ou
 * timeout). O posto dá a venda como não emitida e tenta outra vez. Sem chave de
 * idempotência nascia um SEGUNDO documento fiscal — com stock e dinheiro em
 * dobro, e a numeração AGT a contar uma venda que não existiu.
 */

const USER = { sub: 'u1', name: 'Ana', email: 'ana@x.ao', storeId: 's1' } as unknown as JwtPayload;
const OP_ID = '11111111-1111-4111-8111-111111111111';

/** Erro tal como o Postgres o devolve ao bater no índice único. */
function duplicateKeyError(): Error {
  return new Error(
    'duplicate key value violates unique constraint "invoices_client_op_uidx" (23505)',
  );
}

function makeController(invoices: Partial<Record<string, unknown>>) {
  const ctx = { requireTenantSchema: () => 'tenant_1' };
  return new PosController(
    {} as never, invoices as never, {} as never, {} as never, ctx as never, {} as never,
  );
}

function dto(over: Partial<EmitInvoiceDto> = {}): EmitInvoiceDto {
  return { lines: [{ productCode: 'P1', quantity: 1 }], ...over } as EmitInvoiceDto;
}

describe('PosController — emissão idempotente da venda', () => {
  it('encaminha o clientOpId para o serviço de emissão', async () => {
    const emit = jest.fn(() => Promise.resolve({ id: 'inv-1', number: 'FT A/1' }));
    const controller = makeController({ emit });

    await controller.emitInvoice(dto({ clientOpId: OP_ID }), USER);

    expect(emit).toHaveBeenCalledWith('tenant_1', expect.objectContaining({ clientOpId: OP_ID }));
  });

  it('reenvio da MESMA venda devolve a fatura ORIGINAL — não emite uma segunda', async () => {
    const original = { id: 'inv-1', number: 'FT A/7', hash: 'abc', grossTotal: 15000 };
    const emit = jest.fn(() => Promise.reject(duplicateKeyError()));
    const findByClientOpId = jest.fn(() => Promise.resolve(original));
    const controller = makeController({ emit, findByClientOpId });

    const res = await controller.emitInvoice(dto({ clientOpId: OP_ID }), USER);

    expect(res).toEqual(original);              // o posto imprime o número VERDADEIRO
    expect(findByClientOpId).toHaveBeenCalledWith('tenant_1', OP_ID);
    expect(emit).toHaveBeenCalledTimes(1);      // não houve segunda emissão
  });

  it('sem clientOpId o erro sobe tal como antes (comportamento inalterado)', async () => {
    const emit = jest.fn(() => Promise.reject(duplicateKeyError()));
    const findByClientOpId = jest.fn();
    const controller = makeController({ emit, findByClientOpId });

    await expect(controller.emitInvoice(dto(), USER)).rejects.toThrow(/duplicate key/);
    expect(findByClientOpId).not.toHaveBeenCalled();
  });

  it('outro erro qualquer NÃO é confundido com duplicado — sobe à mesma', async () => {
    const emit = jest.fn(() => Promise.reject(new Error('Stock insuficiente para P1.')));
    const findByClientOpId = jest.fn();
    const controller = makeController({ emit, findByClientOpId });

    await expect(controller.emitInvoice(dto({ clientOpId: OP_ID }), USER))
      .rejects.toThrow('Stock insuficiente para P1.');
    expect(findByClientOpId).not.toHaveBeenCalled(); // não mascara recusas de negócio
  });

  it('violação de OUTRA restrição única não é tratada como reenvio', async () => {
    const emit = jest.fn(() => Promise.reject(
      new Error('duplicate key value violates unique constraint "invoices_number_uidx" (23505)'),
    ));
    const findByClientOpId = jest.fn();
    const controller = makeController({ emit, findByClientOpId });

    await expect(controller.emitInvoice(dto({ clientOpId: OP_ID }), USER)).rejects.toThrow();
    expect(findByClientOpId).not.toHaveBeenCalled();
  });
});
