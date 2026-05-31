import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import type { JwtPayload } from '@nexus/types';
import { TenantContext } from './tenant-context';

/**
 * Corre cada pedido dentro de um AsyncLocalStorage com o utilizador
 * autenticado (definido pelo JwtStrategy em request.user) e o IP.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly context: TenantContext) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const auth = (req.user as JwtPayload | undefined) ?? null;
    const ip = req.ip ?? req.socket?.remoteAddress;
    return this.context.run({ auth, ip }, () => next.handle());
  }
}
