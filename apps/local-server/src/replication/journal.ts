/**
 * DIÁRIO DE ALTERAÇÕES — o que mudou na base do posto desde a última troca.
 *
 * Sem isto não há replicação incremental: só saberíamos comparar tudo com tudo,
 * o que numa empresa com anos de faturas é impensável por uma ligação móvel.
 *
 * ## Porquê GATILHOS da base de dados, e não código na aplicação
 *
 * A API que corre no posto é **exatamente a mesma** que corre na nuvem — é essa
 * a razão de o servidor local ser viável sem reescrever o sistema. Se o diário
 * dependesse de a aplicação se lembrar de o escrever, cada funcionalidade nova
 * teria de se lembrar também, e a primeira que se esquecesse produziria dados
 * que **nunca subiriam** — perdidos sem ninguém dar por isso, que é a pior
 * classe de avaria que este projeto pode ter.
 *
 * Um gatilho na base não se esquece. Apanha o que a API escrever, o que uma
 * migração escrever e o que alguém escrever à mão numa emergência.
 *
 * ## O que fica de fora, e porquê
 *
 * Só as tabelas que a política manda replicar (ver `policy.ts`). Pôr um gatilho
 * no saldo de stock ou nas séries fiscais seria criar trabalho para depois
 * descartar — e, pior, dar a impressão de que esses dados viajam.
 */
import { isReplicated } from '@nexus/replication';

/** Nome do diário, dentro do schema da empresa. */
export const JOURNAL_TABLE = 'sync_journal';
const FN = 'nexus_sync_journal';

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Nome inválido: ${name}`);
  return `"${name}"`;
}

/**
 * Cria o diário e a função do gatilho. Idempotente — corre a cada arranque.
 *
 * `seq` é `BIGSERIAL`: dá uma ordem total e crescente das alterações deste
 * posto. É por ela que a sincronização sabe onde ficou; uma data não servia,
 * porque duas alterações no mesmo milissegundo ficariam empatadas e uma delas
 * podia ser saltada para sempre.
 */
export function journalDdl(schema: string): string[] {
  const s = ident(schema);
  const j = `${s}.${ident(JOURNAL_TABLE)}`;
  return [
    `CREATE TABLE IF NOT EXISTS ${j} (
       seq         BIGSERIAL PRIMARY KEY,
       table_name  TEXT        NOT NULL,
       row_id      TEXT,
       op          CHAR(1)     NOT NULL,
       changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
       device_id   TEXT,
       synced_at   TIMESTAMPTZ
     )`,
    // Índice PARCIAL: as linhas já sincronizadas são a esmagadora maioria e não
    // interessam à consulta que corre a toda a hora ("o que falta subir?").
    `CREATE INDEX IF NOT EXISTS sync_journal_pending_idx
       ON ${j}(seq) WHERE synced_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS sync_journal_row_idx ON ${j}(table_name, row_id)`,
    // A função lê o posto de `nexus.device_id` (definido pela ligação). O
    // segundo argumento `true` do current_setting devolve NULL em vez de
    // rebentar quando a definição não existe — uma ligação que se esqueça dela
    // não pode fazer falhar uma VENDA.
    `CREATE OR REPLACE FUNCTION ${s}.${ident(FN)}() RETURNS trigger AS $$
     DECLARE
       v_id TEXT;
     BEGIN
       IF (TG_OP = 'DELETE') THEN
         v_id := to_jsonb(OLD) ->> 'id';
       ELSE
         v_id := to_jsonb(NEW) ->> 'id';
       END IF;
       INSERT INTO ${j} (table_name, row_id, op, device_id)
       VALUES (TG_TABLE_NAME, v_id, LEFT(TG_OP, 1), current_setting('nexus.device_id', true));
       RETURN NULL;
     END;
     $$ LANGUAGE plpgsql`,
  ];
}

/**
 * Liga o gatilho às tabelas que a política manda replicar.
 *
 * `AFTER` e `FOR EACH ROW`: só se regista o que foi mesmo gravado. Um gatilho
 * `BEFORE` registaria alterações que a transação viesse a desfazer, e o posto
 * passava a vida a tentar subir coisas que não existem.
 */
export function attachTriggersSql(schema: string, tables: string[]): string[] {
  const s = ident(schema);
  const out: string[] = [];
  for (const t of tables) {
    if (!isReplicated(t)) continue;
    const nome = ident(`${t}_sync_journal`);
    out.push(`DROP TRIGGER IF EXISTS ${nome} ON ${s}.${ident(t)}`);
    out.push(
      `CREATE TRIGGER ${nome}
         AFTER INSERT OR UPDATE OR DELETE ON ${s}.${ident(t)}
         FOR EACH ROW EXECUTE FUNCTION ${s}.${ident(FN)}()`,
    );
  }
  return out;
}

/** As tabelas que ficaram DE FORA (para o registo do posto dizer porquê). */
export function skippedTables(tables: string[]): string[] {
  return tables.filter((t) => !isReplicated(t) && t !== JOURNAL_TABLE);
}

export interface PendingChange {
  seq: string;
  table_name: string;
  row_id: string | null;
  op: 'I' | 'U' | 'D';
  changed_at: Date;
  device_id: string | null;
}

/**
 * O que falta subir. Agrupado por linha: se o mesmo produto foi editado dez
 * vezes sem rede, sobe UMA vez com o estado final — subir as dez seria mandar
 * nove versões que ninguém vai ver.
 *
 * Para o que é append-only (faturas, movimentos) não há agrupamento possível
 * nem desejável: cada linha é um facto próprio, e é por isso que o `DISTINCT`
 * usa o `id` da linha e não a tabela.
 */
export function pendingSql(schema: string, limit: number): string {
  const j = `${ident(schema)}.${ident(JOURNAL_TABLE)}`;
  const n = Math.min(Math.max(1, limit), 1000);
  // ⚠️ A SUBCONSULTA NÃO É ESTILO — é uma correção.
  //
  // Escrito em bloco só (`SELECT DISTINCT ON (...) seq::text, ... ORDER BY ...,
  // seq DESC`), o PostgreSQL faz o `ORDER BY` referir-se ao **nome de saída** —
  // que ali era o `seq` já convertido em TEXTO. E em texto, `'9' > '16'`.
  //
  // O efeito era escolher uma alteração ANTIGA como se fosse a última: o motor
  // subiria o estado errado da linha e, se ela tivesse sido apagada entretanto,
  // ressuscitava-a. Apanhado a correr contra PostgreSQL a sério; nenhuma base
  // de mentira teria mostrado isto.
  //
  // Aqui dentro `seq` é o BIGINT verdadeiro e a ordem é numérica. A conversão
  // para texto fica cá fora, onde já não pode influenciar ordenação nenhuma
  // (JavaScript não tem inteiros de 64 bits com precisão).
  return `SELECT seq::text AS seq, table_name, row_id, op, changed_at, device_id
          FROM (
            SELECT DISTINCT ON (table_name, row_id)
                   seq, table_name, row_id, op, changed_at, device_id
            FROM ${j}
            WHERE synced_at IS NULL
            ORDER BY table_name, row_id, seq DESC
          ) ultimas
          ORDER BY seq
          LIMIT ${n}`;
}

