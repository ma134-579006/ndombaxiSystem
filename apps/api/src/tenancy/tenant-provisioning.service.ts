import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PrismaService, assertValidSchemaName } from '../prisma/prisma.service';

/**
 * Provisiona, migra e remove os schemas PostgreSQL isolados de cada tenant
 * (§3.1, §3.3). No arranque, alinha automaticamente todos os tenants existentes
 * com o template atual (auto-cura de "deriva de schema").
 */
@Injectable()
export class TenantProvisioningService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TenantProvisioningService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve um ficheiro SQL em `prisma/` de forma robusta.
   *
   * BUG histórico: usar `process.cwd()` falhava em produção — a Render arranca
   * `node apps/api/dist/main.js` a partir da RAIZ do repo, logo o template (em
   * apps/api/prisma) não era encontrado → "Falha ao provisionar a empresa".
   * Solução: tentar candidatos relativos ao ficheiro compilado e ao cwd.
   */
  private resolvePrismaFile(name: string): string {
    const candidates = [
      join(__dirname, '..', '..', 'prisma', name), // dist/tenancy → apps/api/prisma
      join(__dirname, '..', 'prisma', name),
      join(process.cwd(), 'prisma', name), // cwd = apps/api (dev)
      join(process.cwd(), 'apps', 'api', 'prisma', name), // cwd = raiz do repo
    ];
    const found = candidates.find((p) => existsSync(p));
    if (!found) throw new Error(`${name} não encontrado. Testado: ${candidates.join(' | ')}`);
    return found;
  }

  /** Lê um ficheiro SQL, substitui {{SCHEMA}}, remove comentários e divide em statements. */
  private statementsFromFile(name: string, schema: string): string[] {
    const raw = readFileSync(this.resolvePrismaFile(name), 'utf-8').replaceAll('{{SCHEMA}}', schema);
    // Remove comentários linha-a-linha ANTES de dividir por ';' (um statement
    // multi-linha precedido de comentário não pode ser descartado inteiro).
    const stripped = raw
      .split('\n')
      .map((line) => { const i = line.indexOf('--'); return i >= 0 ? line.slice(0, i) : line; })
      .join('\n');
    return stripped.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
  }

  /** Gera um nome de schema único: tenant_<8 hex>. */
  generateSchemaName(): string {
    return `tenant_${randomBytes(4).toString('hex')}`;
  }

  /** Cria o schema do tenant aplicando o template DDL (atómico). */
  async createTenantSchema(schema: string): Promise<void> {
    assertValidSchemaName(schema);
    const statements = this.statementsFromFile('tenant_template.sql', schema);
    await this.prisma.$transaction(
      async (tx) => {
        for (const stmt of statements) await tx.$executeRawUnsafe(stmt);
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    this.logger.log(`Tenant schema provisioned: ${schema} (${statements.length} statements)`);
  }

  /**
   * Alinha um schema existente com o template atual (idempotente):
   *  • reaplica o template → cria TABELAS em falta (CREATE ... IF NOT EXISTS);
   *  • aplica as migrações → adiciona COLUNAS em falta (ALTER ... ADD COLUMN IF NOT EXISTS).
   * Best-effort por statement: um statement que falhe não impede os restantes.
   */
  async ensureSchema(schema: string): Promise<{ applied: number; failed: number }> {
    assertValidSchemaName(schema);
    const statements = [
      ...this.statementsFromFile('tenant_template.sql', schema),
      ...this.statementsFromFile('tenant_migrations.sql', schema),
    ];
    let applied = 0;
    let failed = 0;
    for (const stmt of statements) {
      try { await this.prisma.$executeRawUnsafe(stmt); applied += 1; }
      catch (err) {
        failed += 1;
        this.logger.debug(`ensureSchema(${schema}) stmt falhou: ${err instanceof Error ? err.message : 'erro'}`);
      }
    }
    return { applied, failed };
  }

  /** Remove completamente o schema do tenant (§2.2 — excluir empresa). */
  async dropTenantSchema(schema: string): Promise<void> {
    assertValidSchemaName(schema);
    await this.prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    this.logger.warn(`Tenant schema dropped: ${schema}`);
  }

  /** Lista todos os schemas de tenant. */
  async listTenantSchemas(): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ schema_name: string }[]>(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%' ORDER BY schema_name`,
    );
    return rows.map((r) => r.schema_name);
  }

  /** Migra TODOS os tenants para o template atual (auto-cura da deriva de schema). */
  async migrateAllTenants(): Promise<void> {
    let schemas: string[];
    try { schemas = await this.listTenantSchemas(); }
    catch (err) { this.logger.warn(`Não consegui listar tenants p/ migração: ${err instanceof Error ? err.message : 'erro'}`); return; }
    this.logger.log(`Auto-migração de ${schemas.length} tenant(s)…`);
    let ok = 0;
    for (const schema of schemas) {
      try { await this.ensureSchema(schema); ok += 1; }
      catch (err) { this.logger.warn(`Migração falhou em ${schema}: ${err instanceof Error ? err.message : 'erro'}`); }
    }
    this.logger.log(`Auto-migração concluída: ${ok}/${schemas.length} tenant(s) alinhados.`);
  }

  /**
   * Backfill único: marca as subscrições de TESTE GRÁTIS já existentes como
   * `isTrial` para que a sua validade passe a ser DINÂMICA (startsAt + trialDays
   * actuais). Sem isto, só as novas empresas teriam o trial dinâmico.
   */
  async backfillTrialFlags(): Promise<void> {
    try {
      const r = await this.prisma.subscription.updateMany({
        where: { isTrial: false, amountKz: 0, durationMonths: 0, status: 'ACTIVE', reviewNote: { startsWith: 'Período de teste' } },
        data: { isTrial: true },
      });
      if (r.count > 0) this.logger.log(`Backfill: ${r.count} subscrição(ões) de teste marcadas como dinâmicas.`);
    } catch (err) {
      this.logger.warn(`Backfill de trials falhou: ${err instanceof Error ? err.message : 'erro'}`);
    }
  }

  /** No arranque, alinha os tenants em segundo plano (não bloqueia o boot). */
  onApplicationBootstrap(): void {
    setTimeout(() => { void this.migrateAllTenants(); void this.backfillTrialFlags(); }, 3_000);
  }
}
