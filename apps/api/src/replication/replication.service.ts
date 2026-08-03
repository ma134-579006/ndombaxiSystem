import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { classify, isReplicated, resolve, type Version } from '@nexus/replication';
import { PrismaService, assertValidSchemaName } from '../prisma/prisma.service';

/**
 * REPLICAÇÃO — a nuvem a receber o que os postos fizeram sem internet.
 *
 * ## A regra que torna isto seguro
 *
 * Isto aceita escritas genéricas em tabelas da empresa, o que é exatamente o
 * tipo de coisa que corrompe sistemas. O que impede o desastre é **a política
 * ser a mesma dos dois lados** — literalmente o mesmo ficheiro
 * (`@nexus/replication`), não uma cópia. Se fossem duas cópias, a primeira
 * alteração feita só de um lado criaria uma discordância silenciosa sobre o que
 * é seguro escrever.
 *
 * Por classe:
 *   • `fiscal` → **só INSERT**, nunca UPDATE. Uma fatura que já cá esteja fica
 *     como está. É isto que impede um posto de reescrever documentos fiscais.
 *   • `additive` → só INSERT (movimentos somam-se; alterar um seria apagar
 *     história).
 *   • `catalog` → INSERT ou UPDATE, mas só se a política disser que a versão do
 *     posto GANHA. Quando perde, não se escreve — e o conflito fica registado.
 *   • tudo o resto (`cloud`, `device`, `derived`, desconhecidas) → **recusado**.
 *     Um posto não altera utilizadores, nem séries fiscais de outros postos,
 *     nem saldos calculados.
 *
 * ⚠️ Isto NÃO é a "fila genérica" que este projeto sempre recusou. Aquela
 * reenviava cegamente todas as gravações de um cliente e podia duplicar
 * faturas. Aqui a identidade da linha vem do posto (um id global), a classe
 * decide o que é permitido, e o fiscal é imutável por construção.
 */

/** Uma linha que o posto quer enviar para a nuvem. */
export interface IncomingRow {
  table: string;
  id: string;
  /** A linha inteira, tal como está no posto. */
  data: Record<string, unknown>;
  /** Foi apagada no posto? */
  deleted?: boolean;
  /** Posto de origem (auditoria e desempate). */
  deviceId?: string | null;
}

export interface ApplyOutcome {
  table: string;
  id: string;
  applied: boolean;
  reason: string;
  conflict: boolean;
}

@Injectable()
export class ReplicationService {
  private readonly logger = new Logger(ReplicationService.name);
  /** Teto por pedido: um posto com semanas de trabalho não pode mandar tudo de uma vez. */
  static readonly MAX_BATCH = 200;

  constructor(private readonly prisma: PrismaService) {}

  /** Cria a tabela de conflitos, se ainda não existir (idempotente). */
  private async ensureConflictLog(schema: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${schema}"."sync_conflicts" (
         id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         table_name  TEXT NOT NULL,
         row_id      TEXT NOT NULL,
         winner      TEXT NOT NULL,
         reason      TEXT NOT NULL,
         local_data  JSONB,
         remote_data JSONB,
         device_id   TEXT,
         created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
  }

  /**
   * Aplica um lote vindo de um posto.
   *
   * Cada linha é tratada por si: uma que seja recusada não impede as outras.
   * Um lote que falhasse por inteiro por causa de uma linha estranha deixaria o
   * posto preso para sempre no mesmo ponto.
   */
  async push(schema: string, rows: IncomingRow[]): Promise<ApplyOutcome[]> {
    assertValidSchemaName(schema);
    if (!Array.isArray(rows) || rows.length === 0) return [];
    if (rows.length > ReplicationService.MAX_BATCH) {
      throw new BadRequestException(`Lote demasiado grande (máx. ${ReplicationService.MAX_BATCH}).`);
    }
    await this.ensureConflictLog(schema);

    const out: ApplyOutcome[] = [];
    for (const row of rows) {
      try {
        out.push(await this.applyOne(schema, row));
      } catch (e) {
        const reason = e instanceof Error ? e.message.split('\n')[0].slice(0, 200) : 'erro';
        this.logger.debug(`replicação recusou ${row.table}/${row.id}: ${reason}`);
        out.push({ table: row.table, id: row.id, applied: false, reason, conflict: false });
      }
    }
    return out;
  }

