import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '@nexus/types';

/** Injecta o utilizador autenticado (payload do JWT) no handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as JwtPayload;
  },
);
