import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { StockService } from './stock.service';

/**
 * Testa a reconciliação de stock sem BD: mocka o cliente de transacção e
 * verifica que applyMovement (a) actualiza o saldo por armazém, (b) regista o
 * movimento no livro, (c) mantém coerente o espelho global products.stock_qty,
 * e (d) respeita allowNegative. Também cobre resolveDefaultWarehouse.
 */

interface FakeTx {
  $executeRaw: jest.Mock;
  $queryRaw: jest.Mock;
  calls: { kind: 'exec' | 'query'; sql: string }[];
}

/** Extrai o texto SQL de um template Prisma.sql (junta os fragmentos). */
function sqlText(arg: unknown): string {
  const a = arg as { strings?: readonly string[]; sql?: string } | undefined;
  if (a?.strings) return a.strings.join('?');
  if (typeof a?.sql === 'string') return a.sql;
  return String(arg);
}

/** Cria um tx falso; queryResults alimenta as respostas de $queryRaw por ordem. */
function makeTx(queryResults: unknown[]): FakeTx {
  const calls: FakeTx['calls'] = [];
  let qi = 0;
  const tx: FakeTx = {
    calls,
    $executeRaw: jest.fn(async (arg: unknown) => {
      calls.push({ kind: 'exec', sql: sqlText(arg) });
      return 1;
    }),
    $queryRaw: jest.fn(async (arg: unknown) => {
      calls.push({ kind: 'query', sql: sqlText(arg) });
      return queryResults[qi++] ?? [];
    }),
  };
  return tx;
}

const asTx = (t: FakeTx) => t as unknown as Prisma.TransactionClient;

describe('StockService.applyMovement', () => {
  it('actualiza saldo por armazém E o espelho global products.stock_qty', async () => {
    const tx = makeTx([[{ quantity: '10' }]]); // saldo actual = 10
    const balance = await StockService.applyMovement(asTx(tx), {
      productId: 'p1',
      warehouseId: 'w1',
      type: 'OUT',
      quantity: -3,
    });

    expect(balance).toBe(7);
    const execSql = tx.calls.filter((c) => c.kind === 'exec').map((c) => c.sql);
    // Deve actualizar stock_items, inserir movimento e actualizar products.
    expect(execSql.some((s) => /UPDATE stock_items/.test(s))).toBe(true);
    expect(execSql.some((s) => /INSERT INTO stock_movements/.test(s))).toBe(true);
    expect(execSql.some((s) => /UPDATE products SET stock_qty/.test(s))).toBe(true);
  });

  it('bloqueia saldo negativo por defeito', async () => {
    const tx = makeTx([[{ quantity: '2' }]]);
    await expect(
      StockService.applyMovement(asTx(tx), {
        productId: 'p1',
        warehouseId: 'w1',
        type: 'OUT',
        quantity: -5,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Não deve ter tocado no espelho global se rejeitou.
    expect(tx.calls.some((c) => /UPDATE products SET stock_qty/.test(c.sql))).toBe(false);
  });

  it('permite saldo negativo com allowNegative (factura nunca bloqueia)', async () => {
    const tx = makeTx([[{ quantity: '2' }]]);
    const balance = await StockService.applyMovement(asTx(tx), {
      productId: 'p1',
      warehouseId: 'w1',
      type: 'OUT',
      quantity: -5,
      allowNegative: true,
    });
    expect(balance).toBe(-3);
    expect(tx.calls.some((c) => /UPDATE products SET stock_qty/.test(c.sql))).toBe(true);
  });
});

describe('StockService.resolveDefaultWarehouse', () => {
  it('devolve o id do armazém quando existe', async () => {
    const tx = makeTx([[{ id: 'wh-default' }]]);
    const id = await StockService.resolveDefaultWarehouse(asTx(tx));
    expect(id).toBe('wh-default');
  });

  it('devolve null quando o tenant não tem armazéns (retrocompat)', async () => {
    const tx = makeTx([[]]);
    const id = await StockService.resolveDefaultWarehouse(asTx(tx));
    expect(id).toBeNull();
  });
});
