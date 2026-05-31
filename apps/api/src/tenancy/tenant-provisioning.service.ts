import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PrismaService, assertValidSchemaName } from '../prisma/prisma.service';

/**
 * Provisiona e remove os schemas PostgreSQL isolados de cada tenant (§3.1, §3.3).
 */
@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);
  private readonly templatePath = join(
    process.cwd(),
    'prisma',
    'tenant_template.sql',
  );

  constructor(private readonly prisma: PrismaService) {}

  /** Gera um nome de schema único: tenant_<8 hex>. */
  generateSchemaName(): string {
    return `tenant_${randomBytes(4).toString('hex')}`;
  }

  /** Cria o schema do tenant aplicando o template DDL. */
  async createTenantSchema(schema: string): Promise<void> {
    assertValidSchemaName(schema);
    const template = readFileSync(this.templatePath, 'utf-8');
    const ddl = template.replaceAll('{{SCHEMA}}', schema);

    // Divide em statements e executa em sequência dentro de uma transacção.
    const statements = ddl
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    await this.prisma.$transaction(async (tx) => {
      for (const stmt of statements) {
        await tx.$executeRawUnsafe(stmt);
      }
    });
    this.logger.log(`Tenant schema provisioned: ${schema}`);
  }

  /** Remove completamente o schema do tenant (§2.2 — excluir empresa). */
  async dropTenantSchema(schema: string): Promise<void> {
    assertValidSchemaName(schema);
    await this.prisma.$executeRawUnsafe(
      `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
    );
    this.logger.warn(`Tenant schema dropped: ${schema}`);
  }
}
