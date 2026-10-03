/**
 * MOTOR DE REPLICAÇÃO — o ciclo que leva o trabalho do posto à nuvem.
 *
 * As peças já existiam: o diário sabe o que mudou, a política sabe o que é
 * seguro escrever. Isto é o que as usa.
 *
 * ## As regras do ciclo, e porque são assim
 *
 * **Nunca no caminho de uma operação.** O utilizador é libertado quando a venda
 * fica gravada NA BASE LOCAL. Isto corre depois, em segundo plano. Se falhar,
 * ninguém fica à espera.
 *
 * **Só marca como sincronizado o que a nuvem CONFIRMOU.** Marcar antes da
 * resposta seria dar por subido o que se perdeu no caminho — e esse dado nunca
 * mais seria tentado. É a diferença entre "quase nunca perde" e "não perde".
 *
 * **Uma linha recusada não trava a fila.** Se uma linha for rejeitada (uma
 * tabela que a política não deixa subir, por exemplo), fica marcada à mesma e o
 * ciclo continua. Sem isto, um único registo estranho parava a sincronização da
 * loja inteira e ninguém percebia porquê.
 *
 * **Em lotes, com teto.** Um posto que esteve duas semanas sem rede tem
 * milhares de alterações. Mandar tudo de uma vez esgota a memória do posto e o
 * limite da nuvem; mandar de 200 em 200 termina sempre.
 */
import type { SqlRunner } from '../provision';
import { markSyncedSql, pendingSql, pruneSql, type PendingChange } from './journal';

/** Executa uma consulta e devolve linhas (o `SqlRunner` só escreve). */
export type SqlQuery = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

export interface EngineOptions {
  /** URL base da API da nuvem. */
  apiUrl: string;
  /** Token de um COMPANY_ADMIN. */
  accessToken: string;
  companyCode: string;
  /** Schema da empresa na base local. */
  schema: string;
  /** Identificador deste posto. */
  deviceId: string;
  query: SqlQuery;
  run: SqlRunner;
  /** Linhas por lote (a nuvem limita a 200). */
  batchSize?: number;
  /** Voltas no máximo, para o ciclo terminar sempre. */
  maxBatches?: number;
  log?: (line: string) => void;
  fetchImpl?: typeof fetch;
  /**
   * Nível de quem tem a sessão (caixa/gerente/admin). Só se envia e lê o que
   * esse papel pode; o resto do diário FICA PENDENTE até haver uma sessão com
   * papel suficiente — nunca é marcado como enviado nem se perde.
   */
  tier?: import('@nexus/replication').ReplicationTier | null;
}

export interface PushResult {
  sent: number;
  applied: number;
  rejected: number;
  conflicts: number;
  remaining: boolean;
}

interface Outcome {
  table: string;
  id: string;
  applied: boolean;
  reason: string;
  conflict: boolean;
}

/**
 * Sobe para a nuvem o que este posto fez. Devolve o que aconteceu; não lança
 * por falta de rede — sem ligação simplesmente não há nada a fazer agora.
 */
