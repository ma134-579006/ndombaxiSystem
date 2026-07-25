/**
 * Descida incremental (delta pull).
 *
 * O posto pede "o que mudou desde X" e recebe só isso. Numa empresa com 20 000
 * produtos, a primeira sincronização traz tudo; as seguintes trazem as três
 * linhas que o gestor alterou. É a diferença entre uma app usável num 3G de
 * Angola e uma app que ninguém aguenta.
 *
 * O cursor é composto — `(updated_at, id)` — e não apenas a data. Com um cursor
 * só de data, dois registos gravados no mesmo milissegundo na fronteira da
 * página faziam desaparecer um deles para sempre. O par ordenado elimina isso.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveEntity, allowedEntities, type SyncEntityDef } from './sync-registry';

/** Posição por entidade dentro do cursor opaco. */
interface CursorPos { at: string; id: string }
type Cursor = Record<string, CursorPos>;

export interface PullChangeDto {
  entity: string;
  id: string;
  data: Record<string, unknown> | null;
  version: number;
  updatedAt: string;
  deleted: boolean;
}

export interface PullResultDto {
  changes: PullChangeDto[];
  cursor: string;
  hasMore: boolean;
  serverTime: string;
}

/** Fronteira inferior quando ainda não há cursor: traz tudo. */
const EPOCH: CursorPos = { at: '1970-01-01T00:00:00.000Z', id: '00000000-0000-0000-0000-000000000000' };

function decodeCursor(raw: string | null | undefined): Cursor {
  if (!raw) return {};
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Cursor;
  } catch {
    // Cursor ilegível (versão antiga, corrupção): recomeçamos do princípio.
    // Trazer tudo outra vez é lento mas correto; adivinhar seria perder dados.
    return {};
  }
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async pull(
    schema: string,
    input: { since?: string | null; entities?: string[]; limit?: number },
    isManager: boolean,
  ): Promise<PullResultDto> {
    const cursor = decodeCursor(input.since);
    const permitted = new Set(allowedEntities(isManager));
    const wanted = (input.entities?.length ? input.entities : [...permitted])
      .filter((e) => permitted.has(e));

    // Teto por pedido: protege a API de um cliente que peça 1 000 000 de linhas.
    const limit = Math.min(Math.max(input.limit ?? 500, 1), 2000);

    const changes: PullChangeDto[] = [];
    const nextCursor: Cursor = { ...cursor };
    let hasMore = false;

    for (const name of wanted) {
      const def = resolveEntity(name);
      if (!def) continue;
      // Orçamento de linhas repartido: nenhuma entidade esfomeia as outras.
      const budget = Math.max(1, Math.floor(limit / wanted.length));
      const pos = cursor[name] ?? EPOCH;
      const rows = await this.fetchSince(schema, def, pos, budget + 1);

      if (rows.length > budget) {
        hasMore = true;
        rows.length = budget;
      }
      if (rows.length === 0) continue;

      for (const row of rows) changes.push(this.toChange(def, row));
      const last = rows[rows.length - 1];
      nextCursor[name] = {
        at: new Date(last[def.updatedAt] as string | Date).toISOString(),
        id: String(last.id),
      };
    }

    return {
      changes,
      cursor: encodeCursor(nextCursor),
      hasMore,
      serverTime: new Date().toISOString(),
    };
  }

  /**
   * Lê as linhas alteradas depois da posição do cursor.
   *
   * Nota de segurança: `def` vem SEMPRE do registo estático — nome de tabela e
   * colunas nunca chegam do pedido do cliente. Só assim se pode interpolar
   * identificadores em SQL sem abrir a porta a injeção.
   */
  private async fetchSince(
    schema: string,
    def: SyncEntityDef,
    pos: CursorPos,
    limit: number,
  ): Promise<Record<string, unknown>[]> {
    const cols = def.columns.map((c) => `"${c}"`).join(', ');
    const ts = `"${def.updatedAt}"`;
    const sql = `
      SELECT ${cols}
        FROM "${def.table}"
       WHERE (${ts}, "id"::text) > ($1::timestamptz, $2::text)
       ORDER BY ${ts} ASC, "id"::text ASC
       LIMIT $3`;

    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, pos.at, pos.id, limit),
    );
  }

  private toChange(def: SyncEntityDef, row: Record<string, unknown>): PullChangeDto {
    const updatedAt = new Date(row[def.updatedAt] as string | Date);
    // A versão é o instante da última alteração em ms. Monotónica por linha e
    // comparável entre cliente e servidor sem precisar de uma coluna nova.
    const version = updatedAt.getTime();
    // Soft-delete no servidor vira lápide no cliente: o posto deixa de mostrar
    // o registo, mas o servidor mantém tudo para a auditoria.
    const deleted = def.activeFlag ? row[def.activeFlag] === false : false;

    return {
      entity: def.entity,
      id: String(row.id),
      data: deleted ? null : normalize(row),
      version,
      updatedAt: updatedAt.toISOString(),
      deleted,
    };
  }
}

/**
 * Converte tipos do Postgres para JSON seguro.
 * `NUMERIC` chega como Decimal e `TIMESTAMPTZ` como Date — se fossem serializados
 * em bruto, o cliente recebia objetos que não sabe ler.
 */
function normalize(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (v !== null && typeof v === 'object' && 'toFixed' in (v as object)) {
      out[k] = (v as Prisma.Decimal).toString();
    } else out[k] = v;
  }
  return out;
}
