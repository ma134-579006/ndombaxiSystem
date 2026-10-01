import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAuditService } from '../cashbox/tenant-audit.service';
import { StockService } from '../erp/stock.service';
import {
  CUSTOMER_ALIASES, CustomerField,
  PRODUCT_ALIASES, ProductField,
  SUPPLIER_ALIASES, SupplierField,
  mapHeaders, parseFlexibleNumber,
} from './column-aliases';
import { cleanName, hasLetters, isValidGtin, readBarcode, readCode, readStock } from './cell-values';
import { detectProductColumns } from './product-columns';
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
  /** Todas as colunas do ficheiro (para o utilizador poder corrigir o mapeamento). */
  headers?: string[];
  /** Como as colunas foram decididas. */
  notes?: string[];
  /** Problemas que o utilizador deve ver ANTES de importar. */
  warnings?: string[];
  /** Resumo do que vai entrar (só produtos). */
  summary?: { withBarcode: number; withStock: number; stockTotal: number; invalidBarcodes: number; duplicatesInFile: number };
}
export interface MigrationApplyResult { kind: MigrationKind; created: number; updated: number; skipped: number; errors: string[]; warnings?: string[] }

/** Valores de uma linha de produto, já lidos com rigor. */
interface ProductCells {
  name: string; code: string; barcode: string; barcodeWarning?: string;
  stock: number | null; stockWarning?: string; cost: number | null; sale: number | null;
  /** Stock por loja do ficheiro (já limitado a ≥ 0); vazio se o ficheiro não o tem. */
  perStore: { label: string; value: number | null }[];
  /** O ficheiro tinha um código de barras no lugar do NOME (passa a código de barras). */
  nameWasBarcode?: boolean;
  barcodeHasLetters?: boolean;
}

const normStore = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Associa um rótulo de loja do ficheiro a uma loja da empresa (nome igual ou contido). */
function matchStore<T extends { name: string }>(label: string, stores: T[]): T | undefined {
  const l = normStore(label);
  return stores.find((s) => normStore(s.name) === l)
    ?? stores.find((s) => { const n = normStore(s.name); return n.length >= 3 && (n.includes(l) || l.includes(n)); });
}

type Actor = { id?: string | null; name?: string | null };
const SAMPLE_SIZE = 20;

/**
 * Nº de linhas por LOTE (cada lote = uma transacção própria).
 * NUNCA importar o ficheiro inteiro numa só transacção: o runInTenant tem
 * timeout de 30 s e cada linha faz 3–10 idas à BD remota (~13 ms cada) — um
 * ficheiro de ~1900 produtos leva minutos e rebentava com "Transaction already
 * closed" em TODAS as linhas após os 30 s (visto em produção a 02/07).
 * 50 linhas ≈ ≤500 queries ≈ poucos segundos — margem confortável.
 */
const BATCH_SIZE = 50;

