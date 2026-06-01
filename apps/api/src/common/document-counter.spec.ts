import type { Prisma } from '@prisma/client';
import { allocateDocumentNumber, formatCounterNumber } from './document-counter';

/**
 * Testa a numeração atómica sem BD: um tx falso que simula o UPSERT
 * (ON CONFLICT DO UPDATE ... RETURNING) mantendo um contador em memória por
 * (kind, year). Garante que chamadas sequenciais devolvem 1,2,3… e que o
 * formato é "KIND/ANO/0001".
 */
function makeCountingTx() {
  const store = new Map<string, number>();
  return {
    $queryRaw: jest.fn(async (..._args: unknown[]) => {
      // O fake não lê o SQL; assume a semântica do UPSERT do contador.
      // A chave real vem nos parâmetros do template; aqui usamos uma única
      // chave por instância de tx para o teste sequencial.
      const key = 'k';
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return [{ last_sequence: next }];
    }),
  } as unknown as Prisma.TransactionClient;
}

describe('allocateDocumentNumber', () => {
  it('incrementa sequencialmente 1,2,3', async () => {
    const tx = makeCountingTx();
    expect(await allocateDocumentNumber(tx, 'PO', 2026)).toBe(1);
    expect(await allocateDocumentNumber(tx, 'PO', 2026)).toBe(2);
    expect(await allocateDocumentNumber(tx, 'PO', 2026)).toBe(3);
  });
});

describe('formatCounterNumber', () => {
  it('formata com padding a 4 dígitos', () => {
    expect(formatCounterNumber('PO', 2026, 1)).toBe('PO/2026/0001');
    expect(formatCounterNumber('WEB', 2026, 42)).toBe('WEB/2026/0042');
    expect(formatCounterNumber('WEB', 2026, 12345)).toBe('WEB/2026/12345');
  });
});
