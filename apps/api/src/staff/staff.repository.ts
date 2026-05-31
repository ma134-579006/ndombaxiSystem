import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface StoreRow {
  id: string;
  code: string;
  name: string;
  address: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Funcionário sem segredos (sem password_hash / pin_hash / two_fa_secret). */
export interface StaffRow {
  id: string;
  email: string;
  name: string;
  role: string;
  store_id: string | null;
  two_fa_enabled: boolean;
  is_active: boolean;
  must_reset_pw: boolean;
  has_pin: boolean;
  last_login_at: Date | null;
  created_at: Date;
}

/** Colunas seguras de um funcionário (nunca devolve segredos). */
const SAFE_USER_COLS = Prisma.sql`id, email, name, role, store_id, two_fa_enabled,
  is_active, must_reset_pw, (pin_hash IS NOT NULL) AS has_pin, last_login_at, created_at`;

/**
 * Acesso aos dados de equipa (users) e lojas (stores) do tenant.
 * Tudo isolado no schema do tenant via runInTenant. As leituras de funcionários
 * NUNCA expõem segredos (password/PIN/2FA).
 */
@Injectable()
export class StaffRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Lojas ──────────────────────────────────────────────────
  listStores(schema: string): Promise<StoreRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<StoreRow[]>(
        Prisma.sql`SELECT * FROM stores ORDER BY is_default DESC, name`,
      ),
    );
  }

  async getStore(schema: string, id: string): Promise<StoreRow> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<StoreRow[]>(Prisma.sql`SELECT * FROM stores WHERE id = ${id}::uuid LIMIT 1`),
    );
    if (!rows[0]) throw new NotFoundException(`Loja não encontrada: ${id}`);
    return rows[0];
  }

  createStore(
    schema: string,
    input: { code: string; name: string; address?: string | null; isDefault?: boolean },
  ): Promise<StoreRow> {
    return this.prisma.runInTenant(schema, async (tx) => {
      if (input.isDefault) {
        await tx.$executeRaw(Prisma.sql`UPDATE stores SET is_default = FALSE WHERE is_default = TRUE`);
      }
      const rows = await tx.$queryRaw<StoreRow[]>(
        Prisma.sql`INSERT INTO stores (code, name, address, is_default)
                   VALUES (${input.code}, ${input.name}, ${input.address ?? null},
                           ${input.isDefault ?? false})
                   RETURNING *`,
      );
      return rows[0];
    });
  }

  async updateStore(
    schema: string,
    id: string,
    input: { name?: string; address?: string | null; isActive?: boolean; isDefault?: boolean },
  ): Promise<StoreRow> {
    const sets: Prisma.Sql[] = [];
    if (input.name !== undefined) sets.push(Prisma.sql`name = ${input.name}`);
    if (input.address !== undefined) sets.push(Prisma.sql`address = ${input.address}`);
    if (input.isActive !== undefined) sets.push(Prisma.sql`is_active = ${input.isActive}`);
    if (input.isDefault !== undefined) sets.push(Prisma.sql`is_default = ${input.isDefault}`);
    if (sets.length === 0) return this.getStore(schema, id);
    sets.push(Prisma.sql`updated_at = now()`);

    return this.prisma.runInTenant(schema, async (tx) => {
      if (input.isDefault) {
        await tx.$executeRaw(
          Prisma.sql`UPDATE stores SET is_default = FALSE WHERE is_default = TRUE AND id <> ${id}::uuid`,
        );
      }
      const rows = await tx.$queryRaw<StoreRow[]>(
        Prisma.sql`UPDATE stores SET ${Prisma.join(sets, ', ')} WHERE id = ${id}::uuid RETURNING *`,
      );
      if (!rows[0]) throw new NotFoundException(`Loja não encontrada: ${id}`);
      return rows[0];
    });
  }

  // ── Funcionários (users) ───────────────────────────────────
  listStaff(schema: string): Promise<StaffRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<StaffRow[]>(Prisma.sql`SELECT ${SAFE_USER_COLS} FROM users ORDER BY name`),
    );
  }

  async getStaff(schema: string, id: string): Promise<StaffRow> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<StaffRow[]>(
        Prisma.sql`SELECT ${SAFE_USER_COLS} FROM users WHERE id = ${id}::uuid LIMIT 1`,
      ),
    );
    if (!rows[0]) throw new NotFoundException(`Funcionário não encontrado: ${id}`);
    return rows[0];
  }

  async existsByEmail(schema: string, email: string): Promise<boolean> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`),
    );
    return rows.length > 0;
  }

  async createUser(
    schema: string,
    input: {
      email: string;
      name: string;
      role: string;
      passwordHash: string;
      storeId?: string | null;
      pinHash?: string | null;
      mustResetPw: boolean;
    },
  ): Promise<StaffRow> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<StaffRow[]>(
        Prisma.sql`INSERT INTO users (email, password_hash, name, role, store_id, pin_hash, must_reset_pw)
                   VALUES (${input.email}, ${input.passwordHash}, ${input.name}, ${input.role},
                           ${input.storeId ?? null}::uuid, ${input.pinHash ?? null}, ${input.mustResetPw})
                   RETURNING ${SAFE_USER_COLS}`,
      ),
    );
    return rows[0];
  }

  async updateStaff(
    schema: string,
    id: string,
    input: { name?: string; role?: string; storeId?: string | null; isActive?: boolean },
  ): Promise<StaffRow> {
    const sets: Prisma.Sql[] = [];
    if (input.name !== undefined) sets.push(Prisma.sql`name = ${input.name}`);
    if (input.role !== undefined) sets.push(Prisma.sql`role = ${input.role}`);
    if (input.storeId !== undefined) sets.push(Prisma.sql`store_id = ${input.storeId}::uuid`);
    if (input.isActive !== undefined) sets.push(Prisma.sql`is_active = ${input.isActive}`);
    if (sets.length === 0) return this.getStaff(schema, id);
    sets.push(Prisma.sql`updated_at = now()`);

    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<StaffRow[]>(
        Prisma.sql`UPDATE users SET ${Prisma.join(sets, ', ')}
                   WHERE id = ${id}::uuid RETURNING ${SAFE_USER_COLS}`,
      ),
    );
    if (!rows[0]) throw new NotFoundException(`Funcionário não encontrado: ${id}`);
    return rows[0];
  }

  async setPasswordHash(
    schema: string,
    id: string,
    passwordHash: string,
    mustReset: boolean,
  ): Promise<void> {
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(
        Prisma.sql`UPDATE users SET password_hash = ${passwordHash}, must_reset_pw = ${mustReset},
                   failed_logins = 0, locked_until = NULL, updated_at = now()
                   WHERE id = ${id}::uuid`,
      ),
    );
  }

  async setPinHash(schema: string, id: string, pinHash: string): Promise<void> {
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(
        Prisma.sql`UPDATE users SET pin_hash = ${pinHash}, updated_at = now() WHERE id = ${id}::uuid`,
      ),
    );
  }
}
