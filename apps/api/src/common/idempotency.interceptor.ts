import { AsyncResource } from 'node:async_hooks';
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { from, Observable, of } from 'rxjs';
import { catchError, mergeMap, switchMap } from 'rxjs/operators';
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

    // O resto do pedido (controlador) tem de correr no contexto ASSÍNCRONO deste
    // pedido: depois do `await` da consulta, o callback corre no contexto do
    // Prisma e o TenantContext (AsyncLocalStorage) perdia-se — TODAS as escritas
    // com X-Client-Op-Id (fila offline das apps) davam 500 "No tenant in current
    // request context" e nunca subiam. `bind` captura o contexto já aqui.
    const handle = AsyncResource.bind(() => next.handle());
    const url = req.originalUrl ?? req.url;
    return from(this.reserve(schema, opId, auth, method, url)).pipe(
      switchMap((r) => {
        if (r.kind === 'done') {
          res.status(r.status);
          return of(r.body);
        }
        if (r.kind === 'busy') {
          // A MESMA operação ainda está a correr (o cliente desistiu de esperar e
          // reenviou da fila). 503 → o cliente volta a tentar mais tarde e recebe a
          // resposta guardada; nunca se executa duas vezes.
          throw new ServiceUnavailableException('Esta operação ainda está a ser processada. Tente daqui a pouco.');
        }
        return handle().pipe(
          mergeMap(async (body) => {
            await this.record(schema, opId, auth, method, url, res.statusCode, body);
            return body;
          }),
          catchError(async (e: unknown) => {
            // Falhou: liberta a reserva para um reenvio poder executar de novo.
            await this.release(schema, opId);
            throw e;
          }),
        );
      }),
    );
  }

  /**
   * RESERVA a operação ANTES de a executar. Antes, só se gravava no fim: um
   * reenvio que chegasse enquanto a 1.ª ainda corria (ex.: pagamento lento,
   * cliente com limite de 8 s) não encontrava nada e o pagamento era registado
   * duas vezes. Uma reserva "pendente" com mais de 2 min (processo caído) é retomada.
   */
  private async reserve(
    schema: string, opId: string, auth: JwtPayload | undefined, method: string, url: string,
  ): Promise<{ kind: 'run' } | { kind: 'busy' } | { kind: 'done'; status: number; body: unknown }> {
    try {
      return await this.prisma.runInTenant(schema, async (tx) => {
        const ins = await tx.$queryRaw<{ op_id: string }[]>(
          Prisma.sql`INSERT INTO sync_operations (op_id, entity, op, local_id, status, user_id)
                     VALUES (${opId}::uuid, 'http', ${method}, ${url.slice(0, 200)}, 'pending', ${auth?.sub ?? null}::uuid)
                     ON CONFLICT (op_id) DO NOTHING RETURNING op_id`,
        );
        if (ins.length) return { kind: 'run' as const };
        const rows = await tx.$queryRaw<{ status: string; result: { status?: number; body?: unknown } | null; stale: boolean }[]>(
          Prisma.sql`SELECT status, result, created_at < now() - interval '2 minutes' AS stale
                     FROM sync_operations WHERE op_id = ${opId}::uuid AND entity = 'http' FOR UPDATE`,
        );
        const r = rows[0];
        if (!r) return { kind: 'run' as const }; // op_id de outro tipo (vendas/sync) — segue como antes
        if (r.result) return { kind: 'done' as const, status: r.result.status ?? 200, body: r.result.body ?? null };
        if (r.status === 'pending' && !r.stale) return { kind: 'busy' as const };
        await tx.$executeRaw(Prisma.sql`UPDATE sync_operations SET created_at = now() WHERE op_id = ${opId}::uuid`);
        return { kind: 'run' as const };
      });
    } catch {
      // Tabela ausente/BD com problema: comportamento antigo (consulta simples).
      const hit = await this.lookup(schema, opId);
      return hit ? { kind: 'done', status: hit.status, body: hit.body } : { kind: 'run' };
    }
  }

  private async release(schema: string, opId: string): Promise<void> {
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`DELETE FROM sync_operations WHERE op_id = ${opId}::uuid AND entity = 'http' AND status = 'pending'`),
    ).catch(() => undefined);
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
                     ON CONFLICT (op_id) DO UPDATE SET status = 'applied', result = EXCLUDED.result
                     WHERE sync_operations.entity = 'http' AND sync_operations.status = 'pending'`,
        ),
      );
    } catch (e) {
      this.logger.warn(`idempotência não gravada (${opId}): ${(e as Error).message}`);
    }
  }
}
