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

  for (let volta = 0; volta < maxBatches; volta++) {
    const pendentes = await o.query<PendingChange>(pendingSql(o.schema, batch));
    if (pendentes.length === 0) return res;

    // Lê o estado ATUAL de cada linha. É de propósito que não se guarda a
    // linha no diário: entre a alteração e a subida ela pode ter mudado outra
    // vez, e o que interessa à nuvem é o que está lá AGORA, não um retrato
    // antigo. (Para o que é fiscal isto é indiferente — nunca muda.)
    const linhas: {
      table: string; id: string; data: Record<string, unknown>; deleted: boolean; deviceId: string | null;
    }[] = [];
    for (const p of pendentes) {
      if (!p.row_id) continue; // linha sem id (tabela de chave composta) — nada a fazer
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

/** Limpeza periódica do diário já sincronizado. */
export async function pruneJournal(o: Pick<EngineOptions, 'schema' | 'run'>, dias = 30): Promise<void> {
  try { await o.run(pruneSql(o.schema, dias), []); } catch { /* melhor esforço */ }
}
