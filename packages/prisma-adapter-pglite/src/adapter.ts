/**
 * O adapter que liga o Prisma 7 ao PGlite EM PROCESSO.
 *
 * Porque existe: o Prisma não tem motor para Android (os alvos são
 * `linux-arm64` e `linux-musl-arm64` — o Bionic do telemóvel não está lá), e o
 * adapter oficial do PostgreSQL fala por TCP. O caminho por socket já foi
 * tentado e não serve: o PGlite é UMA sessão só, não repõe o estado entre
 * ligações (`42P05: prepared statement "s0" already exists`) e a transação
 * interativa do Prisma morre a meio. Falar com o PGlite dentro do MESMO
 * processo remove o socket da equação — e é a única forma de a MESMA API
 * correr dentro do aparelho.
 *
 * A consequência a ter presente: o PGlite é uma sessão única, logo as
 * operações são SERIADAS. Não é um pool. Num posto de venda — um utilizador,
 * um aparelho — isso é o comportamento certo; num servidor com muitos
 * pedidos em paralelo, não é.
 */
import {
  DriverAdapterError,
  type ConnectionInfo,
  type IsolationLevel,
  type SqlDriverAdapter,
  type SqlDriverAdapterFactory,
  type SqlQuery,
  type SqlQueryable,
  type SqlResultSet,
  type Transaction,
  type TransactionOptions,
} from '@prisma/driver-adapter-utils';
import { convertDriverError } from './errors';
import { fieldToColumnType, mapArg, parsers, UnsupportedNativeDataType } from './conversion';

const ADAPTER_NAME = '@nexus/prisma-adapter-pglite';

/**
 * O mínimo que precisamos do PGlite, escrito à mão.
 *
 * De propósito NÃO se importa `@electric-sql/pglite` aqui: o pacote compila e
 * é analisável sem ele, e quem embrulha a app para Android escolhe a versão do
 * PGlite que quer levar (o WASM é o ficheiro mais pesado do APK).
 */
export interface PGliteResults {
  rows: unknown[][];
  affectedRows?: number;
  fields: { name: string; dataTypeID: number }[];
}

export interface PGliteQueryOptions {
  rowMode?: 'array' | 'object';
  parsers?: Record<number, (value: string) => unknown>;
}

export interface PGliteTransactionLike {
  query<T = unknown>(sql: string, params?: unknown[], options?: PGliteQueryOptions): Promise<PGliteResults & { rows: T[] }>;
  exec(sql: string, options?: PGliteQueryOptions): Promise<PGliteResults[]>;
  rollback(): Promise<void>;
}

