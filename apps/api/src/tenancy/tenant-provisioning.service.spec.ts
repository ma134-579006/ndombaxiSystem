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