  private async applyOne(schema: string, row: IncomingRow): Promise<ApplyOutcome> {
    const klass = classify(row.table);
    if (!isReplicated(row.table)) {
      // Não é um erro do posto — é a política a fazer o seu trabalho.
      throw new ForbiddenException(
        klass === 'unknown'
          ? `tabela não classificada (${row.table})`
          : `tabela ${row.table} é da classe "${klass}" e não sobe do posto`,
      );
    }
    if (!row.id || typeof row.id !== 'string') {
      throw new BadRequestException('linha sem identificador');
    }
    const cols = Object.keys(row.data ?? {});
    if (cols.length === 0) throw new BadRequestException('linha vazia');
    for (const c of cols) {
      if (!/^[a-z_][a-z0-9_]*$/.test(c)) throw new BadRequestException(`coluna inválida: ${c}`);
    }

    const t = `"${schema}"."${row.table}"`;

    // ── FISCAL e ADITIVO: só entram, nunca alteram ─────────────
    if (klass === 'fiscal' || klass === 'additive') {
      const marcadores = cols.map((_, i) => `$${i + 1}`).join(', ');
      const n = await this.prisma.$executeRawUnsafe(
        `INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(', ')})
         VALUES (${marcadores}) ON CONFLICT DO NOTHING`,
        ...cols.map((c) => row.data[c]),
      );
      return {
        table: row.table, id: row.id, applied: n > 0, conflict: false,
        reason: n > 0
          ? 'inserido'
          : 'já existia — registos fiscais não se reescrevem',
      };
    }

    // ── CATÁLOGO: a política decide ────────────────────────────
    const existing = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      // `id::text` e não `$1::uuid`: nem todas as tabelas têm o id em UUID, e
      // uma conversão errada rebentava a replicação de tabelas legítimas.
      `SELECT * FROM ${t} WHERE id::text = $1 LIMIT 1`, row.id,
    );
    const atual = existing[0] ?? null;

    const remoto: Version | null = atual
      ? {
        id: row.id,
        version: toNum(atual.version),
        updatedAt: toIso(atual.updated_at),
        deviceId: (atual.device_id as string | null) ?? null,
        deleted: atual.deleted_at != null,
      }
      : null;
    const local: Version = {
      id: row.id,
      version: toNum(row.data.version),
      updatedAt: toIso(row.data.updated_at),
      deviceId: row.deviceId ?? null,
      deleted: row.deleted === true,
    };

    const d = resolve(row.table, local, remoto);

