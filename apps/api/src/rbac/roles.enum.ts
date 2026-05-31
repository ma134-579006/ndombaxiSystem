/**
 * Hierarquia de Permissões (§3.2 do documento técnico NEXUS ERP).
 * O valor numérico é o "nível" — quanto MENOR, mais poder.
 */
export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN', // Nível 0 — dono da plataforma
  COMPANY_ADMIN = 'COMPANY_ADMIN', // Nível 1 — toda a empresa
  REGIONAL_MANAGER = 'REGIONAL_MANAGER', // Nível 2 — várias lojas
  STORE_MANAGER = 'STORE_MANAGER', // Nível 3 — 1 loja
  SHIFT_SUPERVISOR = 'SHIFT_SUPERVISOR', // Nível 4 — 1 loja / turno
  CASHIER = 'CASHIER', // Nível 5 — só o seu caixa
  ATTENDANT = 'ATTENDANT', // Nível 6 — só consulta (read-only)
}

/** Nível numérico de cada papel (0 = mais poder). */
export const ROLE_LEVEL: Record<Role, number> = {
  [Role.SUPER_ADMIN]: 0,
  [Role.COMPANY_ADMIN]: 1,
  [Role.REGIONAL_MANAGER]: 2,
  [Role.STORE_MANAGER]: 3,
  [Role.SHIFT_SUPERVISOR]: 4,
  [Role.CASHIER]: 5,
  [Role.ATTENDANT]: 6,
};

/** True se `role` tem nível igual ou superior (número igual ou menor) a `required`. */
export function roleHasAtLeast(role: Role, required: Role): boolean {
  return ROLE_LEVEL[role] <= ROLE_LEVEL[required];
}

/** Papéis que pertencem à plataforma (não a um tenant). */
export const PLATFORM_ROLES: readonly Role[] = [Role.SUPER_ADMIN];

export function isPlatformRole(role: Role): boolean {
  return PLATFORM_ROLES.includes(role);
}