export async function pushPending(o: EngineOptions): Promise<PushResult> {
  const log = o.log ?? (() => undefined);
  const doFetch = o.fetchImpl ?? fetch;
  const batch = Math.min(Math.max(1, o.batchSize ?? 200), 200);
  const maxBatches = Math.max(1, o.maxBatches ?? 50);

  const res: PushResult = { sent: 0, applied: 0, rejected: 0, conflicts: 0, remaining: false };

  // Tabelas que ESTA sessão pode enviar (sem nível = como antes: tudo).
  let permitidas: string[] | undefined;
  if (o.tier !== undefined) {
    const { canPushWithTier } = await import('@nexus/replication');
    const tabs = await o.query<{ table_name: string }>(
      `SELECT DISTINCT table_name FROM "${o.schema}"."sync_journal" WHERE synced_at IS NULL`,
    );
    permitidas = tabs.map((t) => t.table_name).filter((t) => canPushWithTier(t, o.tier ?? null));
    if (permitidas.length === 0) return res;
  }

  for (let volta = 0; volta < maxBatches; volta++) {
    const pendentes = await o.query<PendingChange>(pendingSql(o.schema, batch, permitidas));
    if (pendentes.length === 0) return res;

    // Lê o estado ATUAL de cada linha. É de propósito que não se guarda a
    // linha no diário: entre a alteração e a subida ela pode ter mudado outra
    // vez, e o que interessa à nuvem é o que está lá AGORA, não um retrato
    // antigo. (Para o que é fiscal isto é indiferente — nunca muda.)
    const linhas: {
      table: string; id: string; data: Record<string, unknown>; deleted: boolean; deviceId: string | null;
    }[] = [];
    for (const p of pendentes) {
      if (!p.row_id) {
        // Linha sem id (ex.: registo de auditoria) — não se replica; marca-se
        // para não ficar pendente para sempre.
        await o.run(markSyncedSql(o.schema), [p.table_name, null, p.seq]);
        continue;
      }
      if (p.op === 'D') {
        linhas.push({ table: p.table_name, id: p.row_id, data: { id: p.row_id }, deleted: true, deviceId: p.device_id });
        continue;
      }
      const atual = await o.query(
        `SELECT * FROM "${o.schema}"."${p.table_name}" WHERE id::text = $1 LIMIT 1`, [p.row_id],
      );
      if (atual.length === 0) {
        // Desapareceu entretanto. Não é erro — marca-se e segue.
        await o.run(markSyncedSql(o.schema), [p.table_name, p.row_id, p.seq]);
        continue;
      }
      linhas.push({
        table: p.table_name, id: p.row_id, data: atual[0] as Record<string, unknown>,
        deleted: false, deviceId: p.device_id,
      });
    }
    if (linhas.length === 0) continue;

    let outcomes: Outcome[];
    try {
      const r = await doFetch(`${o.apiUrl.replace(/\/+$/, '')}/replication/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${o.accessToken}`,
          'X-Tenant-Code': o.companyCode,
        },
        body: JSON.stringify({ rows: linhas }),
      });
      if (!r.ok) {
        log(`replicação: a nuvem recusou o lote (HTTP ${r.status}) — fica para a próxima`);
        res.remaining = true;
        return res;
      }
      outcomes = (await r.json()) as Outcome[];
    } catch {
      // Sem rede. Nada foi marcado — tudo será tentado outra vez.
      log('replicação: sem ligação — o trabalho fica em fila');
      res.remaining = true;
      return res;
    }

    res.sent += linhas.length;
    const porChave = new Map(outcomes.map((x) => [`${x.table}|${x.id}`, x]));
    for (const l of linhas) {
      const o2 = porChave.get(`${l.table}|${l.id}`);
      const p = pendentes.find((x) => x.table_name === l.table && x.row_id === l.id);
      if (!p) continue;
      if (o2?.applied) res.applied += 1; else res.rejected += 1;
      if (o2?.conflict) res.conflicts += 1;
      // Marca-se mesmo quando foi recusada: a decisão da nuvem é final, e
      // insistir numa linha que ela nunca vai aceitar pararia a fila para
      // sempre. O motivo fica no registo.
      if (o2 && !o2.applied) log(`replicação: ${l.table}/${l.id} não aplicada — ${o2.reason}`);
      await o.run(markSyncedSql(o.schema), [l.table, l.id, p.seq]);
    }

    if (pendentes.length < batch) return res;
  }

  res.remaining = true;
  log('replicação: ainda há trabalho por subir — continua na próxima volta');
  return res;
}

// ─── DESCIDA: aplicar no posto o que outros dispositivos fizeram ────────────

export interface PullApplyResult {
  tables: number;
  received: number;
  applied: number;
  skipped: number;
  conflicts: number;
  remaining: boolean;
}

