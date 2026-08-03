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
  run: SqlRunner;
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
    close: async () => { try { await client.end(); } catch { /* já fechada */ } },
  };
}
