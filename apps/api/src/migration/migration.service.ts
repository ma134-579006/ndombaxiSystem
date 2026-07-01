import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAuditService } from '../cashbox/tenant-audit.service';
import {
  CUSTOMER_ALIASES, CustomerField,
  PRODUCT_ALIASES, ProductField,
  SUPPLIER_ALIASES, SupplierField,
  mapHeaders, parseFlexibleNumber,
} from './column-aliases';
import { parseUploadedFile } from './parse-file';
import type { MigrationKind } from './dto/migration.dto';

export interface PreviewRow { action: 'CREATE' | 'UPDATE'; data: Record<string, unknown> }
export interface MigrationPreview {
  kind: MigrationKind;
  detectedColumns: Record<string, string>;
  unmappedColumns: string[];
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  toSkip: number;
  sample: PreviewRow[];
  skippedSamples: { row: number; reason: string }[];
}
export interface MigrationApplyResult { kind: MigrationKind; created: number; updated: number; skipped: number; errors: string[] }

type Actor = { id?: string | null; name?: string | null };
const SAMPLE_SIZE = 20;

/** Código interno curto e (na prática) único — usado quando o ficheiro de
 *  origem não traz um código de produto/fornecedor identificável. */
function generateInternalCode(prefix: string): string {
  return `${prefix}${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
}

/**
 * Migração inteligente de dados de OUTROS sistemas (Vendus, Primavera, PHC/
 * "Negócio", exportações Excel genéricas) — produtos, clientes e fornecedores.
 * Mapeamento de colunas 100% determinístico (ver column-aliases.ts — nunca usa
 * IA/heurística "criativa", por isso NUNCA alucina). Escrita sempre em UPSERT
 * (por código/NIF/nome) — nunca apaga nada; cada linha é isolada (uma falha
 * não interrompe as restantes).
 */
@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: TenantAuditService,
  ) {}

  // ── Pré-visualização (NUNCA escreve na BD) ──────────────────────────────
  preview(schema: string, kind: MigrationKind, buffer: Buffer, fileName?: string): Promise<MigrationPreview> {
    const { headers, rows } = parseUploadedFile(buffer, fileName);
    if (kind === 'products') return this.previewProducts(schema, headers, rows);
    if (kind === 'customers') return this.previewCustomers(schema, headers, rows);
    return this.previewSuppliers(schema, headers, rows);
  }

  // ── Aplicação (upsert; nunca destrutivo) ────────────────────────────────
  apply(schema: string, kind: MigrationKind, buffer: Buffer, fileName: string | undefined, actor: Actor): Promise<MigrationApplyResult> {
    const { headers, rows } = parseUploadedFile(buffer, fileName);
    if (kind === 'products') return this.applyProducts(schema, headers, rows, actor, fileName);
    if (kind === 'customers') return this.applyCustomers(schema, headers, rows, actor, fileName);
    return this.applySuppliers(schema, headers, rows, actor, fileName);
  }

  // ═══════════════════════════ PRODUTOS ═══════════════════════════════════
  private async previewProducts(schema: string, headers: string[], rows: Record<string, unknown>[]): Promise<MigrationPreview> {
    const { mapping, unmapped } = mapHeaders<ProductField>(headers, PRODUCT_ALIASES);
    if (!mapping.name) {
      throw new BadRequestException(`Não encontrei a coluna de NOME do produto. Colunas do ficheiro: ${headers.join(', ')}`);
    }
    const existing = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ code: string; barcode: string | null }[]>(Prisma.sql`SELECT code, barcode FROM products`));
    const byCode = new Set(existing.map((p) => p.code));
    const byBarcode = new Set(existing.filter((p) => p.barcode).map((p) => (p.barcode as string).trim()));

    let toCreate = 0, toUpdate = 0, toSkip = 0;
    const sample: PreviewRow[] = [];
    const skippedSamples: { row: number; reason: string }[] = [];
    rows.forEach((r, i) => {
      const name = String(r[mapping.name!] ?? '').trim();
      if (!name) { toSkip++; if (skippedSamples.length < 10) skippedSamples.push({ row: i + 2, reason: 'sem nome' }); return; }
      const code = mapping.code ? String(r[mapping.code] ?? '').trim() : '';
      const barcode = mapping.barcode ? String(r[mapping.barcode] ?? '').trim() : '';
      const found = (!!code && byCode.has(code)) || (!!barcode && byBarcode.has(barcode));
      const action: PreviewRow['action'] = found ? 'UPDATE' : 'CREATE';
      if (action === 'CREATE') toCreate++; else toUpdate++;
      if (sample.length < SAMPLE_SIZE) {
        sample.push({
          action,
          data: {
            name,
            code: code || '(gerado automaticamente)',
            barcode: barcode || null,
            stock: mapping.stock ? parseFlexibleNumber(r[mapping.stock]) : null,
            custo: mapping.costPrice ? parseFlexibleNumber(r[mapping.costPrice]) : null,
            venda: mapping.salePrice ? parseFlexibleNumber(r[mapping.salePrice]) : null,
          },
        });
      }
    });
    return { kind: 'products', detectedColumns: mapping as Record<string, string>, unmappedColumns: unmapped, totalRows: rows.length, toCreate, toUpdate, toSkip, sample, skippedSamples };
  }

  private async applyProducts(
    schema: string, headers: string[], rows: Record<string, unknown>[], actor: Actor, fileName?: string,
  ): Promise<MigrationApplyResult> {
    const { mapping } = mapHeaders<ProductField>(headers, PRODUCT_ALIASES);
    if (!mapping.name) throw new BadRequestException('Não encontrei a coluna de nome do produto.');
    let created = 0, updated = 0, skipped = 0;
    const errors: string[] = [];

    await this.prisma.runInTenant(schema, async (tx) => {
      const catRows = await tx.$queryRaw<{ id: string; name: string }[]>(Prisma.sql`SELECT id, name FROM product_categories`);
      const catByName = new Map(catRows.map((c) => [c.name.trim().toLowerCase(), c.id]));

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = String(r[mapping.name!] ?? '').trim();
        if (!name) { skipped++; continue; }
        try {
          const code = mapping.code ? String(r[mapping.code] ?? '').trim() : '';
          const barcode = mapping.barcode ? String(r[mapping.barcode] ?? '').trim() : '';
          const stock = mapping.stock ? parseFlexibleNumber(r[mapping.stock]) : null;
          const costPrice = mapping.costPrice ? parseFlexibleNumber(r[mapping.costPrice]) : null;
          const salePrice = mapping.salePrice ? parseFlexibleNumber(r[mapping.salePrice]) : null;

          let categoryId: string | null = null;
          if (mapping.category) {
            const catName = String(r[mapping.category] ?? '').trim();
            if (catName) {
              const key = catName.toLowerCase();
              categoryId = catByName.get(key) ?? null;
              if (!categoryId) {
                const ins = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`INSERT INTO product_categories (name) VALUES (${catName}) RETURNING id`);
                categoryId = ins[0].id;
                catByName.set(key, categoryId);
              }
            }
          }

          let existingRow: { id: string; shared_stock: boolean } | undefined;
          if (code) {
            const f = await tx.$queryRaw<{ id: string; shared_stock: boolean }[]>(Prisma.sql`SELECT id, shared_stock FROM products WHERE code = ${code} LIMIT 1`);
            existingRow = f[0];
          }
          if (!existingRow && barcode) {
            const f = await tx.$queryRaw<{ id: string; shared_stock: boolean }[]>(Prisma.sql`SELECT id, shared_stock FROM products WHERE barcode = ${barcode} LIMIT 1`);
            existingRow = f[0];
          }

          if (existingRow) {
            const sets: Prisma.Sql[] = [Prisma.sql`name = ${name}`, Prisma.sql`updated_at = now()`];
            if (categoryId) sets.push(Prisma.sql`category_id = ${categoryId}::uuid`);
            if (costPrice !== null) sets.push(Prisma.sql`cost_price = ${costPrice}`);
            if (salePrice !== null) sets.push(Prisma.sql`unit_price = ${salePrice}`);
            // Stock só se PARTILHADO — nunca desfasa o livro por loja (stock_items).
            if (stock !== null && existingRow.shared_stock) sets.push(Prisma.sql`stock_qty = ${stock}`);
            await tx.$executeRaw(Prisma.sql`UPDATE products SET ${Prisma.join(sets, ', ')} WHERE id = ${existingRow.id}::uuid`);
            updated++;
          } else {
            const finalCode = code || barcode || generateInternalCode('MIG');
            await tx.$executeRaw(Prisma.sql`
              INSERT INTO products (code, barcode, name, category_id, iva_code, unit_price, cost_price, stock_qty, shared_stock, show_online)
              VALUES (${finalCode}, ${barcode || null}, ${name}, ${categoryId}::uuid, 'NOR', ${salePrice ?? 0}, ${costPrice ?? 0}, ${stock ?? 0}, TRUE, FALSE)`);
            created++;
          }
        } catch (e) {
          skipped++;
          const msg = e instanceof Error ? e.message : 'erro desconhecido';
          if (errors.length < 15) errors.push(`Linha ${i + 2} (${name}): ${msg.slice(0, 90)}`);
          this.logger.warn(`Migração de produtos falhou na linha ${i + 2}: ${msg}`);
        }
      }
    });

    await this.audit.record(schema, {
      actorId: actor.id, actorName: actor.name, action: 'MIGRATION_IMPORT',
      entity: 'products', details: { fileName, created, updated, skipped },
    });
    return { kind: 'products', created, updated, skipped, errors };
  }

  // ═══════════════════════════ CLIENTES ═══════════════════════════════════
  private async previewCustomers(schema: string, headers: string[], rows: Record<string, unknown>[]): Promise<MigrationPreview> {
    const { mapping, unmapped } = mapHeaders<CustomerField>(headers, CUSTOMER_ALIASES);
    if (!mapping.name) throw new BadRequestException(`Não encontrei a coluna de NOME do cliente. Colunas do ficheiro: ${headers.join(', ')}`);
    const existing = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ tax_id: string | null; name: string }[]>(Prisma.sql`SELECT tax_id, name FROM customers`));
    const byTax = new Set(existing.filter((c) => c.tax_id).map((c) => (c.tax_id as string).trim().toLowerCase()));
    const byName = new Set(existing.map((c) => c.name.trim().toLowerCase()));

    let toCreate = 0, toUpdate = 0, toSkip = 0;
    const sample: PreviewRow[] = [];
    const skippedSamples: { row: number; reason: string }[] = [];
    rows.forEach((r, i) => {
      const name = String(r[mapping.name!] ?? '').trim();
      if (!name) { toSkip++; if (skippedSamples.length < 10) skippedSamples.push({ row: i + 2, reason: 'sem nome' }); return; }
      const taxId = mapping.taxId ? String(r[mapping.taxId] ?? '').trim() : '';
      const found = (!!taxId && byTax.has(taxId.toLowerCase())) || byName.has(name.toLowerCase());
      const action: PreviewRow['action'] = found ? 'UPDATE' : 'CREATE';
      if (action === 'CREATE') toCreate++; else toUpdate++;
      if (sample.length < SAMPLE_SIZE) {
        sample.push({ action, data: { name, taxId: taxId || null, dívida: mapping.debt ? parseFlexibleNumber(r[mapping.debt]) : null } });
      }
    });
    return { kind: 'customers', detectedColumns: mapping as Record<string, string>, unmappedColumns: unmapped, totalRows: rows.length, toCreate, toUpdate, toSkip, sample, skippedSamples };
  }

  private async applyCustomers(
    schema: string, headers: string[], rows: Record<string, unknown>[], actor: Actor, fileName?: string,
  ): Promise<MigrationApplyResult> {
    const { mapping } = mapHeaders<CustomerField>(headers, CUSTOMER_ALIASES);
    if (!mapping.name) throw new BadRequestException('Não encontrei a coluna de nome do cliente.');
    let created = 0, updated = 0, skipped = 0;
    const errors: string[] = [];
    const dateLabel = new Date().toLocaleDateString('pt-PT');
    const sourceLabel = `Importado de ${fileName || 'ficheiro'} em ${dateLabel}`;

    await this.prisma.runInTenant(schema, async (tx) => {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = String(r[mapping.name!] ?? '').trim();
        if (!name) { skipped++; continue; }
        try {
          const taxId = mapping.taxId ? String(r[mapping.taxId] ?? '').trim() : '';
          const phone = mapping.phone ? String(r[mapping.phone] ?? '').trim() : '';
          const email = mapping.email ? String(r[mapping.email] ?? '').trim() : '';
          const address = mapping.address ? String(r[mapping.address] ?? '').trim() : '';
          const historyTxt = mapping.history ? String(r[mapping.history] ?? '').trim() : '';
          const debt = mapping.debt ? parseFlexibleNumber(r[mapping.debt]) : 0;

          let existing: { id: string; notes: string | null } | undefined;
          if (taxId) {
            const f = await tx.$queryRaw<{ id: string; notes: string | null }[]>(
              Prisma.sql`SELECT id, notes FROM customers WHERE lower(trim(tax_id)) = ${taxId.toLowerCase()} LIMIT 1`);
            existing = f[0];
          }
          if (!existing) {
            const f = await tx.$queryRaw<{ id: string; notes: string | null }[]>(
              Prisma.sql`SELECT id, notes FROM customers WHERE lower(trim(name)) = ${name.toLowerCase()} LIMIT 1`);
            existing = f[0];
          }
          const newNote = historyTxt ? `[${sourceLabel}] ${historyTxt}` : null;

          let customerId: string;
          if (existing) {
            const sets: Prisma.Sql[] = [Prisma.sql`name = ${name}`, Prisma.sql`updated_at = now()`];
            if (taxId) sets.push(Prisma.sql`tax_id = ${taxId}`);
            if (phone) sets.push(Prisma.sql`phone = ${phone}`);
            if (email) sets.push(Prisma.sql`email = ${email}`);
            if (address) sets.push(Prisma.sql`address = ${address}`);
            if (newNote) {
              const combined = existing.notes ? `${existing.notes}\n${newNote}` : newNote;
              sets.push(Prisma.sql`notes = ${combined}`);
            }
            await tx.$executeRaw(Prisma.sql`UPDATE customers SET ${Prisma.join(sets, ', ')} WHERE id = ${existing.id}::uuid`);
            customerId = existing.id;
            updated++;
          } else {
            const ins = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
              INSERT INTO customers (tax_id, name, phone, email, address, notes)
              VALUES (${taxId || null}, ${name}, ${phone || null}, ${email || null}, ${address || null}, ${newNote})
              RETURNING id`);
            customerId = ins[0].id;
            created++;
          }

          if (debt > 0) {
            // Evita duplicar o MESMO saldo inicial se o ficheiro for reimportado.
            const dup = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
              SELECT COUNT(*)::int AS n FROM receivables
              WHERE customer_id = ${customerId}::uuid AND notes ILIKE 'Importado%' AND original_amount = ${debt}`);
            if ((dup[0]?.n ?? 0) === 0) {
              await tx.$executeRaw(Prisma.sql`
                INSERT INTO receivables (customer_id, customer_name, invoice_number, original_amount, paid_amount, status, notes)
                VALUES (${customerId}::uuid, ${name}, 'SALDO INICIAL', ${debt}, 0, 'OPEN', ${sourceLabel})`);
            }
          }
        } catch (e) {
          skipped++;
          const msg = e instanceof Error ? e.message : 'erro desconhecido';
          if (errors.length < 15) errors.push(`Linha ${i + 2} (${name}): ${msg.slice(0, 90)}`);
          this.logger.warn(`Migração de clientes falhou na linha ${i + 2}: ${msg}`);
        }
      }
    });

    await this.audit.record(schema, {
      actorId: actor.id, actorName: actor.name, action: 'MIGRATION_IMPORT',
      entity: 'customers', details: { fileName, created, updated, skipped },
    });
    return { kind: 'customers', created, updated, skipped, errors };
  }

  // ═══════════════════════════ FORNECEDORES ═══════════════════════════════
  private async previewSuppliers(schema: string, headers: string[], rows: Record<string, unknown>[]): Promise<MigrationPreview> {
    const { mapping, unmapped } = mapHeaders<SupplierField>(headers, SUPPLIER_ALIASES);
    if (!mapping.name) throw new BadRequestException(`Não encontrei a coluna de NOME do fornecedor. Colunas do ficheiro: ${headers.join(', ')}`);
    const existing = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ nif: string | null; name: string }[]>(Prisma.sql`SELECT nif, name FROM suppliers`));
    const byTax = new Set(existing.filter((s) => s.nif).map((s) => (s.nif as string).trim().toLowerCase()));
    const byName = new Set(existing.map((s) => s.name.trim().toLowerCase()));

    let toCreate = 0, toUpdate = 0, toSkip = 0;
    const sample: PreviewRow[] = [];
    const skippedSamples: { row: number; reason: string }[] = [];
    rows.forEach((r, i) => {
      const name = String(r[mapping.name!] ?? '').trim();
      if (!name) { toSkip++; if (skippedSamples.length < 10) skippedSamples.push({ row: i + 2, reason: 'sem nome' }); return; }
      const taxId = mapping.taxId ? String(r[mapping.taxId] ?? '').trim() : '';
      const found = (!!taxId && byTax.has(taxId.toLowerCase())) || byName.has(name.toLowerCase());
      const action: PreviewRow['action'] = found ? 'UPDATE' : 'CREATE';
      if (action === 'CREATE') toCreate++; else toUpdate++;
      if (sample.length < SAMPLE_SIZE) {
        sample.push({ action, data: { name, taxId: taxId || null, dívida: mapping.debt ? parseFlexibleNumber(r[mapping.debt]) : null } });
      }
    });
    return { kind: 'suppliers', detectedColumns: mapping as Record<string, string>, unmappedColumns: unmapped, totalRows: rows.length, toCreate, toUpdate, toSkip, sample, skippedSamples };
  }

  private async applySuppliers(
    schema: string, headers: string[], rows: Record<string, unknown>[], actor: Actor, fileName?: string,
  ): Promise<MigrationApplyResult> {
    const { mapping } = mapHeaders<SupplierField>(headers, SUPPLIER_ALIASES);
    if (!mapping.name) throw new BadRequestException('Não encontrei a coluna de nome do fornecedor.');
    let created = 0, updated = 0, skipped = 0;
    const errors: string[] = [];
    const dateLabel = new Date().toLocaleDateString('pt-PT');
    const sourceLabel = `Importado de ${fileName || 'ficheiro'} em ${dateLabel}`;

    await this.prisma.runInTenant(schema, async (tx) => {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = String(r[mapping.name!] ?? '').trim();
        if (!name) { skipped++; continue; }
        try {
          const taxId = mapping.taxId ? String(r[mapping.taxId] ?? '').trim() : '';
          const phone = mapping.phone ? String(r[mapping.phone] ?? '').trim() : '';
          const email = mapping.email ? String(r[mapping.email] ?? '').trim() : '';
          const address = mapping.address ? String(r[mapping.address] ?? '').trim() : '';
          const historyTxt = mapping.history ? String(r[mapping.history] ?? '').trim() : '';
          const debt = mapping.debt ? parseFlexibleNumber(r[mapping.debt]) : 0;

          let existing: { id: string; notes: string | null } | undefined;
          if (taxId) {
            const f = await tx.$queryRaw<{ id: string; notes: string | null }[]>(
              Prisma.sql`SELECT id, notes FROM suppliers WHERE lower(trim(nif)) = ${taxId.toLowerCase()} LIMIT 1`);
            existing = f[0];
          }
          if (!existing) {
            const f = await tx.$queryRaw<{ id: string; notes: string | null }[]>(
              Prisma.sql`SELECT id, notes FROM suppliers WHERE lower(trim(name)) = ${name.toLowerCase()} LIMIT 1`);
            existing = f[0];
          }
          const newNote = historyTxt ? `[${sourceLabel}] ${historyTxt}` : null;

          let supplierId: string;
          if (existing) {
            const sets: Prisma.Sql[] = [Prisma.sql`name = ${name}`, Prisma.sql`updated_at = now()`];
            if (taxId) sets.push(Prisma.sql`nif = ${taxId}`);
            if (phone) sets.push(Prisma.sql`phone = ${phone}`);
            if (email) sets.push(Prisma.sql`email = ${email}`);
            if (address) sets.push(Prisma.sql`address = ${address}`);
            if (newNote) {
              const combined = existing.notes ? `${existing.notes}\n${newNote}` : newNote;
              sets.push(Prisma.sql`notes = ${combined}`);
            }
            await tx.$executeRaw(Prisma.sql`UPDATE suppliers SET ${Prisma.join(sets, ', ')} WHERE id = ${existing.id}::uuid`);
            supplierId = existing.id;
            updated++;
          } else {
            const code = generateInternalCode('FORN');
            const ins = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
              INSERT INTO suppliers (code, name, nif, phone, email, address, notes)
              VALUES (${code}, ${name}, ${taxId || null}, ${phone || null}, ${email || null}, ${address || null}, ${newNote})
              RETURNING id`);
            supplierId = ins[0].id;
            created++;
          }

          if (debt > 0) {
            const dup = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
              SELECT COUNT(*)::int AS n FROM payables
              WHERE supplier_id = ${supplierId}::uuid AND notes ILIKE 'Importado%' AND original_amount = ${debt}`);
            if ((dup[0]?.n ?? 0) === 0) {
              await tx.$executeRaw(Prisma.sql`
                INSERT INTO payables (supplier_id, supplier_name, reference, original_amount, paid_amount, status, notes)
                VALUES (${supplierId}::uuid, ${name}, 'SALDO INICIAL', ${debt}, 0, 'OPEN', ${sourceLabel})`);
            }
          }
        } catch (e) {
          skipped++;
          const msg = e instanceof Error ? e.message : 'erro desconhecido';
          if (errors.length < 15) errors.push(`Linha ${i + 2} (${name}): ${msg.slice(0, 90)}`);
          this.logger.warn(`Migração de fornecedores falhou na linha ${i + 2}: ${msg}`);
        }
      }
    });

    await this.audit.record(schema, {
      actorId: actor.id, actorName: actor.name, action: 'MIGRATION_IMPORT',
      entity: 'suppliers', details: { fileName, created, updated, skipped },
    });
    return { kind: 'suppliers', created, updated, skipped, errors };
  }
}
