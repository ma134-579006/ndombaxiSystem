import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

/** Identificador de schema válido: tenant_xxxxx (hex) ou nexus_public. */
const SCHEMA_NAME_RE = /^(nexus_public|tenant_[a-z0-9]{8,})$/;

export function assertValidSchemaName(schema: string): void {
  if (!SCHEMA_NAME_RE.test(schema)) {
    throw new Error(`Invalid tenant schema name: ${schema}`);
  }
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Executa `fn` numa transacção com `search_path` fixado ao schema do tenant.
   * Garante o isolamento de dados (§3.1) — qualquer query raw dentro de `fn`
   * só vê o schema do tenant + nexus_public.
   */
  async runInTenant<T>(
    schema: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    assertValidSchemaName(schema);
    return this.$transaction(async (tx) => {
      // schema já validado contra regex — seguro para interpolação de identifier
      await tx.$executeRawUnsafe(
        `SET LOCAL search_path TO "${schema}", nexus_public`,
      );
      return fn(tx);
    });
  }
}