/** Onde ficam os cursores e os conflitos do lado do posto. */
export function pullStateDdl(schema: string): string[] {
  const s = `"${schema}"`;
  return [
    `CREATE TABLE IF NOT EXISTS ${s}."sync_cursors" (
       table_name TEXT PRIMARY KEY,
       cursor     TEXT,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    `CREATE TABLE IF NOT EXISTS ${s}."sync_conflicts" (
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
  ];
}

/**
 * Traz da nuvem o que outros dispositivos fizeram e aplica-o aqui.
 *
 * ## O que NÃO se faz, e é o mais importante
 *
 * **Não se apaga nada com base no que vem de fora.** Uma linha que a nuvem não
 * tenha não é uma linha para eliminar aqui — pode ser simplesmente trabalho
 * deste posto que ainda não subiu. Só se aplica o que a nuvem MANDA, nunca o
 * que ela omite.
 *
 * **Não se toca em documentos fiscais que já cá estejam.** Descem por inserção;
 * se já existirem, ficam como estão. Este posto emitiu-os na sua série e ninguém
 * de fora os reescreve.
 *
 * **A escrita não passa pelo diário como se fosse trabalho local.** Aplicar uma
 * alteração vinda da nuvem e depois voltar a enviá-la seria um ciclo infinito
 * entre os dois lados. Por isso o gatilho é desligado na sessão enquanto isto
 * corre (`session_replication_role`).
 */
export async function pullAndApply(
  o: EngineOptions & { tables: string[]; startAt?: string | null; maxPagesPerTable?: number },
): Promise<PullApplyResult> {
  const log = o.log ?? (() => undefined);
  const doFetch = o.fetchImpl ?? fetch;
  const batch = Math.min(Math.max(1, o.batchSize ?? 200), 200);
  const res: PullApplyResult = { tables: 0, received: 0, applied: 0, skipped: 0, conflicts: 0, remaining: false };

  for (const sql of pullStateDdl(o.schema)) await o.run(sql, []);

  const { canPullToDevice, classify, resolve } = await import('@nexus/replication');

  const { canPullWithTier } = await import('@nexus/replication');
  for (const table of o.tables) {
    if (!canPullToDevice(table)) continue;
    if (o.tier !== undefined && !canPullWithTier(table, o.tier ?? null)) continue;
    res.tables += 1;

    const guardado = await o.query<{ cursor: string | null }>(
      `SELECT cursor FROM "${o.schema}"."sync_cursors" WHERE table_name = $1`, [table],
    );
    // Sem cursor: começa no MOMENTO DA CÓPIA (o que é anterior já cá está).
    // Começar do zero voltava a descer a empresa inteira, 200 linhas de cada
    // vez — com milhões de produtos, as alterações novas nunca chegavam.
    let cursor = guardado[0]?.cursor
      ?? (o.startAt ? Buffer.from(JSON.stringify({ at: o.startAt, id: '' }), 'utf8').toString('base64url') : null);

    // Várias páginas por volta (com teto), para não ficar uma tabela para trás.
    for (let pagina = 0; pagina < (o.maxPagesPerTable ?? 25); pagina++) {
      const url = `${o.apiUrl.replace(/\/+$/, '')}/replication/pull`
        + `?table=${encodeURIComponent(table)}&limit=${batch}`
        + (cursor ? `&since=${encodeURIComponent(cursor)}` : '');
      let page: { rows: Record<string, unknown>[]; cursor: string | null; hasMore: boolean; incremental: boolean };
      try {
        const r = await doFetch(url, {
          headers: { Authorization: `Bearer ${o.accessToken}`, 'X-Tenant-Code': o.companyCode },
        });
        if (!r.ok) { res.remaining = true; break; }
        page = await r.json() as typeof page;
      } catch {
        log('replicação: sem ligação para descer alterações');
        res.remaining = true;
        return res;
      }

      if (!page.incremental) {
        // A nuvem avisou que não sabe dizer o que mudou nesta tabela. Uma lista
        // vazia sem este aviso seria lida como "está tudo em dia" — e o posto
        // ficava para trás sem ninguém perceber.
        log(`replicação: ${table} não desce por incrementos (sem coluna de tempo)`);
        break;
      }
      res.received += page.rows.length;

      for (const remota of page.rows) {
        const id = remota.id == null ? null : String(remota.id);
        if (!id) { res.skipped += 1; continue; }
        try {
          const aplicou = await applyRemoteRow(o, table, id, remota, classify(table), resolve);
          if (aplicou.applied) res.applied += 1; else res.skipped += 1;
          if (aplicou.conflict) res.conflicts += 1;
        } catch (e) {
          res.skipped += 1;
          log(`replicação: ${table}/${id} não aplicada — ${(e as Error).message.split('\n')[0]}`);
        }
      }

      cursor = page.cursor ?? cursor;
      await o.run(
        `INSERT INTO "${o.schema}"."sync_cursors" (table_name, cursor) VALUES ($1, $2)
         ON CONFLICT (table_name) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = now()`,
        [table, cursor],
      );
      if (!page.hasMore) break;
      if (pagina === (o.maxPagesPerTable ?? 25) - 1) res.remaining = true;
    }
  }
  return res;
}

async function applyRemoteRow(
  o: EngineOptions,
  table: string,
  id: string,
  remota: Record<string, unknown>,
  klass: string,
  resolveFn: typeof import('@nexus/replication').resolve,
): Promise<{ applied: boolean; conflict: boolean }> {
  const cols = Object.keys(remota).filter((c) => /^[a-z_][a-z0-9_]*$/.test(c));
  if (cols.length === 0) return { applied: false, conflict: false };
  const t = `"${o.schema}"."${table}"`;
  const marcadores = cols.map((_, i) => `$${i + 1}`).join(', ');
  const valores = cols.map((c) => remota[c]);

  // O gatilho do diário é desligado NESTA sessão enquanto se aplica: sem isto,
  // o que desce da nuvem entrava no diário como trabalho deste posto e voltava
  // a subir — um ciclo infinito entre os dois lados.
  await o.run(`SET session_replication_role = 'replica'`, []);

  try {
    if (klass === 'fiscal' || klass === 'additive' || klass === 'cloud') {
      // Fiscal/aditivo: descem por inserção e nunca reescrevem o que cá está.
      // `cloud`: a nuvem manda, por isso pode atualizar.
      const set = klass === 'cloud'
        ? cols.filter((c) => c !== 'id').map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')
        : '';
      // Fiscal: `WHERE NOT EXISTS` (as faturas têm REGRAS e não aceitam `ON CONFLICT`).
      await o.run(
        set
          ? `INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${marcadores})
             ON CONFLICT (id) DO UPDATE SET ${set}`
          : `INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(', ')})
             SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM json_populate_record(NULL::${t}, $1::json)
             WHERE NOT EXISTS (SELECT 1 FROM ${t} WHERE id::text = $2)`,
        set ? valores : [JSON.stringify(Object.fromEntries(cols.map((c) => [c, remota[c]]))), id],
      );
      return { applied: true, conflict: false };
    }

    // Catálogo: a política decide, com a versão local em mãos.
    const atuais = await o.query(`SELECT * FROM ${t} WHERE id::text = $1 LIMIT 1`, [id]);
    const local = atuais[0] as Record<string, unknown> | undefined;
    const d = resolveFn(
      table,
      local ? { id, version: num(local.version), updatedAt: iso(local.updated_at), deviceId: str(local.device_id) } : null,
      { id, version: num(remota.version), updatedAt: iso(remota.updated_at), deviceId: str(remota.device_id) },
    );

    if (d.conflict) {
      await o.run(
        `INSERT INTO "${o.schema}"."sync_conflicts"
           (table_name, row_id, winner, reason, local_data, remote_data, device_id)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
        [table, id, d.winner, d.reason, JSON.stringify(local ?? null), JSON.stringify(remota), o.deviceId],
      );
    }
    if (d.winner !== 'remote') return { applied: false, conflict: d.conflict };

    const set = cols.filter((c) => c !== 'id').map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
    await o.run(
      `INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${marcadores})
       ${set ? `ON CONFLICT (id) DO UPDATE SET ${set}` : 'ON CONFLICT DO NOTHING'}`,
      valores,
    );
    return { applied: true, conflict: d.conflict };
  } finally {
    await o.run(`SET session_replication_role = 'origin'`, []);
  }
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
function iso(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? null : new Date(t).toISOString(); }
  return null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Limpeza periódica do diário já sincronizado. */
export async function pruneJournal(o: Pick<EngineOptions, 'schema' | 'run'>, dias = 30): Promise<void> {
  try { await o.run(pruneSql(o.schema, dias), []); } catch { /* melhor esforço */ }
}

/**
 * Instala (ou confirma) o DIÁRIO e os gatilhos no schema da empresa.
 *
 * Sem isto nada do que se grava no posto chega à nuvem: o motor lê o diário, e
 * um diário que nunca foi criado é uma fila sempre vazia — o "editei sem
 * internet e na nuvem não apareceu". Idempotente: corre na cópia e a cada ciclo.
 *
 * Postos já copiados ANTES de o diário existir: na 1.ª instalação, o que foi
 * alterado depois da cópia (`desde`) entra no diário, para não se perder.
 */
export async function ensureJournal(
  o: Pick<EngineOptions, 'schema' | 'run' | 'query'> & { desde?: string | null },
): Promise<{ created: boolean; tables: number; backfilled: number }> {
  const { journalDdl, attachTriggersSql, JOURNAL_TABLE } = await import('./journal');
  const { isReplicated } = await import('@nexus/replication');
  const existia = await o.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    [o.schema, JOURNAL_TABLE],
  );
  const created = (existia[0]?.n ?? 0) === 0;
  for (const sql of journalDdl(o.schema)) await o.run(sql, []);

  const tabelas = (await o.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
    [o.schema],
  )).map((t) => t.table_name).filter((t) => isReplicated(t));
  // Só (re)liga onde falta: recriar gatilhos a cada ciclo bloquearia as tabelas.
  const ligados = new Set((await o.query<{ tbl: string }>(
    `SELECT c.relname AS tbl FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND g.tgname = c.relname || '_sync_journal'`,
    [o.schema],
  )).map((r) => r.tbl));
  const faltam = tabelas.filter((t) => !ligados.has(t));
  for (const sql of attachTriggersSql(o.schema, faltam)) await o.run(sql, []);

  let backfilled = 0;
  // Postos copiados por versões anteriores ficaram com as sequências em 1
  // ("registo duplicado" ao abrir um turno). Acerta-as na 1.ª instalação.
  if (created) {
    const { syncSequences } = await import('../provision');
    try { await syncSequences(o.schema, o.run); } catch { /* melhor esforço */ }
  }
  if (created && o.desde) {
    for (const t of tabelas) {
      const cols = (await o.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 AND column_name IN ('id', 'updated_at', 'created_at')`,
        [o.schema, t],
      )).map((c) => c.column_name);
      if (!cols.includes('id')) continue;
      const col = cols.includes('updated_at') ? 'updated_at' : cols.includes('created_at') ? 'created_at' : null;
      if (!col) continue;
      const r = await o.query<{ n: number }>(
        `WITH ins AS (
           INSERT INTO "${o.schema}"."${JOURNAL_TABLE}" (table_name, row_id, op)
           SELECT $1, id::text, 'U' FROM "${o.schema}"."${t}" WHERE "${col}" > $2::timestamptz
           RETURNING 1)
         SELECT count(*)::int AS n FROM ins`,
        [t, o.desde],
      );
      backfilled += r[0]?.n ?? 0;
    }
  }
  return { created, tables: tabelas.length, backfilled };
}

/** Schema da empresa na base local (o mesmo nome que na nuvem). */
export async function companySchema(
  o: Pick<EngineOptions, 'query' | 'companyCode'>,
): Promise<string> {
  try {
    const r = await o.query<{ s: string }>(
      `SELECT "schemaName" AS s FROM nexus_public.companies WHERE lower(code) = lower($1) LIMIT 1`, [o.companyCode],
    );
    if (r[0]?.s && /^[a-z0-9_]+$/.test(r[0].s)) return r[0].s;
  } catch { /* base antiga sem tabelas de plataforma */ }
  return 'public';
}