/** Marca como sincronizado tudo o que pertence às linhas dadas, até `seq`. */
export function markSyncedSql(schema: string): string {
  const j = `${ident(schema)}.${ident(JOURNAL_TABLE)}`;
  // `seq <= $3` e não `seq = $3`: entre a leitura e esta marcação a linha pode
  // ter sido tocada outra vez. Marcar só a entrada lida deixaria as anteriores
  // pendentes para sempre; marcar TODAS até àquela deixa a mais recente por
  // subir, que é o correto — ela vai na volta seguinte.
  return `UPDATE ${j} SET synced_at = now()
          WHERE table_name = $1 AND row_id IS NOT DISTINCT FROM $2
            AND seq <= $3::bigint AND synced_at IS NULL`;
}

/**
 * Limpeza do que já foi sincronizado há mais de `dias`.
 *
 * O diário cresce com cada venda. Num posto movimentado seriam milhões de
 * linhas por ano a ocupar disco sem servir para nada — mas não se apaga logo:
 * o histórico recente é o que permite perceber o que aconteceu quando uma
 * sincronização corre mal.
 */
export function pruneSql(schema: string, dias = 30): string {
  const j = `${ident(schema)}.${ident(JOURNAL_TABLE)}`;
  const d = Math.max(1, Math.floor(dias));
  return `DELETE FROM ${j} WHERE synced_at IS NOT NULL AND synced_at < now() - INTERVAL '${d} days'`;
}
