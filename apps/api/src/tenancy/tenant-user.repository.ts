import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
                          e.photo_url
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
   * Regista tentativa falhada e aplica bloqueio progressivo (§9.1):
   * 5 falhas → 15min, depois 1h, depois permanente.
   */
  async markLoginFailure(schema: string, id: string): Promise<void> {
    await this.prisma.runInTenant(schema, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`UPDATE users SET failed_logins = failed_logins + 1 WHERE id = ${id}::uuid`,
      );
      const rows = await tx.$queryRaw<{ failed_logins: number }[]>(
        Prisma.sql`SELECT failed_logins FROM users WHERE id = ${id}::uuid`,
      );
      const fails = rows[0]?.failed_logins ?? 0;
      let lockMs: number | null = null;
      if (fails >= 10) lockMs = 100 * 365 * 24 * 60 * 60 * 1000; // ~permanente
      else if (fails >= 7) lockMs = 60 * 60 * 1000; // 1h
      else if (fails >= 5) lockMs = 15 * 60 * 1000; // 15min
      if (lockMs !== null) {
        const until = new Date(Date.now() + lockMs);
        await tx.$executeRaw(
          Prisma.sql`UPDATE users SET locked_until = ${until} WHERE id = ${id}::uuid`,
        );
      }
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
