import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PrismaService, assertValidSchemaName } from '../prisma/prisma.service';

/**
 * Provisiona e remove os schemas PostgreSQL isolados de cada tenant (§3.1, §3.3).
 */
@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve o caminho do tenant_template.sql de forma robusta.
   *
   * BUG histórico: usar `join(process.cwd(), 'prisma', ...)` funcionava em dev
   * (cwd = apps/api) mas FALHAVA em produção — a Render arranca
   * `node apps/api/dist/main.js` a partir da RAIZ do repo, logo process.cwd()
   * é a raiz e o template (em apps/api/prisma) não era encontrado →
   * readFileSync lançava ENOENT → "Falha ao provisionar a empresa".
   *
   * Solução: tentar vários candidatos (relativos ao ficheiro compilado e ao
   * cwd) e usar o primeiro que existir.
   */
  private resolveTemplatePath(): string {
    const candidates = [
      join(__dirname, '..', '..', 'prisma', 'tenant_template.sql'), // dist/tenancy → apps/api/prisma
      join(__dirname, '..', 'prisma', 'tenant_template.sql'),
      join(process.cwd(), 'prisma', 'tenant_template.sql'), // cwd = apps/api (dev)
      join(process.cwd(), 'apps', 'api', 'prisma', 'tenant_template.sql'), // cwd = raiz do repo
    ];
    const found = candidates.find((p) => existsSync(p));
    if (!found) {
      throw new Error(
        `tenant_template.sql não encontrado. Caminhos testados: ${candidates.join(' | ')}`,
      );
    }
    return found;
  }

  /** Gera um nome de schema único: tenant_<8 hex>. */
  generateSchemaName(): string {
    return `tenant_${randomBytes(4).toString('hex')}`;
  }

  /** Cria o schema do tenant aplicando o template DDL. */
  async createTenantSchema(schema: string): Promise<void> {
    assertValidSchemaName(schema);
    const template = readFileSync(this.resolveTemplatePath(), 'utf-8');
    const ddl = template.replaceAll('{{SCHEMA}}', schema);

    // Remove comentários LINHA-A-LINHA *antes* de dividir por ';'. Crítico:
    // se removêssemos só os statements que começam por '--', um statement
    // multi-linha precedido de comentário (ex.: a linha de comentário + o
    // CREATE TABLE seguinte) começava por '--' e era descartado INTEIRO —
    // foi o que apagava o CREATE SCHEMA e ~metade das tabelas, fazendo o
    // provisioning falhar com "schema does not exist".
    const stripped = ddl
      .split('\n')
      .map((line) => {
        const i = line.indexOf('--');
        return i >= 0 ? line.slice(0, i) : line;
      })
      .join('\n');

    const statements = stripped
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Timeout alargado: são ~45 statements DDL e, contra uma BD na nuvem
    // (ex.: Aiven/Neon), a latência de rede facilmente ultrapassa os 5s por
    // omissão do Prisma. É uma operação de setup única, por isso 60s é seguro.
    await this.prisma.$transaction(
      async (tx) => {
        for (const stmt of statements) {
          await tx.$executeRawUnsafe(stmt);
        }
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    this.logger.log(`Tenant schema provisioned: ${schema} (${statements.length} statements)`);
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