export interface PGliteLike {
  query<T = unknown>(sql: string, params?: unknown[], options?: PGliteQueryOptions): Promise<PGliteResults & { rows: T[] }>;
  exec(sql: string, options?: PGliteQueryOptions): Promise<PGliteResults[]>;
  transaction<T>(fn: (tx: PGliteTransactionLike) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export type PrismaPGliteOptions = {
  /** Schema por omissão anunciado ao Prisma (ex.: `nexus_public`). */
  schema?: string;
  /**
   * Rede de segurança: se uma transação ficar aberta este tempo sem que o
   * Prisma a feche, é desfeita. Sem isto, um `await` esquecido dentro de uma
   * transação tranca a ÚNICA sessão do PGlite e a app do lojista fica parada
   * sem explicação — e a base é a memória do próprio aparelho, não há outro
   * processo a quem pedir ajuda. Deve ser MAIOR que o timeout do Prisma
   * (a API usa 30 s), para ser sempre o último recurso.
   */
  transactionTimeoutMs?: number;
  /** Fechar o PGlite quando o Prisma se desligar (só se fomos nós a abri-lo). */
  closeOnDispose?: boolean;
};

const DEFAULT_TRANSACTION_TIMEOUT_MS = 120_000;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Só estes são níveis de isolamento do PostgreSQL (SNAPSHOT é do SQL Server). */
const ISOLATION_LEVELS = new Set<string>([
  'READ UNCOMMITTED',
  'READ COMMITTED',
  'REPEATABLE READ',
  'SERIALIZABLE',
]);

abstract class PGliteQueryable implements SqlQueryable {
  readonly provider = 'postgres';
  readonly adapterName = ADAPTER_NAME;

  protected abstract run(query: SqlQuery): Promise<PGliteResults>;

  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    const { fields, rows } = await this.run(query);
    let columnTypes;
    try {
      columnTypes = fields.map((f) => fieldToColumnType(f.dataTypeID));
    } catch (e) {
      if (e instanceof UnsupportedNativeDataType) {
        throw new DriverAdapterError({ kind: 'UnsupportedNativeDataType', type: String(e.oid) });
      }
      throw e;
    }
    return { columnNames: fields.map((f) => f.name), columnTypes, rows };
  }

  async executeRaw(query: SqlQuery): Promise<number> {
    return (await this.run(query)).affectedRows ?? 0;
  }

  /**
   * Duas vias, e a diferença importa.
   *
   * COM parâmetros → `query()` (protocolo estendido): é o que impede injeção
   * de SQL, porque o valor nunca é colado no texto do comando.
   *
   * SEM parâmetros → `exec()` (protocolo simples), que aceita VÁRIOS comandos
   * de uma vez. É assim que o node-postgres se comporta, e é o que provisiona
   * uma empresa: `tenant_template.sql` são 2141 linhas com dezenas de comandos
   * e corpos de função com `;` lá dentro. Pelo protocolo estendido isso
   * rebentava com "cannot insert multiple commands into a prepared statement",
   * e nenhuma empresa nova nasceria no telemóvel.
   */
  protected async execute(
    exec: (sql: string, options: PGliteQueryOptions) => Promise<PGliteResults[]>,
    query: (sql: string, params: unknown[], options: PGliteQueryOptions) => Promise<PGliteResults>,
    sqlQuery: SqlQuery,
  ): Promise<PGliteResults> {
    const options: PGliteQueryOptions = { rowMode: 'array', parsers };
    try {
      if (sqlQuery.args.length === 0) {
        const results = await exec(sqlQuery.sql, options);
        // Como o node-postgres: vale o ÚLTIMO resultado (o `affectedRows` do
        // PGlite já vem acumulado ao longo do script).
        return results.at(-1) ?? { rows: [], fields: [], affectedRows: 0 };
      }
      const values = sqlQuery.args.map((arg, i) => mapArg(arg, sqlQuery.argTypes[i]));
      return await query(sqlQuery.sql, values, options);
    } catch (e) {
      throw new DriverAdapterError(convertDriverError(e));
    }
  }
}

class PGliteTransaction extends PGliteQueryable implements Transaction {
  constructor(
    private readonly tx: PGliteTransactionLike,
    readonly options: TransactionOptions,
    private readonly finish: (outcome: 'commit' | 'rollback') => Promise<void>,
  ) {
    super();
  }

  protected run(query: SqlQuery): Promise<PGliteResults> {
    return this.execute(
      (sql, opts) => this.tx.exec(sql, opts),
      (sql, params, opts) => this.tx.query(sql, params, opts),
      query,
    );
  }

  async commit(): Promise<void> {
    await this.finish('commit');
  }

  async rollback(): Promise<void> {
    await this.finish('rollback');
  }

  async createSavepoint(name: string): Promise<void> {
    await this.executeRaw({ sql: `SAVEPOINT ${name}`, args: [], argTypes: [] });
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    await this.executeRaw({ sql: `ROLLBACK TO SAVEPOINT ${name}`, args: [], argTypes: [] });
  }

  async releaseSavepoint(name: string): Promise<void> {
    await this.executeRaw({ sql: `RELEASE SAVEPOINT ${name}`, args: [], argTypes: [] });
  }
}

export class PrismaPGliteAdapter extends PGliteQueryable implements SqlDriverAdapter {
  constructor(
    private readonly pglite: PGliteLike,
    private readonly options: PrismaPGliteOptions = {},
  ) {
    super();
  }

  protected run(query: SqlQuery): Promise<PGliteResults> {
    return this.execute(
      (sql, opts) => this.pglite.exec(sql, opts),
      (sql, params, opts) => this.pglite.query(sql, params, opts),
      query,
    );
  }

