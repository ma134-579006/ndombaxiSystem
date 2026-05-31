import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface SupplierRow {
  id: string;
  code: string;
  name: string;
  nif: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
}

export interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  store_id: string | null;
  is_default: boolean;
  is_active: boolean;
}

export interface StockLevelRow {
  product_id: string;
  product_code: string;
  product_name: string;
  warehouse_id: string;
  warehouse_code: string;
  quantity: string;
  min_qty: string;
}

@Injectable()
export class ErpRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Fornecedores ───────────────────────────────────────────
  createSupplier(
    schema: string,
    input: {
      code: string;
      name: string;
      nif?: string | null;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
    },
  ): Promise<SupplierRow> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<SupplierRow[]>(
        Prisma.sql`INSERT INTO suppliers (code, name, nif, email, phone, address)
          VALUES (${input.code}, ${input.name}, ${input.nif ?? null},
                  ${input.email ?? null}, ${input.phone ?? null}, ${input.address ?? null})
          RETURNING *`,
      );
      return rows[0];
    });
  }

  listSuppliers(schema: string): Promise<SupplierRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<SupplierRow[]>(
        Prisma.sql`SELECT * FROM suppliers WHERE is_active = TRUE ORDER BY name`,
      ),
    );
  }

  // ── Armazéns ───────────────────────────────────────────────
  createWarehouse(
    schema: string,
    input: { code: string; name: string; storeId?: string | null; isDefault?: boolean },
  ): Promise<WarehouseRow> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<WarehouseRow[]>(
        Prisma.sql`INSERT INTO warehouses (code, name, store_id, is_default)
          VALUES (${input.code}, ${input.name}, ${input.storeId ?? null}::uuid, ${input.isDefault ?? false})
          RETURNING *`,
      );
      return rows[0];
    });
  }

  listWarehouses(schema: string): Promise<WarehouseRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<WarehouseRow[]>(
        Prisma.sql`SELECT * FROM warehouses WHERE is_active = TRUE ORDER BY name`,
      ),
    );
  }

  // ── Stock ──────────────────────────────────────────────────
  listStock(schema: string): Promise<StockLevelRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<StockLevelRow[]>(
        Prisma.sql`SELECT si.product_id, p.code AS product_code, p.name AS product_name,
                          si.warehouse_id, w.code AS warehouse_code,
                          si.quantity, si.min_qty
                   FROM stock_items si
                   JOIN products p ON p.id = si.product_id
                   JOIN warehouses w ON w.id = si.warehouse_id
                   ORDER BY p.name, w.code`,
      ),
    );
  }

  /** Produtos abaixo do mínimo (alerta de reposição). */
  listLowStock(schema: string): Promise<StockLevelRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<StockLevelRow[]>(
        Prisma.sql`SELECT si.product_id, p.code AS product_code, p.name AS product_name,
                          si.warehouse_id, w.code AS warehouse_code,
                          si.quantity, si.min_qty
                   FROM stock_items si
                   JOIN products p ON p.id = si.product_id
                   JOIN warehouses w ON w.id = si.warehouse_id
                   WHERE si.quantity <= si.min_qty
                   ORDER BY p.name`,
      ),
    );
  }
}
