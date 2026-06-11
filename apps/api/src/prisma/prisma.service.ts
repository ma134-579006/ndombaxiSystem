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

/**
 * Garante um POOL CONTIDO de ligações: o Postgres gerido (Aiven) tem poucas
 * "slots"; durante um deploy correm 2 instâncias em simultâneo e, sem limite,
 * o pool por omissão do Prisma esgota-as — a instância nova não consegue
 * arrancar e o deploy fica preso na versão antiga. `connection_limit` no URL
 * resolve de raiz (cada instância usa no máximo 5 ligações).
 */
function withPoolLimits(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '5');
    if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', '30');
    if (!u.searchParams.has('connect_timeout')) u.searchParams.set('connect_timeout', '20');
    // MULTI-TENANT: a mesma ligação salta entre schemas (search_path) e cada
    // tenant tem tabelas com formas ligeiramente diferentes (drift natural das
    // migrações). Com cache de prepared statements, o PostgreSQL rebenta com
    // `0A000: cached plan must not change result type` (ex.: login por e-mail
    // que percorre os tenants). Desligar a cache resolve DE RAIZ.
    if (!u.searchParams.has('statement_cache_size')) u.searchParams.set('statement_cache_size', '0');
    return u.toString();
  } catch {
    return url; // URL inválido → deixa o Prisma reportar o erro original
  }
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ datasources: { db: { url: withPoolLimits(process.env.DATABASE_URL) } } });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected to PostgreSQL (pool contido: máx. 5 ligações)');
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
    return this.$transaction(
      async (tx) => {
        // schema já validado contra regex — seguro para interpolação de identifier
        await tx.$executeRawUnsafe(
          `SET LOCAL search_path TO "${schema}", nexus_public`,
        );
        return fn(tx);
      },
      // Timeout alargado para tolerar a latência de uma BD na nuvem em
      // operações mais pesadas (SAF-T, processamento salarial). O default do
      // Prisma (5s) é curto quando a BD não é local.
      { timeout: 30_000, maxWait: 10_000 },
    );
  }
}
