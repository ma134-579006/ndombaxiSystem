import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaPGlite } from '@nexus/prisma-adapter-pglite';

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

/** A API corre EMBUTIDA (base dentro do próprio aparelho)? */
export function isEmbeddedEngine(): boolean {
  return (process.env.DATABASE_ENGINE ?? '').toLowerCase() === 'pglite';
}

/**
 * Escolhe o motor. É UMA decisão, tomada por quem arranca a aplicação.
 *
 * • por omissão → PostgreSQL por TCP (nuvem e posto Windows). **Nada muda.**
 * • `DATABASE_ENGINE=pglite` → a base vive DENTRO do processo, sem servidor e
 *   sem porta aberta. É o modo do telemóvel.
 *
 * O PGlite é carregado só quando é pedido: assim a imagem da nuvem não leva o
 * WASM do PostgreSQL (mais de 100 MB) para nada.
 */
function criarAdapter(logger: Logger): PrismaPg | PrismaPGlite {
  if (!isEmbeddedEngine()) {
    return new PrismaPg({ connectionString: withPoolLimits(process.env.DATABASE_URL) });
  }

  const dataDir = process.env.PGLITE_DATA_DIR;
  if (!dataDir) {
    // Sem pasta, o PGlite guarda tudo em memória — e ao fechar a app as vendas
    // do dia desapareciam. Antes falhar aqui, à vista, do que perder o dia.
    throw new Error('DATABASE_ENGINE=pglite exige PGLITE_DATA_DIR (a pasta onde a base fica gravada).');
  }

  // `require` e não `import`: o pacote do PGlite só tem de existir no aparelho.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PGlite } = require('@electric-sql/pglite') as {
    PGlite: { create(opts: { dataDir: string }): Promise<unknown> };
  };
  logger.log(`Motor EMBUTIDO (PGlite) — base em ${dataDir}, sem servidor e sem porta aberta`);
  return new PrismaPGlite(() => PGlite.create({ dataDir }) as never, { schema: 'nexus_public' });
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // A ligação passa a entrar por um ADAPTER, e não por um `url` no esquema
    // (Prisma 7). Parece uma formalidade e não é: é o que permite a MESMA API
    // correr sobre o PostgreSQL da nuvem, sobre o PostgreSQL portátil de um
    // posto Windows e — é este o objetivo — sobre o PGlite dentro de um
    // telemóvel, onde não existe motor nativo do Prisma. Trocar de motor deixa
    // de ser uma reescrita e passa a ser trocar esta linha.
    super({ adapter: criarAdapter(new Logger(PrismaService.name)) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log(
      isEmbeddedEngine()
        ? 'Prisma ligado ao PGlite EM PROCESSO (sessão única — operações seriadas)'
        : 'Prisma connected to PostgreSQL (pool contido: máx. 5 ligações)',
    );
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
