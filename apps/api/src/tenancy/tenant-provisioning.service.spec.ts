import { splitSqlStatements } from './tenant-provisioning.service';

describe('splitSqlStatements', () => {
  it('divide statements simples e ignora comentários', () => {
    const sql = [
      '-- comentário inteiro',
      'CREATE TABLE IF NOT EXISTS "t"."a" (id INT); -- comentário no fim',
      'ALTER TABLE "t"."a" ADD COLUMN IF NOT EXISTS x TEXT;',
      '',
    ].join('\n');
    const out = splitSqlStatements(sql, 'teste.sql');
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('CREATE TABLE');
    expect(out[1]).toContain('ADD COLUMN');
  });

  it('suporta statements multi-linha (ex.: regra com WHERE)', () => {
    const sql = [
      'CREATE OR REPLACE RULE r AS ON UPDATE TO "t"."invoices"',
      '  WHERE NEW.hash IS DISTINCT FROM OLD.hash',
      '  DO INSTEAD NOTHING;',
    ].join('\n');
    const out = splitSqlStatements(sql, 'teste.sql');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('DO INSTEAD NOTHING');
  });

  it("rejeita blocos '$$' (o parser parti-los-ia silenciosamente)", () => {
    const sql = 'CREATE FUNCTION f() RETURNS void AS $$ BEGIN NULL; END $$ LANGUAGE plpgsql;';
    expect(() => splitSqlStatements(sql, 'perigoso.sql')).toThrow(/\$\$/);
  });
});

describe('ensureSchemaIfOutdated (arranque rápido)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TenantProvisioningService } = require('./tenant-provisioning.service');

  function fake(stored: string | null, failEverything = false) {
    const executed: { sql: string; args: unknown[] }[] = [];
    const prisma = {
      $queryRawUnsafe: jest.fn(async (sql: string) => {
        if (sql.includes('to_regclass')) return [{ r: stored ? 'x' : null }];
        if (sql.includes('SELECT hash')) return [{ hash: stored }];
        return []; // FKs sem índice: nenhuma
      }),
      $executeRawUnsafe: jest.fn(async (sql: string, ...args: unknown[]) => {
        executed.push({ sql, args });
        if (failEverything && !sql.includes('_schema_version')) throw new Error('falhou');
      }),
    };
    return { svc: new TenantProvisioningService(prisma as never), prisma, executed };
  }

  it('não toca na base quando o esquema já está em dia', async () => {
    const { svc, executed } = fake(null);
    const hash = (svc as unknown as { currentSchemaHash(): string }).currentSchemaHash();
    const { svc: svc2, executed: ex2 } = fake(hash);
    expect(await svc2.ensureSchemaIfOutdated('tenant_abcd1234')).toBe(false);
    expect(ex2).toHaveLength(0);
    expect(executed).toHaveLength(0);
  });

  it('aplica tudo e regista a versão quando mudou (ou nunca foi registada)', async () => {
    const { svc, executed } = fake(null);
    expect(await svc.ensureSchemaIfOutdated('tenant_abcd1234')).toBe(true);
    expect(executed.length).toBeGreaterThan(300); // template + migrações
    const hash = (svc as unknown as { currentSchemaHash(): string }).currentSchemaHash();
    expect(executed.some((e) => e.sql.includes('INSERT INTO "tenant_abcd1234"."_schema_version"') && e.args[0] === hash)).toBe(true);
  });

  it('com instruções a falhar NÃO regista a versão (o próximo arranque tenta de novo)', async () => {
    const { svc, executed } = fake(null, true);
    await svc.ensureSchemaIfOutdated('tenant_abcd1234');
    expect(executed.some((e) => e.sql.includes('INSERT INTO "tenant_abcd1234"."_schema_version"'))).toBe(false);
  });
});
