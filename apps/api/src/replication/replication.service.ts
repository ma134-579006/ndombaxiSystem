import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  classify, canPullToDevice, canPushFromDevice, canPullWithTier, canPushWithTier, resolve,
  type ReplicationTier, type Version,
} from '@nexus/replication';
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
  async push(schema: string, rows: IncomingRow[], tier: ReplicationTier | null = 'admin'): Promise<ApplyOutcome[]> {
    assertValidSchemaName(schema);
    if (!Array.isArray(rows) || rows.length === 0) return [];
    if (rows.length > ReplicationService.MAX_BATCH) {
      throw new BadRequestException(`Lote demasiado grande (máx. ${ReplicationService.MAX_BATCH}).`);
    }
    await this.ensureConflictLog(schema);

    const out: ApplyOutcome[] = [];
    for (const row of rows) {
      try {
        if (!canPushWithTier(row.table, tier) && canPushFromDevice(row.table)) {
          // A política deixaria, o PAPEL não: ex. um caixa a enviar produtos.
          throw new ForbiddenException(`o papel desta sessão não envia ${row.table}`);
        }
        out.push(await this.applyOne(schema, row));
      } catch (e) {
        const reason = e instanceof Error
          ? (e.message.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? 'erro').slice(0, 200) : 'erro';
        this.logger.debug(`replicação recusou ${row.table}/${row.id}: ${reason}`);
        out.push({ table: row.table, id: row.id, applied: false, reason, conflict: false });
      }
    }
    return out;
  }

  private async applyOne(schema: string, row: IncomingRow): Promise<ApplyOutcome> {
    const klass = classify(row.table);
    if (!canPushFromDevice(row.table)) {
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
    const lista = cols.map((c) => `"${c}"`).join(', ');
    // A linha vai como UM json e o PostgreSQL converte cada campo para o tipo da
    // coluna (uuid, numeric, timestamptz, jsonb…). Com um parâmetro por coluna
    // tudo chegava como texto e QUALQUER linha com uuid era recusada — nada do
    // que um posto fazia sem internet chegava à nuvem.
    const json = JSON.stringify(row.data);

    // ── FISCAL e ADITIVO: só entram, nunca alteram ─────────────
    if (klass === 'fiscal' || klass === 'additive') {
      const n = await this.prisma.$executeRawUnsafe(
        // `WHERE NOT EXISTS` e não `ON CONFLICT`: faturas têm REGRAS contra
        // alteração, e o PostgreSQL recusa `ON CONFLICT` nessas tabelas — todas
        // as vendas feitas sem internet eram recusadas pela nuvem.
        `INSERT INTO ${t} (${lista}) SELECT ${lista} FROM json_populate_record(NULL::${t}, $1::json)
         WHERE NOT EXISTS (SELECT 1 FROM ${t} WHERE id::text = $2)`,
        json, row.id,
      );
      // Movimento de stock NOVO vindo do posto: aplica-o ao saldo da loja e ao
      // total do produto, como o StockService faz numa venda na nuvem. Sem isto
      // o stock da nuvem só acertava quando um administrador subia a linha do
      // produto — e aí por "último a escrever ganha", apagando vendas feitas
      // na nuvem entretanto.
      if (n > 0 && row.table === 'stock_movements') await this.applyStockMovement(schema, row.data);
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

    // O stock de um produto que já existe é dos MOVIMENTOS (ver applyStockMovement),
    // nunca do valor absoluto que o posto tinha: esse não conta as vendas da nuvem.
    const set = cols.filter((c) => c !== 'id' && !(row.table === 'products' && c === 'stock_qty'))
      .map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO ${t} (${lista}) SELECT ${lista} FROM json_populate_record(NULL::${t}, $1::json)
       ${set ? `ON CONFLICT (id) DO UPDATE SET ${set}` : 'ON CONFLICT DO NOTHING'}`,
      json,
    );
    return { table: row.table, id: row.id, applied: true, reason: d.reason, conflict: d.conflict };
  }

  /** Soma um movimento de stock vindo do posto ao saldo da loja e ao total do produto. */
  private async applyStockMovement(schema: string, m: Record<string, unknown>): Promise<void> {
    const q = Number(m.quantity);
    const pid = typeof m.product_id === 'string' ? m.product_id : null;
    const wid = typeof m.warehouse_id === 'string' ? m.warehouse_id : null;
    if (!pid || !wid || !Number.isFinite(q) || q === 0) return;
    await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe(
        `INSERT INTO "${schema}"."stock_items" (product_id, warehouse_id, quantity)
         VALUES ($1::uuid, $2::uuid, 0) ON CONFLICT (product_id, warehouse_id) DO NOTHING`, pid, wid,
      ),
      this.prisma.$executeRawUnsafe(
        `UPDATE "${schema}"."stock_items" SET quantity = quantity + $3::numeric, updated_at = now()
         WHERE product_id = $1::uuid AND warehouse_id = $2::uuid`, pid, wid, q,
      ),
      this.prisma.$executeRawUnsafe(
        `UPDATE "${schema}"."products" SET stock_qty = stock_qty + $2::numeric, updated_at = now()
         WHERE id = $1::uuid`, pid, q,
      ),
    ]);
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
    schema: string, table: string, since: string | null, limit: number, tier: ReplicationTier | null = 'admin',
  ): Promise<{ table: string; rows: Record<string, unknown>[]; cursor: string | null; hasMore: boolean; incremental: boolean }> {
    assertValidSchemaName(schema);
    // `canPullToDevice` e NAO `canPushFromDevice`: a direcao nao e simetrica.
    // Os utilizadores TEM de descer (senao o posto nao autentica ninguem) mas
    // nunca podem subir. Confundir as duas partiria o sistema de duas maneiras
    // opostas — ou a loja nao deixava entrar o gerente, ou um posto passava a
    // poder alterar quem tem acesso a empresa.
    if (!canPullToDevice(table)) {
      throw new ForbiddenException(`tabela ${table} (classe "${classify(table)}") não desce por aqui`);
    }
    if (!canPullWithTier(table, tier)) {
      throw new ForbiddenException(`o papel desta sessão não lê ${table}`);
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
