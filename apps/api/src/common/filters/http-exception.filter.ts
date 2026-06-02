import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import type { ApiError } from '@nexus/types';

/**
 * Filtro global de excepções.
 * Regra #6 (Prompt Mestre): erros retornam sempre
 * { statusCode, message, error, timestamp }.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'InternalServerError';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const body = res as Record<string, unknown>;
        message = (body.message as string | string[]) ?? exception.message;
        error = (body.error as string) ?? exception.name;
      }
    } else if (isDatabaseError(exception)) {
      // Erros da base de dados → mensagem amigável. NUNCA devolver a mensagem
      // crua do Prisma ao cliente (contém dados da linha / detalhes internos).
      statusCode = HttpStatus.BAD_REQUEST;
      error = 'DatabaseError';
      message = mapDatabaseError(pgErrorCode(exception));
      this.logger.error(
        `DB error (${pgErrorCode(exception) ?? '?'}) on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else if (exception instanceof Error) {
      // Não vazar mensagens internas (stack, paths, SQL) ao cliente.
      message = 'Ocorreu um erro interno. Tente novamente.';
      error = 'InternalServerError';
    }

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${statusCode}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const payload: ApiError = {
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(statusCode).json(payload);
  }
}

/** Deteta erros do Prisma/PostgreSQL (duck-typing, sem acoplar ao @prisma/client). */
function isDatabaseError(e: unknown): boolean {
  const x = e as { clientVersion?: string; name?: string; code?: unknown };
  if (!x) return false;
  if (typeof x.clientVersion === 'string') return true; // PrismaClient*Error
  if (typeof x.name === 'string' && x.name.startsWith('PrismaClient')) return true;
  const msg = (e as Error)?.message ?? '';
  return /prisma\.\$queryRaw|prisma\.\$executeRaw|Raw query failed/i.test(msg);
}

/** Extrai o código de erro do PostgreSQL (ex.: 23502, 23505). */
function pgErrorCode(e: unknown): string | null {
  const meta = (e as { meta?: { code?: string } }).meta;
  if (meta?.code) return String(meta.code);
  const m = (e as Error)?.message?.match(/Code:\s*`?(\d+[A-Z0-9]*)`?/i);
  return m ? m[1] : null;
}

/** Traduz o código PostgreSQL numa mensagem segura e amigável. */
function mapDatabaseError(code: string | null): string {
  switch (code) {
    case '23502': return 'Faltam campos obrigatórios.';
    case '23505': return 'Já existe um registo com esses dados (duplicado).';
    case '23503': return 'Operação inválida: existe um registo relacionado dependente.';
    case '23514': return 'Há um valor fora do permitido.';
    case '22P02': return 'Formato de dados inválido.';
    case '22001': return 'Um dos textos é demasiado longo.';
    case '40001':
    case '40P01': return 'Conflito ao gravar (tente novamente).';
    default: return 'Não foi possível concluir a operação na base de dados.';
  }
}
