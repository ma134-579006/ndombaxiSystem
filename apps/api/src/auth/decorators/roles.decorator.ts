import { SetMetadata } from '@nestjs/common';
import { Role } from '../../rbac/roles.enum';

export const ROLES_KEY = 'roles';

/**
 * Restringe um endpoint aos papéis indicados (ou superiores em hierarquia).
 * Ex: @Roles(Role.STORE_MANAGER) permite STORE_MANAGER e acima.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
