import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '../rbac/roles.enum';
import { TENANT_ASSIGNABLE_ROLES, assertAssignableRole, isAssignableTenantRole } from './staff.roles';

describe('staff.roles', () => {
  it('os papéis atribuíveis não incluem SUPER_ADMIN', () => {
    expect(TENANT_ASSIGNABLE_ROLES).not.toContain(Role.SUPER_ADMIN);
    expect(TENANT_ASSIGNABLE_ROLES).toContain(Role.COMPANY_ADMIN);
    expect(TENANT_ASSIGNABLE_ROLES).toContain(Role.ATTENDANT);
  });

  it('isAssignableTenantRole valida papéis de empresa', () => {
    expect(isAssignableTenantRole('CASHIER')).toBe(true);
    expect(isAssignableTenantRole('SUPER_ADMIN')).toBe(false);
    expect(isAssignableTenantRole('NAO_EXISTE')).toBe(false);
  });

  it('COMPANY_ADMIN pode atribuir qualquer papel de empresa', () => {
    expect(assertAssignableRole(Role.COMPANY_ADMIN, Role.CASHIER)).toBe(Role.CASHIER);
    expect(assertAssignableRole(Role.COMPANY_ADMIN, Role.COMPANY_ADMIN)).toBe(Role.COMPANY_ADMIN);
  });

  it('rejeita atribuir SUPER_ADMIN (BadRequest)', () => {
    expect(() => assertAssignableRole(Role.COMPANY_ADMIN, 'SUPER_ADMIN')).toThrow(BadRequestException);
  });

  it('impede escalada de privilégios (Forbidden)', () => {
    // STORE_MANAGER (nível 3) não pode criar um COMPANY_ADMIN (nível 1)
    expect(() => assertAssignableRole(Role.STORE_MANAGER, Role.COMPANY_ADMIN)).toThrow(
      ForbiddenException,
    );
    // mas pode criar papéis de nível igual ou inferior
    expect(assertAssignableRole(Role.STORE_MANAGER, Role.CASHIER)).toBe(Role.CASHIER);
    expect(assertAssignableRole(Role.STORE_MANAGER, Role.STORE_MANAGER)).toBe(Role.STORE_MANAGER);
  });

  it('rejeita papel desconhecido (BadRequest)', () => {
    expect(() => assertAssignableRole(Role.COMPANY_ADMIN, 'XPTO')).toThrow(BadRequestException);
  });
});
