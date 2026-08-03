import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, assertValidSchemaName } from '../prisma/prisma.service';

/**
 * INSTANTÂNEO da empresa — a cópia inicial que enche a base de dados do posto.
 *
 * Sem isto, o servidor local é uma base VAZIA: o lojista abria a aplicação e
 * não encontrava a empresa, nem os produtos, nem as vendas. É por isso que a
 * barreira em `local-server/readiness.ts` recusa servir a aplicação enquanto
 * ninguém disser que os dados cá estão — e é este serviço que dá a quem
 * provisiona a maneira de os trazer.
 *
 * ## Duas decisões que valem a pena explicar
 *
 * **Porque não `pg_dump` do Aiven?** Seria mais fiel e mais simples. Mas exigia
 * pôr as credenciais da base de dados da NUVEM dentro de cada posto de venda —
 * ou seja, entregar a base de dados inteira de todas as empresas a quem
 * abrisse um ficheiro de configuração numa loja. A cópia passa pela API,
 * autenticada e limitada à empresa de quem pede.
 *
 * **Porque não uma lista de tabelas escrita à mão?** São 75 e crescem. Uma
 * lista à mão fica desatualizada em silêncio, e uma tabela esquecida só dá
 * erro no posto do cliente, sem rede. A ordem é derivada do PRÓPRIO schema
 * (grafo de chaves estrangeiras), por isso uma tabela nova entra sozinha.
 */

/** Uma tabela do instantâneo, já na ordem em que pode ser inserida. */
export interface SnapshotTable {
  table: string;
  rows: number;
  /** Tabelas de que esta depende (têm de ser inseridas antes). */
  dependsOn: string[];
}

interface FkEdge { child: string; parent: string }

@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);
  /** Teto por página. Mais do que isto e a resposta fica grande demais para um
   *  posto com ligação fraca — que é exatamente o caso de uso. */
  static readonly MAX_LIMIT = 500;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tabelas da empresa **por ordem de dependência**: quem não depende de
   * ninguém primeiro. Inserir por outra ordem parte nas chaves estrangeiras.
   */
  async tables(schema: string): Promise<SnapshotTable[]> {
    assertValidSchemaName(schema);

    const rows = await this.prisma.$queryRaw<{ table_name: string }[]>(
      Prisma.sql`SELECT table_name FROM information_schema.tables
                 WHERE table_schema = ${schema} AND table_type = 'BASE TABLE'
                 ORDER BY table_name`,
    );
    const names = rows.map((r) => r.table_name);
    if (names.length === 0) return [];

    // Arestas do grafo: filho → pai (o pai tem de existir primeiro).
    const edges = await this.prisma.$queryRaw<FkEdge[]>(
      Prisma.sql`SELECT c.relname AS child, p.relname AS parent
                 FROM pg_constraint k
                 JOIN pg_class c ON c.oid = k.conrelid
                 JOIN pg_class p ON p.oid = k.confrelid
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 JOIN pg_namespace np ON np.oid = p.relnamespace
                 WHERE k.contype = 'f' AND n.nspname = ${schema} AND np.nspname = ${schema}`,
    );

    const ordered = topologicalOrder(names, edges);
    const counts = await this.rowCounts(schema, ordered);
    const deps = new Map<string, string[]>();
    for (const e of edges) {
      // Auto-referência (ex.: categoria com categoria-mãe) não é dependência
      // ENTRE tabelas: resolve-se dentro da própria, pela ordem das linhas.
      if (e.child === e.parent) continue;
      const list = deps.get(e.child) ?? [];
      if (!list.includes(e.parent)) list.push(e.parent);
      deps.set(e.child, list);
    }
    return ordered.map((t) => ({ table: t, rows: counts.get(t) ?? 0, dependsOn: deps.get(t) ?? [] }));
  }

  /** Contagem por tabela, numa só query (75 queries à parte seriam lentas). */
  private async rowCounts(schema: string, tables: string[]): Promise<Map<string, number>> {
    if (tables.length === 0) return new Map();
    const parts = tables.map(
      (t) => Prisma.sql`SELECT ${t}::text AS t, count(*)::int AS n FROM ${Prisma.raw(`"${schema}"."${t}"`)}`,
    );
    try {
      const rows = await this.prisma.$queryRaw<{ t: string; n: number }[]>(
        Prisma.join(parts, ' UNION ALL '),
      );
      return new Map(rows.map((r) => [r.t, Number(r.n)]));
    } catch (e) {
      // Uma tabela indisponível não pode esconder as outras — sem contagens o
      // provisionamento ainda funciona, só não sabe mostrar o progresso.
      this.logger.debug(`contagens falharam (${schema}): ${e instanceof Error ? e.message.split('\n')[0] : 'erro'}`);
      return new Map();
    }
  }

  /**
   * Uma página de linhas de UMA tabela.
   *
   * `ctid` como ordem: é a posição física da linha. Não é bonito, mas é a única
   * ordem que existe em TODAS as tabelas — muitas não têm `id` nem `created_at`,
   * e sem ordem estável duas páginas podiam trazer a mesma linha e falhar outra.
   */
  async rows(
    schema: string, table: string, offset: number, limit: number,
  ): Promise<{ table: string; offset: number; rows: unknown[]; done: boolean }> {
    assertValidSchemaName(schema);

    // O nome da tabela vai para dentro de SQL, por isso NÃO basta validá-lo com
    // uma expressão: só é aceite se estiver mesmo na lista de tabelas desta
    // empresa. Assim não há nome que se possa inventar.
    const known = await this.tables(schema);
    if (!known.some((t) => t.table === table)) {
      throw new BadRequestException(`Tabela desconhecida: ${table}`);
    }
    const take = Math.min(Math.max(1, limit || 200), SnapshotService.MAX_LIMIT);
    const skip = Math.max(0, offset || 0);

    const rows = await this.prisma.$queryRaw<unknown[]>(
      Prisma.sql`SELECT * FROM ${Prisma.raw(`"${schema}"."${table}"`)}
                 ORDER BY ctid LIMIT ${take} OFFSET ${skip}`,
    );
    return { table, offset: skip, rows, done: rows.length < take };
  }
}

/**
 * Ordena as tabelas de modo a que nenhuma apareça antes daquelas de que
 * depende (Kahn). Um ciclo — duas tabelas que se apontam uma à outra — não
 * pode fazer perder tabelas: as que sobram vão para o fim, e quem insere
 * resolve-as adiando as chaves. Perder uma tabela em silêncio seria pior.
 */
export function topologicalOrder(nodes: string[], edges: FkEdge[]): string[] {
  const set = new Set(nodes);
  const pending = new Map<string, Set<string>>(nodes.map((n) => [n, new Set<string>()]));
  for (const e of edges) {
    if (e.child === e.parent) continue;          // auto-referência
    if (!set.has(e.child) || !set.has(e.parent)) continue;
    pending.get(e.child)!.add(e.parent);
  }
  const out: string[] = [];
  const done = new Set<string>();
  let mexeu = true;
  while (mexeu) {
    mexeu = false;
    for (const n of nodes) {
      if (done.has(n)) continue;
      const faltam = pending.get(n)!;
      if ([...faltam].every((p) => done.has(p))) {
        out.push(n); done.add(n); mexeu = true;
      }
    }
  }
  for (const n of nodes) if (!done.has(n)) out.push(n); // ciclos, no fim
  return out;
}
