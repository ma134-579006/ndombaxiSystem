import { assertValidSchemaName } from './prisma.service';

describe('assertValidSchemaName', () => {
  it('accepts the public schema', () => {
    expect(() => assertValidSchemaName('nexus_public')).not.toThrow();
  });

  it('accepts a well-formed tenant schema', () => {
    expect(() => assertValidSchemaName('tenant_a1b2c3d4')).not.toThrow();
  });

  it.each([
    'public',
    'tenant_',
    'tenant_ABC',
    'tenant_a1; DROP TABLE users;--',
    'tenant_aa', // demasiado curto (< 8)
    '"tenant_a1b2c3d4"',
  ])('rejects invalid schema name: %s', (name) => {
    expect(() => assertValidSchemaName(name)).toThrow();
  });
});
