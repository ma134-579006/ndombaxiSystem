/**
 * PROVISIONAMENTO — trazer a empresa da nuvem para a base de dados do posto.
 *
 * É a peça que faltava para o servidor local deixar de ser uma promessa: sem
 * ela a base local está vazia, e a barreira em `readiness.ts` (com razão)
 * recusa-se a deixá-la substituir a nuvem.
 *
 * ## Regras que este ficheiro respeita, e porquê
 *
 * **Só marca provisionado no fim, e só se tudo entrou.** Uma cópia a meio é
 * pior do que nenhuma: a aplicação passaria a servir uma empresa incompleta e
 * ninguém daria por isso até faltar uma fatura. Em caso de falha, a marca não é
 * escrita e o posto continua na nuvem.
 *
 * **Retomável.** Uma cópia inicial numa ligação angolana pode demorar e cair a
 * meio. Guardamos o progresso por tabela; recomeçar continua de onde ficou em
 * vez de voltar ao princípio.
 *
 * **Ordem dada pelo servidor.** A ordem de dependências vem do endpoint
 * (derivada do próprio schema), não de uma lista aqui — uma lista local ficava
 * desatualizada em silêncio a cada tabela nova.
 *
 * **Nunca apaga o que já lá está.** As inserções são `ON CONFLICT DO NOTHING`:
 * repetir a cópia é seguro, e uma linha que o posto já tenha não é substituída
 * por uma versão da nuvem (isso é trabalho da sincronização, não desta cópia).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { markProvisioned, type ReadinessPaths } from './readiness';

export interface SnapshotTable {
  table: string;
  rows: number;
  dependsOn: string[];
}

/** O que é preciso para falar com a API da nuvem. */
export interface CloudAccess {
  /** URL base da API (ex.: https://ndombaxi-api-img.onrender.com). */
  apiUrl: string;
  /** Token de acesso de um COMPANY_ADMIN. */
  accessToken: string;
  /** Código da empresa (cabeçalho X-Tenant-Code). */
  companyCode: string;
}

/** Executa SQL na base local. Injetado para isto ser testável sem PostgreSQL. */
export type SqlRunner = (sql: string, params: unknown[]) => Promise<void>;

export interface ProvisionOptions {
  paths: ReadinessPaths;
  cloud: CloudAccess;
  run: SqlRunner;
  /** Schema do tenant na base local (o mesmo nome da nuvem). */
  schema: string;
  /** Tamanho da página. O servidor limita a 500. */
  pageSize?: number;
  log?: (line: string) => void;
  /** Injetável para teste; por omissão o `fetch` global. */
  fetchImpl?: typeof fetch;
}

export interface ProvisionResult {
  tables: number;
  rows: number;
  resumed: boolean;
}

interface Progress {
  /** Tabelas já COMPLETAS. */
  done: string[];
  /** Tabela a meio e em que linha ia. */
  partial?: { table: string; offset: number };
  startedAt: string;
}

const PROGRESS_FILE = 'provision-progress.json';

function progressFile(paths: ReadinessPaths): string {
  return path.join(path.dirname(paths.dataDir), PROGRESS_FILE);
}
function readProgress(paths: ReadinessPaths): Progress | null {
  try { return JSON.parse(readFileSync(progressFile(paths), 'utf-8')) as Progress; }
  catch { return null; }
}
function writeProgress(paths: ReadinessPaths, p: Progress): void {
  const f = progressFile(paths);
  try { mkdirSync(path.dirname(f), { recursive: true }); } catch { /* já existe */ }
  writeFileSync(f, JSON.stringify(p), 'utf-8');
}
function clearProgress(paths: ReadinessPaths): void {
  try { if (existsSync(progressFile(paths))) writeFileSync(progressFile(paths), '{}', 'utf-8'); }
  catch { /* melhor esforço */ }
}

/** Identificador SQL seguro (a validação a sério é o servidor só devolver tabelas reais). */
function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Nome inválido: ${name}`);
  return `"${name}"`;
}

/**
 * Copia a empresa da nuvem para a base local. Devolve o que copiou; lança se
 * não conseguir terminar — e nesse caso NÃO marca como provisionado.
 */
export async function provisionFromCloud(o: ProvisionOptions): Promise<ProvisionResult> {
  const log = o.log ?? (() => undefined);
  const doFetch = o.fetchImpl ?? fetch;
  const pageSize = Math.min(Math.max(1, o.pageSize ?? 200), 500);

  const headers = {
    Authorization: `Bearer ${o.cloud.accessToken}`,
    'X-Tenant-Code': o.cloud.companyCode,
  };
  const base = o.cloud.apiUrl.replace(/\/+$/, '');

  const res = await doFetch(`${base}/company/snapshot/tables`, { headers });
  if (!res.ok) throw new Error(`Não foi possível listar as tabelas da empresa (HTTP ${res.status}).`);
  const tables = (await res.json()) as SnapshotTable[];
  if (!Array.isArray(tables) || tables.length === 0) {
    throw new Error('A empresa não devolveu tabelas — cópia abortada.');
  }

  const anterior = readProgress(o.paths);
  const feitas = new Set(anterior?.done ?? []);
  const resumed = feitas.size > 0;
  if (resumed) log(`a retomar: ${feitas.size} de ${tables.length} tabelas já copiadas`);

  const progresso: Progress = {
    done: [...feitas],
    startedAt: anterior?.startedAt ?? new Date().toISOString(),
  };
  let totalLinhas = 0;

  for (const t of tables) {
    if (feitas.has(t.table)) continue;
    // Retoma no meio da tabela onde ficou (não recomeça a tabela inteira).
    let offset = anterior?.partial?.table === t.table ? anterior.partial.offset : 0;

    for (;;) {
      const url = `${base}/company/snapshot/rows?table=${encodeURIComponent(t.table)}`
        + `&offset=${offset}&limit=${pageSize}`;
      const r = await doFetch(url, { headers });
      if (!r.ok) throw new Error(`Falha ao copiar ${t.table} (HTTP ${r.status}).`);
      const page = (await r.json()) as { rows: Record<string, unknown>[]; done: boolean };

      for (const row of page.rows) {
        const cols = Object.keys(row);
        if (cols.length === 0) continue;
        const marcadores = cols.map((_, i) => `$${i + 1}`).join(', ');
        // ON CONFLICT DO NOTHING: repetir a cópia nunca estraga o que já cá está.
        await o.run(
          `INSERT INTO ${ident(o.schema)}.${ident(t.table)} `
          + `(${cols.map(ident).join(', ')}) VALUES (${marcadores}) ON CONFLICT DO NOTHING`,
          cols.map((c) => row[c]),
        );
        totalLinhas += 1;
      }
      offset += page.rows.length;
      progresso.partial = { table: t.table, offset };
      writeProgress(o.paths, progresso);
      if (page.done) break;
    }

    progresso.done.push(t.table);
    delete progresso.partial;
    writeProgress(o.paths, progresso);
    log(`copiada: ${t.table} (${t.rows} linhas esperadas)`);
  }

  // SÓ AGORA. Marcar antes de tudo entrar seria pôr a aplicação a servir uma
  // empresa incompleta — o erro que esta cópia existe para evitar.
  markProvisioned(o.paths, o.cloud.companyCode);
  clearProgress(o.paths);
  log(`cópia concluída: ${tables.length} tabelas, ${totalLinhas} linhas`);
  return { tables: tables.length, rows: totalLinhas, resumed };
}
