import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role, ROLE_LEVEL } from '../rbac/roles.enum';

/** Papéis que podem ser atribuídos a um funcionário de uma empresa (nunca SUPER_ADMIN). */
export const TENANT_ASSIGNABLE_ROLES: readonly Role[] = [
  Role.COMPANY_ADMIN,
  Role.REGIONAL_MANAGER,
  Role.STORE_MANAGER,
  Role.SHIFT_SUPERVISOR,
  Role.CASHIER,
  Role.ATTENDANT,
];

export function isAssignableTenantRole(role: string): role is Role {
  return (TENANT_ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

/**
 * Valida que `actorRole` pode atribuir o papel `target` a um funcionário:
 *   • `target` tem de ser um papel de empresa (nunca SUPER_ADMIN / papel da plataforma);
 *   • o actor NÃO pode atribuir um papel com mais poder do que o seu próprio
 *     (não há escalada de privilégios). Devolve o papel já validado.
 */
export function assertAssignableRole(actorRole: Role, target: string): Role {
  if (!isAssignableTenantRole(target)) {
    throw new BadRequestException(`Papel inválido para um funcionário: ${target}`);
  }
  if (ROLE_LEVEL[target] < ROLE_LEVEL[actorRole]) {
    throw new ForbiddenException('Não pode atribuir um papel com mais poder do que o seu.');
  }
  return target;
}
