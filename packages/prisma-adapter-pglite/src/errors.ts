/**
 * Tradução dos erros do PGlite para a linguagem do Prisma.
 *
 * Não é cosmética. É daqui que sai o `P2002` quando um índice único recusa uma
 * gravação — e o índice único PARCIAL é exactamente a barreira que impede a
 * MESMA fatura ser emitida duas vezes quando a rede cai a meio (ver
 * `clientOpId`). Se o erro chegasse ao Prisma como "erro genérico", o código que
 * apanha a duplicação deixava de a reconhecer e a segunda fatura passava. Por
 * isso os códigos são traduzidos um a um, como no adapter oficial.
 *
 * O PGlite atira `DatabaseError` com os mesmos campos do node-postgres
 * (`code`, `severity`, `detail`, `column`, `hint`) — a tradução é a mesma.
 */
import type { Error as PrismaDriverError } from '@prisma/driver-adapter-utils';

type PgLikeError = {
  code?: string;
  message: string;
  severity?: string;
  detail?: string;
  column?: string;
  constraint?: string;
  hint?: string;
};

function isPgLikeError(e: unknown): e is PgLikeError {
  const err = e as PgLikeError | null;
  return (
    !!err &&
    typeof err.message === 'string' &&
    typeof err.code === 'string' &&
    typeof err.severity === 'string'
  );
}

/** Campos citados pelo PostgreSQL em `Key (a, b)=(...)`. */
function fieldsOf(detail?: string): string[] | undefined {
  return detail?.match(/Key \(([^)]+)\)/)?.at(1)?.split(', ');
}

export function convertDriverError(error: unknown): PrismaDriverError {
  if (!isPgLikeError(error)) throw error;

  const mapped = mapCode(error);
  return { originalCode: error.code, originalMessage: error.message, ...mapped };
}

function mapCode(error: PgLikeError): PrismaDriverError {
  switch (error.code) {
    case '22001':
      return { kind: 'LengthMismatch', column: error.column };
    case '22003':
      return { kind: 'ValueOutOfRange', cause: error.message };
    case '22P02':
      return { kind: 'InvalidInputValue', message: error.message };
    case '23505': {
      const fields = fieldsOf(error.detail);
      return {
        kind: 'UniqueConstraintViolation',
        constraint: fields ? { fields } : error.constraint ? { index: error.constraint } : undefined,
      };
    }
    case '23502': {
      const fields = fieldsOf(error.detail);
      return { kind: 'NullConstraintViolation', constraint: fields ? { fields } : undefined };
    }
    case '23503': {
      const constraint = error.column
        ? { fields: [error.column] }
        : error.constraint
          ? { index: error.constraint }
          : undefined;
      return { kind: 'ForeignKeyConstraintViolation', constraint };
    }
    case '3D000':
      return { kind: 'DatabaseDoesNotExist', db: error.message.split(' ').at(1)?.split('"').at(1) };
    case '40001':
      return { kind: 'TransactionWriteConflict' };
    case '42P01':
      return { kind: 'TableDoesNotExist', table: error.message.split(' ').at(1)?.split('"').at(1) };
    case '42703': {
      const raw = error.message.match(/^column (.+) does not exist$/)?.at(1);
      return {
        kind: 'ColumnNotFound',
        column: raw?.replace(/"((?:""|[^"])*)"/g, (_, id: string) => id.replaceAll('""', '"')),
      };
    }
    case '42P04':
      return { kind: 'DatabaseAlreadyExists', db: error.message.split(' ').at(1)?.split('"').at(1) };
    case '53300':
      return { kind: 'TooManyConnections', cause: error.message };
    case '25P02':
      // "current transaction is aborted" — no telemóvel isto acontece quando um
      // comando falhou dentro de uma transação e a aplicação continuou a
      // gravar. Dizê-lo pelo nome poupa horas a quem for ler o registo.
      return { kind: 'TransactionAlreadyClosed', cause: error.message };
    default:
      return {
        kind: 'postgres',
        code: error.code ?? 'N/A',
        severity: error.severity ?? 'N/A',
        message: error.message,
        detail: error.detail,
        column: error.column,
        hint: error.hint,
      };
  }
}
