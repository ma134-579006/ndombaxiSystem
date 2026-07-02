import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, assertValidSchemaName } from '../prisma/prisma.service';
import type { RoleName } from '@nexus/types';

export interface TenantUser {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: RoleName;
  pin_hash: string | null;
  store_id: string | null;
  store_name: string | null;
  two_fa_secret: string | null;
  two_fa_enabled: boolean;
  is_active: boolean;
  failed_logins: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  must_reset_pw: boolean;
}

export interface CreateTenantUserInput {
  email: string;
  passwordHash: string;
  name: string;
  role: RoleName;
  storeId?: string | null;
  mustResetPw?: boolean;
}

/**
 * Acesso aos dados que vivem no schema do tenant (users, stores).
 * Tudo passa por prisma.runInTenant → search_path fixado ao tenant (§3.1).
 */
@Injectable()
export class TenantUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sonda em LOTE: devolve os schemas onde o e-mail existe como utilizador
   * ATIVO — numa ÚNICA query UNION ALL (tabelas totalmente qualificadas, sem
   * search_path nem transacção). Substitui o N+1 do login que abria uma
   * transacção por empresa (segundos por login com dezenas de tenants).
   * Quem chama deve manter um fallback por-schema (emailExists) para tolerar
   * deriva de schema — se UMA tabela estiver em falta, a query inteira falha.
   */
  async schemasWithEmail(schemas: string[], email: string): Promise<Set<string>> {
    if (schemas.length === 0) return new Set();
    for (const s of schemas) assertValidSchemaName(s);
    const parts = schemas.map((s) =>
      Prisma.sql`SELECT ${s}::text AS schema_name
                 WHERE EXISTS (SELECT 1 FROM ${Prisma.raw(`"${s}"`)}.users u
                               WHERE u.email = ${email} AND u.is_active = TRUE)`,
    );
    const rows = await this.prisma.$queryRaw<{ schema_name: string }[]>(
      Prisma.join(parts, ' UNION ALL '),
    );
    return new Set(rows.map((r) => r.schema_name));
  }

  /** Sonda LEVE: o e-mail existe (ativo) neste tenant? Colunas explícitas —
   *  a forma do resultado é estável entre schemas (evita o erro 0A000
   *  "cached plan must not change result type" ao percorrer tenants). */
  async emailExists(schema: string, email: string): Promise<boolean> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM users WHERE email = ${email} AND is_active = TRUE LIMIT 1`,
      ),
    );
    return rows.length > 0;
  }

  async findByEmail(schema: string, email: string): Promise<TenantUser | null> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<TenantUser[]>(
        Prisma.sql`SELECT * FROM users WHERE email = ${email} LIMIT 1`,
      );
      return rows[0] ?? null;
    });
  }

  /** Operadores (funcionários com acesso por PIN) para o ecrã da caixa. */
  async listOperators(
    schema: string,
  ): Promise<{ id: string; name: string; role: RoleName; store_id: string | null; store_name: string | null; photo_url: string | null }[]> {
    return this.prisma.runInTenant(schema, async (tx) => {
      // Foto: liga ao registo de RH (employees) pelo nome normalizado (sem FK).
      return tx.$queryRaw<{ id: string; name: string; role: RoleName; store_id: string | null; store_name: string | null; photo_url: string | null }[]>(
        Prisma.sql`SELECT u.id, u.name, u.role, u.store_id, s.name AS store_name,
                          COALESCE(u.photo_url, e.photo_url) AS photo_url
                   FROM users u
                   LEFT JOIN stores s ON s.id = u.store_id
                   LEFT JOIN employees e ON lower(btrim(e.full_name)) = lower(btrim(u.name))
                   WHERE u.is_active = TRUE AND u.pin_hash IS NOT NULL
                   ORDER BY s.name NULLS FIRST, u.name`,
      );
    });
  }

  async findById(schema: string, id: string): Promise<TenantUser | null> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<TenantUser[]>(
        Prisma.sql`SELECT u.*, s.name AS store_name
                   FROM users u
                   LEFT JOIN stores s ON s.id = u.store_id
                   WHERE u.id = ${id}::uuid LIMIT 1`,
      );
      return rows[0] ?? null;
    });
  }

  async createStore(
    schema: string,
    input: { code: string; name: string; isDefault?: boolean },
  ): Promise<{ id: string }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO stores (code, name, is_default)
                   VALUES (${input.code}, ${input.name}, ${input.isDefault ?? false})
                   RETURNING id`,
      );
      return rows[0];
    });
  }

  /** Armazém inicial do tenant (default) — para o livro de stock ter lógica. */
  async createWarehouse(
    schema: string,
    input: { code: string; name: string; isDefault?: boolean },
  ): Promise<{ id: string }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO warehouses (code, name, is_default)
                   VALUES (${input.code}, ${input.name}, ${input.isDefault ?? false})
                   RETURNING id`,
      );
      return rows[0];
    });
  }

  async createUser(
    schema: string,
    input: CreateTenantUserInput,
  ): Promise<{ id: string }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO users (email, password_hash, name, role, store_id, must_reset_pw)
                   VALUES (${input.email}, ${input.passwordHash}, ${input.name},
                           ${input.role}, ${input.storeId ?? null}::uuid, ${input.mustResetPw ?? true})
                   RETURNING id`,
      );
      return rows[0];
    });
  }

  /** Regista login bem-sucedido: zera tentativas falhadas e marca timestamp. */
  async markLoginSuccess(schema: string, id: string): Promise<void> {
    await this.prisma.runInTenant(schema, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`UPDATE users
                   SET failed_logins = 0, locked_until = NULL, last_login_at = now()
                   WHERE id = ${id}::uuid`,
      );
    });
  }

  /**
   * Regista tentativa falhada e aplica bloqueio TEMPORÁRIO progressivo:
   * a partir da 4.ª falha bloqueia 30s e DUPLICA a cada falha seguinte
   * (30s → 1m → 2m → 4m …), com tecto de 30 minutos. O gestor pode
   * desbloquear de imediato (clearLockout) sem esperar o tempo.
   * Devolve o instante de desbloqueio (ou null se ainda não bloqueou).
   */
  async markLoginFailure(schema: string, id: string): Promise<Date | null> {
    return this.prisma.runInTenant(schema, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`UPDATE users SET failed_logins = failed_logins + 1 WHERE id = ${id}::uuid`,
      );
      const rows = await tx.$queryRaw<{ failed_logins: number }[]>(
        Prisma.sql`SELECT failed_logins FROM users WHERE id = ${id}::uuid`,
      );
      const fails = rows[0]?.failed_logins ?? 0;
      if (fails < 4) return null; // só bloqueia a partir da 4.ª tentativa
      const lockMs = Math.min(30_000 * 2 ** (fails - 4), 30 * 60 * 1000);
      const until = new Date(Date.now() + lockMs);
      await tx.$executeRaw(
        Prisma.sql`UPDATE users SET locked_until = ${until} WHERE id = ${id}::uuid`,
      );
      return until;
    });
  }

  /** Desbloqueio imediato pelo gestor: limpa o bloqueio temporário e o contador. */
  async clearLockout(schema: string, id: string): Promise<void> {
    await this.prisma.runInTenant(schema, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`UPDATE users SET failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = ${id}::uuid`,
      );
    });
  }

  /** Preferência de tema do utilizador (vazio = padrão). */
  async getTheme(schema: string, id: string): Promise<string> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ theme: string }[]>(
        Prisma.sql`SELECT COALESCE(theme, '') AS theme FROM users WHERE id = ${id}::uuid LIMIT 1`,
      );
      return rows[0]?.theme ?? '';
    });
  }

  async setTheme(schema: string, id: string, theme: string): Promise<void> {
    await this.prisma.runInTenant(schema, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`UPDATE users SET theme = ${theme} WHERE id = ${id}::uuid`,
      );
    });
  }

  /** Define a senha (recuperação por e-mail). Desbloqueia o utilizador. */
  async setPasswordHash(schema: string, id: string, passwordHash: string): Promise<void> {
    await this.prisma.runInTenant(schema, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`UPDATE users SET password_hash = ${passwordHash}, must_reset_pw = FALSE,
                   failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = ${id}::uuid`,
      );
    });
  }

  /** Define o PIN da caixa (recuperação por e-mail). */
  async setPinHash(schema: string, id: string, pinHash: string): Promise<void> {
    await this.prisma.runInTenant(schema, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`UPDATE users SET pin_hash = ${pinHash}, updated_at = now() WHERE id = ${id}::uuid`,
      );
    });
  }

  async setTwoFaSecret(
    schema: string,
    id: string,
    secret: string,
    enabled: boolean,
  ): Promise<void> {
    await this.prisma.runInTenant(schema, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`UPDATE users SET two_fa_secret = ${secret}, two_fa_enabled = ${enabled} WHERE id = ${id}::uuid`,
      );
    });
  }
}
