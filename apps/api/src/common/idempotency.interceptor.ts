import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { from, Observable, of } from 'rxjs';
import { mergeMap, switchMap } from 'rxjs/operators';
import type { JwtPayload } from '@nexus/types';
import { PrismaService } from '../prisma/prisma.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * IDEMPOTÊNCIA GENÉRICA para escritas feitas SEM REDE nas apps instaladas.
 *
 * Uma app offline guarda cada alteração numa fila e reenvia-a quando a rede volta,
 * com `X-Client-Op-Id` (UUID gerado no aparelho). Se a primeira tentativa chegou ao
 * servidor mas a RESPOSTA se perdeu, o reenvio devolve a resposta GUARDADA em vez de
 * executar outra vez — por isso nunca nasce um documento, movimento ou registo em
 * duplicado (nem um salto na numeração fiscal). Reutiliza o livro `sync_operations`
 * (op_id é chave primária). Pedidos sem o cabeçalho passam sem qualquer alteração.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);
  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const method = req.method.toUpperCase();
    const raw = req.headers['x-client-op-id'];
    const opId = Array.isArray(raw) ? raw[0] : raw;
    if (!opId || method === 'GET' || method === 'HEAD' || !UUID.test(opId)) return next.handle();
    const auth = req.user as JwtPayload | undefined;
    const schema = auth?.tenantSchema;
    if (!schema) return next.handle();

    return from(this.lookup(schema, opId)).pipe(
      switchMap((hit) => {
        if (hit) {
          res.status(hit.status);
          return of(hit.body);
        }
        return next.handle().pipe(
          mergeMap(async (body) => {
            await this.record(schema, opId, auth, method, req.originalUrl ?? req.url, res.statusCode, body);
            return body;
          }),
        );
      }),
    );
  }

  private lookup(schema: string, opId: string): Promise<{ status: number; body: unknown } | null> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ result: { status?: number; body?: unknown } | null }[]>(
        Prisma.sql`SELECT result FROM sync_operations WHERE op_id = ${opId}::uuid AND entity = 'http'`,
      );
      const r = rows[0]?.result;
      return r ? { status: r.status ?? 200, body: r.body ?? null } : null;
    }).catch(() => null);
  }

  private async record(schema: string, opId: string, auth: JwtPayload | undefined, method: string, url: string, status: number, body: unknown): Promise<void> {
    try {
      const safe = body === undefined || (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) || typeof body === 'string' || typeof body === 'number' || typeof body === 'boolean' ? body ?? null : null;
      await this.prisma.runInTenant(schema, (tx) =>
        tx.$executeRaw(
          Prisma.sql`INSERT INTO sync_operations (op_id, entity, op, local_id, status, result, user_id)
                     VALUES (${opId}::uuid, 'http', ${method}, ${url.slice(0, 200)}, 'applied',
                             ${JSON.stringify({ status, body: safe })}::jsonb, ${auth?.sub ?? null}::uuid)
                     ON CONFLICT (op_id) DO NOTHING`,
        ),
      );
    } catch (e) {
      this.logger.warn(`idempotência não gravada (${opId}): ${(e as Error).message}`);
    }
  }
}
