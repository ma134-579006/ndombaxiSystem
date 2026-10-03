import { Prisma } from '@prisma/client';
import { localSeries } from './device-series';

/** No servidor local de um posto, o contador é do posto ("RC-LX4K"): nunca colide com a nuvem. */
function kindOf(kind: string): string {
  const s = localSeries();
  return s ? `${kind}-${s}` : kind;
}

/**
 * Alocação ATÓMICA de números sequenciais para documentos NÃO fiscais
 * (encomendas de compra, encomendas web). Substitui o padrão frágil
 * `COUNT(*)+1`, que sob concorrência gera o mesmo número para dois pedidos
 * simultâneos (e falha contra a constraint UNIQUE).
 *
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` incrementa e devolve a
 * sequência numa só operação atómica — a linha (kind, year) é bloqueada pelo
 * próprio UPSERT, por isso dois pedidos concorrentes recebem números distintos.
 *
 * NOTA: as facturas FISCAIS NÃO usam isto — têm a sua própria série com cadeia
 * de hash (fiscal_series ... FOR UPDATE), por exigência da AGT (§7).
 */
export async function allocateDocumentNumber(
  tx: Prisma.TransactionClient,
  kind: string,
  year: number,
): Promise<number> {
  const rows = await tx.$queryRaw<{ last_sequence: number }[]>(
    Prisma.sql`INSERT INTO document_counters (kind, year, last_sequence)
               VALUES (${kindOf(kind)}, ${year}, 1)
               ON CONFLICT (kind, year)
               DO UPDATE SET last_sequence = document_counters.last_sequence + 1
               RETURNING last_sequence`,
  );
  return rows[0].last_sequence;
}

/** Formata "KIND/ANO/0001" (sequência preenchida a >= 4 dígitos). */
export function formatCounterNumber(kind: string, year: number, sequence: number): string {
  return `${kindOf(kind)}/${year}/${String(sequence).padStart(4, '0')}`;
}
