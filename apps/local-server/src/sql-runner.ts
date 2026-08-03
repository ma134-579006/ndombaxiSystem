/**
 * Execução de SQL na base local, para o provisionamento.
 *
 * Usa o cliente `pg` com **parâmetros ligados** (`$1`, `$2`, …) e não texto
 * montado à mão. Não é preciosismo: as 75 tabelas trazem JSONB, arrays, datas,
 * dinheiro e texto com apóstrofos angolanos. Montar literais à mão é onde a
 * corrupção silenciosa de dados se esconde — e seria descoberta meses depois,
 * num relatório que não bate certo.
 */
import { Client } from 'pg';
import type { SqlRunner } from './provision';

export interface RunnerHandle {
  /** Executa sem devolver linhas (inserções, marcações). */
  run: SqlRunner;
  /**
   * Executa e DEVOLVE as linhas.
   *
   * Existe porque a replicação precisa de ler — o diário e o estado atual de
   * cada linha. Sem isto, quem consumisse este executor teria de abrir uma
   * segunda ligação só para ler, ou (pior) receberia listas vazias a fingir que
   * não havia nada para subir.
   */
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
  close(): Promise<void>;
}

/**
 * Abre uma ligação à base local e devolve um executor.
 *
 * Uma ligação só, reutilizada: a cópia inicial são milhares de inserções e
 * abrir uma ligação por linha seria mais lento do que a própria cópia.
 */
export async function openRunner(connectionUrl: string): Promise<RunnerHandle> {
  const client = new Client({ connectionString: connectionUrl });
  await client.connect();
  return {
    run: async (sql: string, params: unknown[]) => { await client.query(sql, params); },
    query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const r = await client.query(sql, params ?? []);
      return r.rows as T[];
    },
    close: async () => { try { await client.end(); } catch { /* já fechada */ } },
  };
}