    if (d.conflict) {
      // NUNCA em silêncio — mesmo quando a escolha foi óbvia.
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "${schema}"."sync_conflicts"
           (table_name, row_id, winner, reason, local_data, remote_data, device_id)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
        row.table, row.id, d.winner, d.reason,
        JSON.stringify(row.data), JSON.stringify(atual ?? null), row.deviceId ?? null,
      );
    }

    if (d.winner !== 'local') {
      return { table: row.table, id: row.id, applied: false, reason: d.reason, conflict: d.conflict };
    }

    const marcadores = cols.map((_, i) => `$${i + 1}`).join(', ');
    const set = cols.filter((c) => c !== 'id').map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${marcadores})
       ${set ? `ON CONFLICT (id) DO UPDATE SET ${set}` : 'ON CONFLICT DO NOTHING'}`,
      ...cols.map((c) => row.data[c]),
    );
    return { table: row.table, id: row.id, applied: true, reason: d.reason, conflict: d.conflict };
  }

  // ─── DESCIDA: o que outros dispositivos fizeram ────────────
  //
  // O cursor é COMPOSTO — `(momento, id)` — e não só a data. Com um cursor só
  // de data, dois registos gravados no mesmo milissegundo na fronteira de uma
  // página faziam desaparecer um deles para sempre. É o mesmo desenho já usado
  // em `sync.service.ts`, de propósito: dois mecanismos de cursor diferentes no
  // mesmo sistema seria uma armadilha à espera.

  /** Coluna de tempo de cada tabela (memorizada — o schema não muda a meio). */
  private readonly tsColumnCache = new Map<string, string | null>();

  private async timeColumn(schema: string, table: string): Promise<string | null> {
    const chave = `${schema}.${table}`;
    const em = this.tsColumnCache.get(chave);
    if (em !== undefined) return em;
    const cols = await this.prisma.$queryRaw<{ column_name: string }[]>(
      Prisma.sql`SELECT column_name FROM information_schema.columns
                 WHERE table_schema = ${schema} AND table_name = ${table}
                   AND column_name IN ('updated_at', 'created_at')`,
    );
    const nomes = cols.map((c) => c.column_name);
    // `updated_at` é o que interessa; `created_at` serve o que nunca muda
    // (faturas, movimentos) — para esses são equivalentes.
    const escolhida = nomes.includes('updated_at') ? 'updated_at'
      : nomes.includes('created_at') ? 'created_at' : null;
    this.tsColumnCache.set(chave, escolhida);
    return escolhida;
  }

  /**
   * O que mudou nesta tabela depois do cursor.
   *
   * Uma tabela sem coluna de tempo não pode ser descida por incrementos —
   * e dizemos isso em vez de devolver uma lista vazia que pareceria "nada
   * mudou". Um silêncio desses seria interpretado como estar em dia.
   */
  async pull(
    schema: string, table: string, since: string | null, limit: number,
  ): Promise<{ table: string; rows: Record<string, unknown>[]; cursor: string | null; hasMore: boolean; incremental: boolean }> {
    assertValidSchemaName(schema);
    if (!isReplicated(table)) {
      throw new ForbiddenException(`tabela ${table} (classe "${classify(table)}") não desce por aqui`);
    }
    const take = Math.min(Math.max(1, limit || 200), ReplicationService.MAX_BATCH);
    const col = await this.timeColumn(schema, table);
    const t = `"${schema}"."${table}"`;

    if (!col) {
      return { table, rows: [], cursor: null, hasMore: false, incremental: false };
    }

    const pos = decodePos(since);
    const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM ${t}
        WHERE ("${col}", id::text) > ($1::timestamptz, $2)
        ORDER BY "${col}", id::text
        LIMIT ${take}`,
      pos.at, pos.id,
    );
    const ultima = rows[rows.length - 1];
    const cursor = ultima
      ? encodePos({ at: toIso(ultima[col]) ?? pos.at, id: String(ultima.id ?? '') })
      : since ?? null;
    return { table, rows, cursor, hasMore: rows.length === take, incremental: true };
  }

  /** Conflitos registados (para o gestor poder olhar). */
  async conflicts(schema: string, limit = 100): Promise<unknown[]> {
    assertValidSchemaName(schema);
    await this.ensureConflictLog(schema);
    return this.prisma.$queryRawUnsafe(
      `SELECT * FROM "${schema}"."sync_conflicts" ORDER BY created_at DESC LIMIT ${Math.min(Math.max(1, limit), 500)}`,
    );
  }
}

function toNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
function toIso(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}

/**
 * Posição no cursor: momento + id, para desempatar registos gravados no mesmo
 * milissegundo. A EPOCA traz tudo — é o que acontece na primeira descida.
 */
interface Pos { at: string; id: string }
const EPOCA: Pos = { at: '1970-01-01T00:00:00.000Z', id: '' };

function decodePos(raw: string | null | undefined): Pos {
  if (!raw) return EPOCA;
  try {
    const p = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Pos>;
    if (typeof p?.at !== 'string') return EPOCA;
    return { at: p.at, id: typeof p.id === 'string' ? p.id : '' };
  } catch {
    // Cursor ilegivel (versao antiga, corrupcao): recomeca do principio.
    // Trazer tudo outra vez e lento mas CORRETO; adivinhar seria perder dados.
    return EPOCA;
  }
}

function encodePos(p: Pos): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
}
