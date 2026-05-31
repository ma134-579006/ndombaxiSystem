import { Role, ROLE_LEVEL, roleHasAtLeast, isPlatformRole } from './roles.enum';

describe('RBAC roles', () => {
  it('Super Admin has the most power (level 0)', () => {
    expect(ROLE_LEVEL[Role.SUPER_ADMIN]).toBe(0);
  });

  it('higher role satisfies a lower required role', () => {
    expect(roleHasAtLeast(Role.COMPANY_ADMIN, Role.STORE_MANAGER)).toBe(true);
    expect(roleHasAtLeast(Role.STORE_MANAGER, Role.CASHIER)).toBe(true);
  });

  it('lower role does NOT satisfy a higher required role', () => {
    expect(roleHasAtLeast(Role.CASHIER, Role.STORE_MANAGER)).toBe(false);
    expect(roleHasAtLeast(Role.ATTENDANT, Role.SUPER_ADMIN)).toBe(false);
  });

  it('equal role satisfies the requirement', () => {
    expect(roleHasAtLeast(Role.STORE_MANAGER, Role.STORE_MANAGER)).toBe(true);
  });

  it('only SUPER_ADMIN is a platform role', () => {
    expect(isPlatformRole(Role.SUPER_ADMIN)).toBe(true);
    expect(isPlatformRole(Role.COMPANY_ADMIN)).toBe(false);
  });
});
