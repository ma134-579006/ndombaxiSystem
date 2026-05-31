import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IvaCode } from '@nexus/agt-xml';

export interface ProductRow {
  id: string;
  code: string;
  barcode: string | null;
  name: string;
  description: string | null;
  category_id: string | null;
  iva_code: IvaCode;
  unit_price: string; // NUMERIC comes back as string
  stock_qty: string;
  image_url: string | null;
  gallery: unknown;
  show_online: boolean;
  is_active: boolean;
}

export interface CustomerRow {
  id: string;
  tax_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
}

@Injectable()
export class PosRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Produtos ───────────────────────────────────────────────
  createProduct(
    schema: string,
    input: {
      code: string;
      barcode?: string | null;
      name: string;
      description?: string | null;
      categoryId?: string | null;
      ivaCode: IvaCode;
      unitPrice: number;
      stockQty?: number;
      imageUrl?: string | null;
      gallery?: string[];
      showOnline?: boolean;
    },
  ): Promise<ProductRow> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<ProductRow[]>(
        Prisma.sql`INSERT INTO products
            (code, barcode, name, description, category_id, iva_code, unit_price, stock_qty,
             image_url, gallery, show_online)
          VALUES (${input.code}, ${input.barcode ?? null}, ${input.name},
                  ${input.description ?? null}, ${input.categoryId ?? null}::uuid,
                  ${input.ivaCode}, ${input.unitPrice}, ${input.stockQty ?? 0},
                  ${input.imageUrl ?? null}, ${JSON.stringify(input.gallery ?? [])}::jsonb,
                  ${input.showOnline ?? true})
          RETURNING *`,
      );
      return rows[0];
    });
  }

  listProducts(schema: string): Promise<ProductRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<ProductRow[]>(
        Prisma.sql`SELECT * FROM products WHERE is_active = TRUE ORDER BY name`,
      ),
    );
  }

  async getProduct(schema: string, id: string): Promise<ProductRow> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<ProductRow[]>(
        Prisma.sql`SELECT * FROM products WHERE id = ${id}::uuid LIMIT 1`,
      ),
    );
    if (!rows[0]) throw new NotFoundException(`Produto não encontrado: ${id}`);
    return rows[0];
  }

  async updateProduct(
    schema: string,
    id: string,
    input: {
      name?: string;
      description?: string | null;
      ivaCode?: IvaCode;
      unitPrice?: number;
      stockQty?: number;
      imageUrl?: string | null;
      gallery?: string[];
      showOnline?: boolean;
      isActive?: boolean;
    },
  ): Promise<ProductRow> {
    const sets: Prisma.Sql[] = [];
    if (input.name !== undefined) sets.push(Prisma.sql`name = ${input.name}`);
    if (input.description !== undefined) sets.push(Prisma.sql`description = ${input.description}`);
    if (input.ivaCode !== undefined) sets.push(Prisma.sql`iva_code = ${input.ivaCode}`);
    if (input.unitPrice !== undefined) sets.push(Prisma.sql`unit_price = ${input.unitPrice}`);
    if (input.stockQty !== undefined) sets.push(Prisma.sql`stock_qty = ${input.stockQty}`);
    if (input.imageUrl !== undefined) sets.push(Prisma.sql`image_url = ${input.imageUrl}`);
    if (input.gallery !== undefined)
      sets.push(Prisma.sql`gallery = ${JSON.stringify(input.gallery)}::jsonb`);
    if (input.showOnline !== undefined) sets.push(Prisma.sql`show_online = ${input.showOnline}`);
    if (input.isActive !== undefined) sets.push(Prisma.sql`is_active = ${input.isActive}`);

    if (sets.length === 0) return this.getProduct(schema, id);
    sets.push(Prisma.sql`updated_at = now()`);

    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<ProductRow[]>(
        Prisma.sql`UPDATE products SET ${Prisma.join(sets, ', ')}
                   WHERE id = ${id}::uuid RETURNING *`,
      ),
    );
    if (!rows[0]) throw new NotFoundException(`Produto não encontrado: ${id}`);
    return rows[0];
  }

  // ── Clientes ───────────────────────────────────────────────
  createCustomer(
    schema: string,
    input: {
      taxId?: string | null;
      name: string;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
    },
  ): Promise<CustomerRow> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<CustomerRow[]>(
        Prisma.sql`INSERT INTO customers (tax_id, name, email, phone, address)
          VALUES (${input.taxId ?? null}, ${input.name}, ${input.email ?? null},
                  ${input.phone ?? null}, ${input.address ?? null})
          RETURNING *`,
      );
      return rows[0];
    });
  }

  listCustomers(schema: string): Promise<CustomerRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<CustomerRow[]>(
        Prisma.sql`SELECT * FROM customers WHERE is_active = TRUE ORDER BY name`,
      ),
    );
  }
}