/** Primeira linha útil de um erro (os erros do Prisma começam com linhas vazias). */
function firstErrorLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : 'erro desconhecido';
  return (msg.split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? 'erro').slice(0, 160);
}

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
  preview(schema: string, kind: MigrationKind, buffer: Buffer, fileName?: string, mapping?: Record<string, string> | null): Promise<MigrationPreview> {
    const { headers, rows } = parseUploadedFile(buffer, fileName, kind);
    if (kind === 'products') return this.previewProducts(schema, headers, rows, mapping ?? null);
    if (kind === 'customers') return this.previewCustomers(schema, headers, rows);
    return this.previewSuppliers(schema, headers, rows);
  }

  /**
   * Aplicação (upsert; nunca destrutivo). `storeId` só se aplica a PRODUTOS:
   * loja específica (o stock importado fica "por loja", igual à criação manual
   * de produtos) ou `null`/omisso = "Todas as lojas" (stock partilhado — pool
   * central, o comportamento anterior). Clientes/fornecedores ignoram-no.
   */
  apply(
    schema: string, kind: MigrationKind, buffer: Buffer, fileName: string | undefined, actor: Actor,
    storeId?: string | null, mapping?: Record<string, string> | null,
  ): Promise<MigrationApplyResult> {
    const { headers, rows } = parseUploadedFile(buffer, fileName, kind);
    if (kind === 'products') return this.applyProducts(schema, headers, rows, actor, fileName, storeId ?? null, mapping ?? null);
    if (kind === 'customers') return this.applyCustomers(schema, headers, rows, actor, fileName);
    return this.applySuppliers(schema, headers, rows, actor, fileName);
  }

  /**
   * Fixa o saldo ABSOLUTO de stock de um produto numa loja (delta = alvo −
   * actual), usando o método ESTÁTICO `StockService.applyMovement` DENTRO da
   * transacção já aberta — nunca abre uma transacção aninhada (evitar esgotar
   * ligações à Aiven num import com muitas linhas). Mesma lógica de
   * `StockService.adjust()`, sem a transacção própria dessa função.
   */
  private async setAbsoluteStock(
    tx: Prisma.TransactionClient, productId: string, warehouseId: string, targetQty: number, reference: string,
  ): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO stock_items (product_id, warehouse_id, quantity) VALUES (${productId}::uuid, ${warehouseId}::uuid, 0)
      ON CONFLICT (product_id, warehouse_id) DO NOTHING`);
    const cur = await tx.$queryRaw<{ quantity: string }[]>(Prisma.sql`
      SELECT quantity FROM stock_items WHERE product_id = ${productId}::uuid AND warehouse_id = ${warehouseId}::uuid FOR UPDATE`);
    const current = Number(cur[0]?.quantity ?? 0);
    const delta = targetQty - current;
    if (delta === 0) return;
    await StockService.applyMovement(tx, { productId, warehouseId, type: 'ADJUST', quantity: delta, reference });
  }

  // ═══════════════════════════ PRODUTOS ═══════════════════════════════════
  /** Lê UMA linha de produto com rigor (código de barras, stock vazio ≠ 0, nome limpo). */
  private readProductRow(r: Record<string, unknown>, cols: ReturnType<typeof detectProductColumns>): ProductCells {
    const m = cols.mapping;
    const barcodeSrc = m.barcode ?? (cols.barcodeFromCode ? m.code : undefined);
    const bc = barcodeSrc ? readBarcode(r[barcodeSrc]) : { value: '' as string, warning: undefined as string | undefined };
    let st: { value: number | null; warning?: string } = m.stock ? readStock(r[m.stock]) : { value: null };
    // Stock por loja: cada coluna lida com rigor; o total é a soma (null se todas vazias).
    const perStore = cols.storeStock.map((s) => {
      const v = readStock(r[s.header]);
      if (v.warning && !st.warning) st = { ...st, warning: v.warning };
      return { label: s.label, value: v.value };
    });
    if (perStore.length) {
      const known = perStore.filter((p) => p.value !== null);
      st = { value: known.length ? known.reduce((t, p) => t + (p.value as number), 0) : null, warning: st.warning };
    }
    const name = cleanName(r[m.name!]);
    let barcode = bc.value;
    let nameWasBarcode = false;
    // O ficheiro de origem tem por vezes o código de barras na coluna do NOME:
    // sem código de barras na linha, esse número passa a ser o código de barras.
    if (/^\d{8,14}$/.test(name) && !barcode) { barcode = name; nameWasBarcode = true; }
    else if (/^\d{8,14}$/.test(name)) nameWasBarcode = true;
    return {
      name,
      code: m.code ? readCode(r[m.code]) : '',
      barcode,
      barcodeWarning: bc.warning && !/^código GS1/.test(bc.warning) ? bc.warning : undefined,
      barcodeHasLetters: hasLetters(barcode),
      nameWasBarcode,
      stock: st.value,
      stockWarning: st.warning,
      perStore,
      cost: m.costPrice ? parseFlexibleNumber(r[m.costPrice]) : null,
      sale: m.salePrice ? parseFlexibleNumber(r[m.salePrice]) : null,
    };
  }

  private async previewProducts(schema: string, headers: string[], rows: Record<string, unknown>[], override: Record<string, string> | null = null): Promise<MigrationPreview> {
    const cols = detectProductColumns(headers, rows, override);
    const { mapping, unmapped } = cols;
    if (!mapping.name) {
      throw new BadRequestException(`Não encontrei a coluna de NOME do produto. Colunas do ficheiro: ${headers.join(', ')}`);
    }
    const existing = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ code: string; barcode: string | null }[]>(Prisma.sql`SELECT code, barcode FROM products`));
    const byCode = new Set(existing.map((p) => p.code));
    const byBarcode = new Set(existing.filter((p) => p.barcode).map((p) => (p.barcode as string).trim()));

    let toCreate = 0, toUpdate = 0, toSkip = 0;
    let withBarcode = 0, withStock = 0, stockTotal = 0, invalidBarcodes = 0, duplicatesInFile = 0, sciNotation = 0, negativeStock = 0;
    let nameAsBarcode = 0, lettersBarcode = 0;
    const lettersExamples: string[] = [];
    const seen = new Set<string>();
    const invalidExamples: string[] = [];
    const sample: PreviewRow[] = [];
    const skippedSamples: { row: number; reason: string }[] = [];
    rows.forEach((r, i) => {
      const c = this.readProductRow(r, cols);
      if (!c.name) { toSkip++; if (skippedSamples.length < 10) skippedSamples.push({ row: i + 2, reason: 'sem nome' }); return; }
      const found = (!!c.code && byCode.has(c.code)) || (!!c.barcode && byBarcode.has(c.barcode));
      const action: PreviewRow['action'] = found ? 'UPDATE' : 'CREATE';
      if (action === 'CREATE') toCreate++; else toUpdate++;
      if (c.barcode) {
        withBarcode++;
        if (!isValidGtin(c.barcode)) { invalidBarcodes++; if (invalidExamples.length < 3) invalidExamples.push(c.barcode); }
      }
      if (c.barcodeWarning) sciNotation++;
      if (c.nameWasBarcode) nameAsBarcode++;
      if (c.barcodeHasLetters) { lettersBarcode++; if (lettersExamples.length < 3) lettersExamples.push(c.barcode); }
      if (c.stock !== null) { withStock++; stockTotal += c.stock; }
      if (c.stockWarning) negativeStock++;
      const key = c.code || c.barcode;
      if (key) { if (seen.has(key)) duplicatesInFile++; else seen.add(key); }
      if (sample.length < SAMPLE_SIZE) {
        sample.push({
          action,
          data: {
            name: c.name,
            code: c.code || (c.barcode ? '(= código de barras)' : '(gerado automaticamente)'),
            barcode: c.barcode || null,
            stock: c.stock,
            ...(c.perStore.length ? { lojas: c.perStore.map((p) => `${p.label}: ${p.value ?? '—'}`).join(' · ') } : {}),
            custo: c.cost,
            venda: c.sale,
          },
        });
      }
    });

    const warnings: string[] = [];
    if (!mapping.stock && !cols.storeStock.length) warnings.push('Não encontrei a coluna de STOCK — os produtos novos ficam com stock 0. Escolha a coluna em «Colunas reconhecidas».');
    else if (mapping.stock && withStock === 0) warnings.push(`A coluna de stock «${mapping.stock}» está vazia em todas as linhas — o stock não vai ser importado.`);
    if (!mapping.barcode && !cols.barcodeFromCode) warnings.push('Não encontrei a coluna de CÓDIGO DE BARRAS — o leitor não vai encontrar estes produtos. Escolha a coluna em «Colunas reconhecidas».');
    if (!mapping.salePrice) warnings.push('Não encontrei a coluna de PREÇO DE VENDA — os produtos ficam a 0 Kz.');
    if (sciNotation) warnings.push(`${sciNotation} código(s) de barras em notação científica (o Excel cortou os dígitos) — ficam SEM código de barras. Formate a coluna como Texto e exporte de novo.`);
    if (invalidBarcodes) warnings.push(`${invalidBarcodes} código(s) de barras com dígito de controlo inválido (ex.: ${invalidExamples.join(', ')}) — serão importados tal como estão; confirme no ficheiro.`);
    if (duplicatesInFile) warnings.push(`${duplicatesInFile} linha(s) repetem um código/código de barras já visto no ficheiro — a última vence.`);
    if (nameAsBarcode) warnings.push(`${nameAsBarcode} linha(s) têm um CÓDIGO DE BARRAS no lugar do nome (vem assim do ficheiro) — o número é usado como código de barras; corrija o nome depois em Produtos.`);
    if (lettersBarcode) warnings.push(`${lettersBarcode} código(s) de barras com letras (ex.: ${lettersExamples.join(', ')}) — não são EAN; mantidos tal como estão.`);
    if (cols.storeStock.length) {
      const stores = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<{ id: string; name: string }[]>(Prisma.sql`SELECT id, name FROM stores WHERE is_active = TRUE`));
      const miss = cols.storeStock.filter((c) => !matchStore(c.label, stores)).map((c) => `«${c.label}»`);
      if (miss.length) warnings.push(`Lojas do ficheiro sem correspondência na empresa: ${miss.join(', ')} — o stock dessas colunas soma-se ao total (crie a loja com o mesmo nome para separar).`);
    }
    if (negativeStock) warnings.push(`${negativeStock} linha(s) com stock negativo — tratadas como 0.`);

    return {
      kind: 'products', detectedColumns: mapping as Record<string, string>, unmappedColumns: unmapped, totalRows: rows.length,
      toCreate, toUpdate, toSkip, sample, skippedSamples,
      headers, notes: cols.notes, warnings,
      summary: { withBarcode, withStock, stockTotal: Math.round(stockTotal * 1000) / 1000, invalidBarcodes, duplicatesInFile },
    };
  }

  private async applyProducts(
    schema: string, headers: string[], rows: Record<string, unknown>[], actor: Actor, fileName?: string,
    storeId: string | null = null, override: Record<string, string> | null = null,
  ): Promise<MigrationApplyResult> {
    const cols = detectProductColumns(headers, rows, override);
    const { mapping } = cols;
    if (!mapping.name) throw new BadRequestException('Não encontrei a coluna de nome do produto.');
    let noBarcodeSci = 0, clampedStock = 0;
    let created = 0, updated = 0, skipped = 0;
    const errors: string[] = [];
    const stockRef = `Migração${fileName ? ` (${fileName})` : ''}`;

    // Loja escolhida: valida UMA vez (transacção curta) — nunca confia num id do
    // frontend. Se escolhida, lista TODAS as lojas ativas: um produto NOVO semeia
    // stock_items=0 nas outras lojas (preserva o invariante stock_qty = Σ stock_items).
    let targetStore: { id: string; name?: string } | null = null;
    let allActiveStores: { id: string; name: string }[] = [];
    if (storeId) {
      await this.prisma.runInTenant(schema, async (tx) => {
        const s = await tx.$queryRaw<{ id: string; name: string }[]>(Prisma.sql`SELECT id, name FROM stores WHERE id = ${storeId}::uuid AND is_active = TRUE LIMIT 1`);
        if (!s[0]) throw new BadRequestException('A loja escolhida não existe ou está inactiva.');
        targetStore = s[0];
        allActiveStores = await tx.$queryRaw<{ id: string; name: string }[]>(Prisma.sql`SELECT id, name FROM stores WHERE is_active = TRUE`);
      });
    }
    // Stock POR LOJA no ficheiro: sem loja escolhida e com TODAS as colunas a
    // corresponder a lojas da empresa, cada loja recebe o seu stock (por loja).
    let storeColMap: { label: string; storeId: string }[] = [];
    if (cols.storeStock.length) {
      if (!allActiveStores.length) {
        allActiveStores = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<{ id: string; name: string }[]>(Prisma.sql`SELECT id, name FROM stores WHERE is_active = TRUE`));
      }
      const matched = cols.storeStock.map((c) => ({ label: c.label, st: matchStore(c.label, allActiveStores) }));
      const chosen = targetStore as { id: string } | null;
      if (chosen) {
        // Loja escolhida: usa a coluna dessa loja (se existir); senão o total.
        const own = matched.find((x) => x.st?.id === chosen.id);
        storeColMap = own ? [{ label: own.label, storeId: chosen.id }] : [];
      } else if (matched.every((x) => x.st)) {
        storeColMap = matched.map((x) => ({ label: x.label, storeId: x.st!.id }));
      }
    }
    const perStoreMode = !targetStore && storeColMap.length > 0;
    const stockFor = (cells: ProductCells): number | null => {
      if (targetStore && storeColMap.length) return cells.perStore.find((p) => p.label === storeColMap[0].label)?.value ?? null;
      return cells.stock;
    };

    // Importa por LOTES — cada lote na sua transacção. Um lote que falhe por
    // inteiro (ex.: timeout) não perde os lotes anteriores nem trava os seguintes.
    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE, rows.length);
      let bCreated = 0, bUpdated = 0, bSkipped = 0;
      const bErrors: string[] = [];
      try {
        await this.prisma.runInTenant(schema, async (tx) => {
          // Cache de categorias por lote: recarregada do estado COMMITADO — se um
          // lote anterior falhou, ids de categorias dele não sobrevivem aqui.
          const catRows = await tx.$queryRaw<{ id: string; name: string }[]>(Prisma.sql`SELECT id, name FROM product_categories`);
          const catByName = new Map(catRows.map((c) => [c.name.trim().toLowerCase(), c.id]));

          for (let i = start; i < end; i++) {
            const r = rows[i];
            const cells = this.readProductRow(r, cols);
            const name = cells.name;
            if (!name) { bSkipped++; continue; }
            try {
          const code = cells.code;
          const barcode = cells.barcode;
          const stock = stockFor(cells);
          const costPrice = cells.cost;
          const salePrice = cells.sale;
          if (cells.barcodeWarning) noBarcodeSci++;
          if (cells.stockWarning) clampedStock++;

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
            if (perStoreMode && !existingRow.shared_stock) {
              for (const sc of storeColMap) {
                const v = cells.perStore.find((p) => p.label === sc.label)?.value;
                if (v !== null && v !== undefined) await this.setAbsoluteStock(tx, existingRow.id, sc.storeId, Math.max(0, v), stockRef);
              }
            } else if (stock !== null) {
              if (existingRow.shared_stock) {
                // Partilhado: continua a actualizar-se directo (pool central).
                sets.push(Prisma.sql`stock_qty = ${stock}`);
              } else if (targetStore) {
                // Por loja + o utilizador escolheu a loja: ajusta o saldo ABSOLUTO
                // dessa loja (fora do UPDATE — StockService também actualiza o
                // espelho stock_qty). Sem loja escolhida, nunca se mexe (evita
                // desfasar o livro por loja sem saber a qual loja pertence).
                await this.setAbsoluteStock(tx, existingRow.id, targetStore.id, Math.max(0, stock), stockRef);
              }
            }
            await tx.$executeRaw(Prisma.sql`UPDATE products SET ${Prisma.join(sets, ', ')} WHERE id = ${existingRow.id}::uuid`);
            bUpdated++;
          } else {
            const finalCode = code || barcode || generateInternalCode('MIG');
            const shared = !targetStore && !perStoreMode;
            const insertedRows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
              INSERT INTO products (code, barcode, name, category_id, iva_code, unit_price, cost_price, stock_qty, shared_stock, show_online)
              VALUES (${finalCode}, ${barcode || null}, ${name}, ${categoryId}::uuid, 'NOR', ${salePrice ?? 0}, ${costPrice ?? 0}, ${shared ? (stock ?? 0) : 0}, ${shared}, TRUE)
              RETURNING id`);
            if (perStoreMode) {
              // Stock por loja do ficheiro: cada loja recebe o seu valor; as outras 0.
              for (const st of allActiveStores) {
                const sc = storeColMap.find((x) => x.storeId === st.id);
                const v = sc ? cells.perStore.find((p) => p.label === sc.label)?.value ?? 0 : 0;
                await this.setAbsoluteStock(tx, insertedRows[0].id, st.id, Math.max(0, v ?? 0), stockRef);
              }
            } else if (targetStore) {
              // Por loja: semeia stock_items=0 em TODAS as lojas ativas e a
              // quantidade importada só na loja escolhida — preserva o invariante
              // stock_qty = Σ stock_items (igual à criação manual de produtos).
              for (const st of allActiveStores) {
                const qty = st.id === targetStore.id ? Math.max(0, stock ?? 0) : 0;
                await this.setAbsoluteStock(tx, insertedRows[0].id, st.id, qty, stockRef);
              }
            }
            bCreated++;
          }
            } catch (e) {
              bSkipped++;
              const msg = firstErrorLine(e);
              if (bErrors.length < 15) bErrors.push(`Linha ${i + 2} (${name}): ${msg.slice(0, 90)}`);
              this.logger.warn(`Migração de produtos falhou na linha ${i + 2}: ${msg}`);
            }
          }
        });
        // Lote commitado → consolida os contadores.
        created += bCreated; updated += bUpdated; skipped += bSkipped;
        for (const e of bErrors) if (errors.length < 15) errors.push(e);
      } catch (e) {
        // O LOTE inteiro falhou (rollback) — nada deste lote persistiu; os lotes
        // anteriores estão salvos e os seguintes continuam.
        skipped += end - start;
        const msg = firstErrorLine(e);
        if (errors.length < 15) errors.push(`Linhas ${start + 2}–${end + 1}: lote falhou (${msg.slice(0, 90)})`);
        this.logger.warn(`Migração de produtos: lote ${start + 2}–${end + 1} falhou por inteiro: ${msg}`);
      }
    }

    await this.audit.record(schema, {
      actorId: actor.id, actorName: actor.name, action: 'MIGRATION_IMPORT',
      entity: 'products', details: { fileName, created, updated, skipped },
    });
    const warnings: string[] = [];
    if (noBarcodeSci) warnings.push(`${noBarcodeSci} produto(s) ficaram SEM código de barras (notação científica no ficheiro).`);
    if (clampedStock) warnings.push(`${clampedStock} produto(s) tinham stock negativo — importados com 0.`);
    return { kind: 'products', created, updated, skipped, errors, warnings };
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

    // Por LOTES — cada lote na sua transacção (ver nota em BATCH_SIZE).
    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE, rows.length);
      let bCreated = 0, bUpdated = 0, bSkipped = 0;
      const bErrors: string[] = [];
      try {
        await this.prisma.runInTenant(schema, async (tx) => {
          for (let i = start; i < end; i++) {
            const r = rows[i];
            const name = String(r[mapping.name!] ?? '').trim();
            if (!name) { bSkipped++; continue; }
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
                bUpdated++;
              } else {
                const ins = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
                  INSERT INTO customers (tax_id, name, phone, email, address, notes)
                  VALUES (${taxId || null}, ${name}, ${phone || null}, ${email || null}, ${address || null}, ${newNote})
                  RETURNING id`);
                customerId = ins[0].id;
                bCreated++;
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
              bSkipped++;
              const msg = firstErrorLine(e);
              if (bErrors.length < 15) bErrors.push(`Linha ${i + 2} (${name}): ${msg.slice(0, 90)}`);
              this.logger.warn(`Migração de clientes falhou na linha ${i + 2}: ${msg}`);
            }
          }
        });
        created += bCreated; updated += bUpdated; skipped += bSkipped;
        for (const e of bErrors) if (errors.length < 15) errors.push(e);
      } catch (e) {
        skipped += end - start;
        const msg = firstErrorLine(e);
        if (errors.length < 15) errors.push(`Linhas ${start + 2}–${end + 1}: lote falhou (${msg.slice(0, 90)})`);
        this.logger.warn(`Migração de clientes: lote ${start + 2}–${end + 1} falhou por inteiro: ${msg}`);
      }
    }

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

    // Por LOTES — cada lote na sua transacção (ver nota em BATCH_SIZE).
    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE, rows.length);
      let bCreated = 0, bUpdated = 0, bSkipped = 0;
      const bErrors: string[] = [];
      try {
        await this.prisma.runInTenant(schema, async (tx) => {
          for (let i = start; i < end; i++) {
            const r = rows[i];
            const name = String(r[mapping.name!] ?? '').trim();
            if (!name) { bSkipped++; continue; }
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
                bUpdated++;
              } else {
                const code = generateInternalCode('FORN');
                const ins = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
                  INSERT INTO suppliers (code, name, nif, phone, email, address, notes)
                  VALUES (${code}, ${name}, ${taxId || null}, ${phone || null}, ${email || null}, ${address || null}, ${newNote})
                  RETURNING id`);
                supplierId = ins[0].id;
                bCreated++;
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
              bSkipped++;
              const msg = firstErrorLine(e);
              if (bErrors.length < 15) bErrors.push(`Linha ${i + 2} (${name}): ${msg.slice(0, 90)}`);
              this.logger.warn(`Migração de fornecedores falhou na linha ${i + 2}: ${msg}`);
            }
          }
        });
        created += bCreated; updated += bUpdated; skipped += bSkipped;
        for (const e of bErrors) if (errors.length < 15) errors.push(e);
      } catch (e) {
        skipped += end - start;
        const msg = firstErrorLine(e);
        if (errors.length < 15) errors.push(`Linhas ${start + 2}–${end + 1}: lote falhou (${msg.slice(0, 90)})`);
        this.logger.warn(`Migração de fornecedores: lote ${start + 2}–${end + 1} falhou por inteiro: ${msg}`);
      }
    }

    await this.audit.record(schema, {
      actorId: actor.id, actorName: actor.name, action: 'MIGRATION_IMPORT',
      entity: 'suppliers', details: { fileName, created, updated, skipped },
    });
    return { kind: 'suppliers', created, updated, skipped, errors };
  }
}
