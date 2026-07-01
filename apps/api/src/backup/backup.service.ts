import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { gzipSync, gunzipSync } from 'node:zlib';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAuditService } from '../cashbox/tenant-audit.service';

const BACKUP_FORMAT = 'ndombaxi-backup';
const BACKUP_VERSION = 1;
const MAX_CONTENT_BYTES = 15 * 1024 * 1024; // 15MB — o corpo HTTP aceita 20MB (main.ts)
const MAX_BACKUPS_KEPT = 15; // retenção — evita crescimento sem limite na BD

/**
 * Tabelas de GESTÃO incluídas no backup. NUNCA inclui `users` (password/PIN/2FA —
 * credenciais nunca saem da BD) nem tabelas transacionais de grande volume; as
 * facturas já são imutáveis e protegidas pela cadeia de hash + SAF-T (DP 71/25),
 * por isso não precisam deste mecanismo.
 */
const BACKUP_TABLES = [
  'product_categories', 'products', 'product_recipes', 'product_batches',
  'stores', 'stock_items', 'customers', 'suppliers',
  'receivables', 'payables', 'employees', 'site_settings',
] as const;

interface BackupDump {
  format: string;
  version: number;
  generatedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export interface BackupMeta {
  id: string;
  kind: string;
  created_at: Date;
  created_by_name: string | null;
  size_bytes: number;
  tables_meta: Record<string, number>;
}

export interface RestorePreview {
  valid: boolean;
  generatedAt?: string;
  tables: { table: string; rows: number; toInsert: number; toUpdate: number }[];
}

export interface RestoreTableResult { table: string; inserted: number; updated: number; failed: number; errors: string[] }
export interface RestoreResult { applied: boolean; tables: RestoreTableResult[] }

interface ColumnInfo { name: string; dataType: string }

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: TenantAuditService,
  ) {}

  // ── Criação do backup (manual ou automático) ────────────────────────────
  async create(
    schema: string,
    actor: { id?: string | null; name?: string | null },
    kind: 'MANUAL' | 'AUTO' = 'MANUAL',
  ): Promise<BackupMeta> {
    const dump = await this.dumpTables(schema);
    const b64 = gzipSync(Buffer.from(JSON.stringify(dump), 'utf-8')).toString('base64');
    if (Buffer.byteLength(b64) > MAX_CONTENT_BYTES) {
      throw new BadRequestException(
        'Os dados desta empresa são demasiado extensos para um backup nesta versão. Contacte o suporte.',
      );
    }
    const tablesMeta: Record<string, number> = {};
    for (const t of BACKUP_TABLES) tablesMeta[t] = dump.tables[t]?.length ?? 0;

    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ id: string; created_at: Date }[]>(
        Prisma.sql`INSERT INTO backups (kind, created_by, created_by_name, size_bytes, tables_meta, content_b64)
          VALUES (${kind}, ${actor.id ?? null}::uuid, ${actor.name ?? null}, ${Buffer.byteLength(b64)},
                  ${JSON.stringify(tablesMeta)}::jsonb, ${b64})
          RETURNING id, created_at`),
    );

    await this.audit.record(schema, {
      actorId: actor.id, actorName: actor.name,
      action: kind === 'AUTO' ? 'BACKUP_AUTO' : 'BACKUP_MANUAL',
      entity: 'backup', entityId: rows[0].id,
      details: { tablesMeta, sizeBytes: Buffer.byteLength(b64) },
    });

    await this.prune(schema);

    if (kind === 'AUTO') {
      await this.prisma.runInTenant(schema, (tx) =>
        tx.$executeRaw(Prisma.sql`UPDATE site_settings SET backup_last_at = now()`));
    }

    return {
      id: rows[0].id, kind, created_at: rows[0].created_at, created_by_name: actor.name ?? null,
      size_bytes: Buffer.byteLength(b64), tables_meta: tablesMeta,
    };
  }

  /** Lê todas as tabelas de gestão do tenant. Tabela em falta (tenant muito
   *  antigo) → lista vazia, nunca bloqueia o backup. */
  private async dumpTables(schema: string): Promise<BackupDump> {
    const tables: Record<string, Record<string, unknown>[]> = {};
    await this.prisma.runInTenant(schema, async (tx) => {
      for (const t of BACKUP_TABLES) {
        try {
          tables[t] = await tx.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${schema}"."${t}"`);
        } catch {
          tables[t] = [];
        }
      }
    });
    return { format: BACKUP_FORMAT, version: BACKUP_VERSION, generatedAt: new Date().toISOString(), tables };
  }

  /** Mantém só os últimos N backups. */
  private async prune(schema: string): Promise<void> {
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`
        DELETE FROM backups WHERE id IN (
          SELECT id FROM backups ORDER BY created_at DESC OFFSET ${MAX_BACKUPS_KEPT})`),
    );
  }

  // ── Listagem / download / remoção ───────────────────────────────────────
  list(schema: string): Promise<BackupMeta[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<BackupMeta[]>(Prisma.sql`
        SELECT id, kind, created_at, created_by_name, size_bytes, tables_meta
        FROM backups ORDER BY created_at DESC LIMIT 50`),
    );
  }

  async download(schema: string, id: string): Promise<{ content: string; fileName: string }> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ content_b64: string; created_at: Date }[]>(
        Prisma.sql`SELECT content_b64, created_at FROM backups WHERE id = ${id}::uuid`),
    );
    if (!rows[0]) throw new BadRequestException('Backup não encontrado.');
    const stamp = rows[0].created_at.toISOString().slice(0, 10);
    return { content: rows[0].content_b64, fileName: `ndombaxi-backup-${stamp}.ndbak` };
  }

  async remove(schema: string, id: string): Promise<void> {
    await this.prisma.runInTenant(schema, (tx) => tx.$executeRaw(Prisma.sql`DELETE FROM backups WHERE id = ${id}::uuid`));
  }

  // ── Configuração do backup automático (agendado) ────────────────────────
  async getSettings(schema: string) {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ backup_auto_enabled: boolean; backup_frequency: string; backup_last_at: Date | null }[]>(
        Prisma.sql`SELECT backup_auto_enabled, backup_frequency, backup_last_at FROM site_settings LIMIT 1`),
    );
    const r = rows[0];
    return { autoEnabled: r?.backup_auto_enabled ?? false, frequency: r?.backup_frequency ?? 'DAILY', lastAt: r?.backup_last_at ?? null };
  }

  async updateSettings(schema: string, dto: { autoEnabled?: boolean; frequency?: string }) {
    const sets: Prisma.Sql[] = [];
    if (dto.autoEnabled !== undefined) sets.push(Prisma.sql`backup_auto_enabled = ${dto.autoEnabled}`);
    if (dto.frequency !== undefined) sets.push(Prisma.sql`backup_frequency = ${dto.frequency}`);
    if (sets.length) {
      await this.prisma.runInTenant(schema, (tx) => tx.$executeRaw(Prisma.sql`UPDATE site_settings SET ${Prisma.join(sets, ', ')}`));
    }
    return this.getSettings(schema);
  }

  // ── Restauro (próprio formato Ndombaxi) ──────────────────────────────────
  private decode(contentBase64: string): BackupDump {
    let json: string;
    try { json = gunzipSync(Buffer.from(contentBase64, 'base64')).toString('utf-8'); }
    catch { throw new BadRequestException('Ficheiro de backup inválido ou corrompido.'); }
    let data: unknown;
    try { data = JSON.parse(json); } catch { throw new BadRequestException('Ficheiro de backup inválido.'); }
    const d = data as Partial<BackupDump>;
    if (d.format !== BACKUP_FORMAT || typeof d.tables !== 'object' || !d.tables) {
      throw new BadRequestException('Este ficheiro não é um backup do Ndombaxi System.');
    }
    return d as BackupDump;
  }

  /** Pré-visualização: quantas linhas vão ser criadas/actualizadas — SEM tocar na BD. */
  async previewRestore(schema: string, contentBase64: string): Promise<RestorePreview> {
    const dump = this.decode(contentBase64);
    const tables: RestorePreview['tables'] = [];
    await this.prisma.runInTenant(schema, async (tx) => {
      for (const t of BACKUP_TABLES) {
        const rows = dump.tables[t] ?? [];
        if (!rows.length) { tables.push({ table: t, rows: 0, toInsert: 0, toUpdate: 0 }); continue; }
        const ids = rows.map((r) => r.id).filter((v): v is string => typeof v === 'string');
        let existing = 0;
        if (ids.length) {
          try {
            const cnt = await tx.$queryRawUnsafe<{ n: number }[]>(
              `SELECT COUNT(*)::int AS n FROM "${schema}"."${t}" WHERE id = ANY($1::uuid[])`, ids);
            existing = cnt[0]?.n ?? 0;
          } catch { existing = 0; }
        }
        tables.push({ table: t, rows: rows.length, toInsert: rows.length - existing, toUpdate: existing });
      }
    });
    return { valid: true, generatedAt: dump.generatedAt, tables };
  }

  /**
   * Aplica o restauro: UPSERT por `id` (nunca apaga nada). Uma linha com erro
   * fica isolada — nunca interrompe as restantes nem as outras tabelas.
   * `storeId`: se a LOJA de origem de uma linha de stock (no backup) já não
   * existir neste tenant, redirecciona-a para a loja escolhida — sem escolha,
   * essa linha falha isoladamente (não afecta as restantes).
   */
  async applyRestore(
    schema: string, contentBase64: string, actor: { id?: string | null; name?: string | null }, storeId?: string | null,
  ): Promise<RestoreResult> {
    const dump = this.decode(contentBase64);
    await this.redirectMissingStores(schema, dump, storeId);
    const tables: RestoreTableResult[] = [];
    for (const t of BACKUP_TABLES) {
      const rows = dump.tables[t] ?? [];
      tables.push(rows.length ? await this.upsertRows(schema, t, rows) : { table: t, inserted: 0, updated: 0, failed: 0, errors: [] });
    }
    await this.audit.record(schema, {
      actorId: actor.id, actorName: actor.name, action: 'BACKUP_RESTORED', entity: 'backup',
      details: { summary: tables.map((r) => ({ table: r.table, inserted: r.inserted, updated: r.updated, failed: r.failed })) },
    });
    return { applied: true, tables };
  }

  /** Redirecciona linhas de `stock_items` cuja loja de origem já não existe
   *  neste tenant para a loja escolhida (mutação em memória do dump, ANTES do
   *  upsert genérico — nunca toca na BD aqui). */
  private async redirectMissingStores(schema: string, dump: BackupDump, storeId?: string | null): Promise<void> {
    const rows = dump.tables['stock_items'];
    if (!rows?.length) return;
    const active = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM stores WHERE is_active = TRUE`));
    const activeIds = new Set(active.map((s) => s.id));
    if (!storeId || !activeIds.has(storeId)) return; // sem loja válida escolhida — deixa o upsert falhar isoladamente
    dump.tables['stock_items'] = rows.map((row) => {
      const wid = row.warehouse_id != null ? String(row.warehouse_id) : '';
      return activeIds.has(wid) ? row : { ...row, warehouse_id: storeId };
    });
  }

  /**
   * UPSERT genérico por `id`, DIRIGIDO PELO SCHEMA REAL (nunca assume tipos):
   * lê as colunas + tipo de cada uma via information_schema, cast `::uuid`
   * para colunas uuid e `::jsonb`/`::json` para colunas JSON — sem isto, um
   * INSERT com um valor jsonb em texto simples falharia (ou pior, um valor
   * uuid mal tipado rebentaria como já aconteceu antes com `uuid = text`).
   */
  private async upsertRows(schema: string, table: string, rows: Record<string, unknown>[]): Promise<RestoreTableResult> {
    let inserted = 0, updated = 0, failed = 0;
    const errors: string[] = [];
    await this.prisma.runInTenant(schema, async (tx) => {
      let colInfo: ColumnInfo[];
      try {
        const raw = await tx.$queryRawUnsafe<{ column_name: string; data_type: string }[]>(
          `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='${schema}' AND table_name='${table}'`);
        colInfo = raw.map((c) => ({ name: c.column_name, dataType: c.data_type }));
      } catch { colInfo = []; }
      if (!colInfo.length) { errors.push(`tabela "${table}" não existe neste tenant — ignorada`); return; }
      const byName = new Map(colInfo.map((c) => [c.name, c]));

      for (const row of rows) {
        const cols = Object.keys(row).filter((c) => byName.has(c));
        if (!cols.includes('id') || !row.id) { failed++; errors.push('linha sem id — ignorada'); continue; }
        try {
          const existsRows = await tx.$queryRawUnsafe<{ n: number }[]>(
            `SELECT COUNT(*)::int AS n FROM "${schema}"."${table}" WHERE id = $1::uuid`, row.id);
          const exists = (existsRows[0]?.n ?? 0) > 0;

          const castFor = (col: string): string => {
            const dt = byName.get(col)?.dataType ?? '';
            if (dt === 'uuid') return '::uuid';
            if (dt === 'jsonb') return '::jsonb';
            if (dt === 'json') return '::json';
            return '';
          };
          const values = cols.map((c) => {
            const v = row[c];
            const dt = byName.get(c)?.dataType ?? '';
            if ((dt === 'jsonb' || dt === 'json') && v !== null && typeof v !== 'string') return JSON.stringify(v);
            return v;
          });
          const colList = cols.map((c) => `"${c}"`).join(', ');
          const placeholders = cols.map((c, i) => `$${i + 1}${castFor(c)}`).join(', ');
          const updateSet = cols.filter((c) => c !== 'id').map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
          const sql = updateSet
            ? `INSERT INTO "${schema}"."${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updateSet}`
            : `INSERT INTO "${schema}"."${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`;
          await tx.$executeRawUnsafe(sql, ...values);
          if (exists) updated++; else inserted++;
        } catch (e) {
          failed++;
          const msg = e instanceof Error ? e.message : 'erro desconhecido';
          if (errors.length < 10) errors.push(`${String(row.id).slice(0, 8)}…: ${msg.slice(0, 90)}`);
          this.logger.warn(`Restauro falhou em ${table}/${String(row.id).slice(0, 8)}: ${msg}`);
        }
      }
    });
    return { table, inserted, updated, failed, errors };
  }
}
