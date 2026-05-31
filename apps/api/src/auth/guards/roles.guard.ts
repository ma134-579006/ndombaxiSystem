import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtPayload } from '@nexus/types';
import { Role, roleHasAtLeast } from '../../rbac/roles.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * RBAC granular (§3.2 / §9.1). Verifica se o papel do utilizador tem nível
 * igual ou superior a pelo menos um dos papéis exigidos pelo endpoint.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as JwtPayload | undefined;
    if (!user) throw new ForbiddenException('Authentication required');

    const userRole = user.role as Role;
    const allowed = required.some((r) => roleHasAtLeast(userRole, r));
    if (!allowed) {
      throw new ForbiddenException('Insufficient permissions for this action');
    }
    return true;
  }
}