  /**
   * A transação fica ABERTA à espera de quem manda.
   *
   * O Prisma abre a transação, faz as gravações e só depois decide. O PGlite,
   * ao contrário, só sabe transações em bloco (`transaction(cb)`). A ponte é
   * manter a callback do PGlite suspensa numa promessa que só se resolve
   * quando o Prisma chamar `commit()` ou `rollback()` — o BEGIN e o COMMIT
   * continuam a ser emitidos pelo PGlite, que é quem tem a sessão na mão.
   *
   * `usePhantomQuery: true` diz ao Prisma para NÃO enviar `COMMIT`/`ROLLBACK`
   * como comandos: se enviasse, chegariam duas vezes ao PostgreSQL (uma nossa,
   * outra do PGlite ao fechar o bloco) e a segunda avisaria que já não há
   * transação nenhuma aberta.
   */
  async startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction> {
    if (isolationLevel && !ISOLATION_LEVELS.has(isolationLevel)) {
      throw new DriverAdapterError({ kind: 'InvalidIsolationLevel', level: isolationLevel });
    }

    const started = deferred<Transaction>();
    const outcome = deferred<'commit' | 'rollback'>();
    let settled = false;
    let abandoned = false;

    const finish = async (how: 'commit' | 'rollback'): Promise<void> => {
      if (!settled) {
        settled = true;
        clearTimeout(watchdog);
        outcome.resolve(how);
      }
      await running; // deixa o erro do COMMIT chegar a quem o pediu
      // Um `commit()` que chega DEPOIS de a rede de segurança ter desfeito a
      // transação não pode responder "gravado": era assim que uma venda
      // desaparecia sem ninguém ver um erro.
      if (abandoned && how === 'commit') {
        throw new DriverAdapterError({
          kind: 'TransactionAlreadyClosed',
          cause: 'a transação excedeu o tempo máximo e foi desfeita antes do commit',
        });
      }
    };

    const watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      abandoned = true;
      outcome.resolve('rollback');
    }, this.options.transactionTimeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS);
    (watchdog as unknown as { unref?: () => void }).unref?.();

    const running = this.pglite.transaction(async (tx) => {
      if (isolationLevel) {
        await tx.query(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
      }
      started.resolve(
        new PGliteTransaction(tx, { usePhantomQuery: true }, finish),
      );
      if ((await outcome.promise) === 'rollback') await tx.rollback();
    });

    // Se o próprio BEGIN falhar, quem espera pela transação tem de saber.
    running.catch((e: unknown) => {
      clearTimeout(watchdog);
      settled = true;
      started.reject(new DriverAdapterError(convertDriverError(e)));
    });

    return started.promise;
  }

  /** Vários comandos de uma vez — é o que as migrações usam. */
  async executeScript(script: string): Promise<void> {
    try {
      await this.pglite.exec(script);
    } catch (e) {
      throw new DriverAdapterError(convertDriverError(e));
    }
  }

  getConnectionInfo(): ConnectionInfo {
    return { schemaName: this.options.schema, supportsRelationJoins: true };
  }

  async dispose(): Promise<void> {
    if (this.options.closeOnDispose) await this.pglite.close();
  }

  /** Escotilha de emergência: o PGlite por baixo, para diagnóstico. */
  underlyingDriver(): PGliteLike {
    return this.pglite;
  }
}

/**
 * O que se passa ao `PrismaClient({ adapter })`.
 *
 * Aceita um PGlite já aberto (o caso normal na app: quem arranca o telemóvel
 * abre-o uma vez) ou uma função que o abre — assim este pacote nunca precisa
 * de importar o PGlite e continua a compilar em qualquer máquina.
 */
export class PrismaPGlite implements SqlDriverAdapterFactory {
  readonly provider = 'postgres';
  readonly adapterName = ADAPTER_NAME;

  constructor(
    private readonly source: PGliteLike | (() => PGliteLike | Promise<PGliteLike>),
    private readonly options: PrismaPGliteOptions = {},
  ) {}

  async connect(): Promise<SqlDriverAdapter> {
    const owned = typeof this.source === 'function';
    const pglite = owned ? await (this.source as () => Promise<PGliteLike>)() : (this.source as PGliteLike);
    return new PrismaPGliteAdapter(pglite, {
      // Quem abriu, fecha: se o PGlite veio de fora, não é nosso para fechar.
      closeOnDispose: owned,
      ...this.options,
    });
  }
}
