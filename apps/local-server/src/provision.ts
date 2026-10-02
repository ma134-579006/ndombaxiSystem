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
  /** URL base da API (ex.: https://ndombaxi-api-3nmz.onrender.com). */
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
  /** Schema do tenant na base local. Com um servidor recente, é substituído pelo
   *  nome real da nuvem (`/company/snapshot/platform`). */
  schema: string;
  /** Pasta com `tenant_template.sql`/`tenant_migrations.sql` (API empacotada). Com
   *  ela, o schema da empresa é criado na base local antes da cópia. */
  sqlDir?: string;
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
  partial?: { table: string; offset: number; after?: string | null };
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
  // Letras/dígitos/_ (maiúsculas incluídas: colunas de plataforma em camelCase, ex. "priceKz").
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Nome inválido: ${name}`);
  return `"${name}"`;
}

/**
 * Copia a empresa da nuvem para a base local. Devolve o que copiou; lança se
 * não conseguir terminar — e nesse caso NÃO marca como provisionado.
 */
export async function provisionFromCloud(o: ProvisionOptions): Promise<ProvisionResult> {
  const log = o.log ?? (() => undefined);
  const doFetch = o.fetchImpl ?? fetch;
  // Páginas grandes: com catálogos de milhões de linhas, páginas de 200 davam
  // dezenas de milhares de pedidos. O servidor novo aceita até 5000.
  const pageSize = Math.min(Math.max(1, o.pageSize ?? 2000), 5000);

  const headers = {
    Authorization: `Bearer ${o.cloud.accessToken}`,
    'X-Tenant-Code': o.cloud.companyCode,
  };
  const base = o.cloud.apiUrl.replace(/\/+$/, '');

  // 1) PLATAFORMA: registo da empresa, plano e subscrições → a API local passa a
  //    reconhecer a empresa (login, X-Tenant-Code). Servidor antigo (404): salta.
  const plat = await doFetch(`${base}/company/snapshot/platform`, { headers });
  if (plat.ok) {
    const p = (await plat.json()) as { schema: string; companies: unknown[]; plans: unknown[]; subscriptions: unknown[] };
    if (p.schema) o.schema = p.schema;
    for (const [tabela, linhas] of [['plans', p.plans], ['companies', p.companies], ['subscriptions', p.subscriptions]] as const) {
      if (!Array.isArray(linhas) || linhas.length === 0) continue;
      const cols = [...new Set((linhas as Record<string, unknown>[]).flatMap((r) => Object.keys(r)))];
      const t = `nexus_public.${ident(tabela)}`;
      const lista = cols.map(ident).join(', ');
      await o.run(
        `INSERT INTO ${t} (${lista}) SELECT ${lista} FROM json_populate_recordset(NULL::${t}, $1::json) ON CONFLICT DO NOTHING`,
        [JSON.stringify(linhas)],
      );
    }
    log(`plataforma: empresa e plano registados (schema ${o.schema})`);
  }
  // 2) SCHEMA DA EMPRESA criado localmente com o MESMO modelo da nuvem.
  if (o.sqlDir) {
    await o.run(`CREATE SCHEMA IF NOT EXISTS ${ident(o.schema)}`, []);
    for (const f of ['tenant_template.sql', 'tenant_migrations.sql']) {
      const file = path.join(o.sqlDir, f);
      if (!existsSync(file)) continue;
      const sql = readFileSync(file, 'utf8').split('{{SCHEMA}}').join(o.schema);
      const stmts = sql.split('\n').map((l) => { const i = l.indexOf('--'); return i >= 0 ? l.slice(0, i) : l; })
        .join('\n').split(';').map((x) => x.trim()).filter(Boolean);
      for (const st of stmts) { try { await o.run(st, []); } catch { /* idempotente: o que já existe falha e segue */ } }
    }
    log(`schema ${o.schema} pronto na base local`);
  }

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
    // Cursor por posição (keyset) quando o servidor o suporta — sem OFFSET.
    let after: string | null | undefined = anterior?.partial?.table === t.table ? anterior.partial.after : undefined;

    for (;;) {
      const url = `${base}/company/snapshot/rows?table=${encodeURIComponent(t.table)}`
        + `&offset=${offset}&limit=${pageSize}&after=${encodeURIComponent(after ?? '')}`;
      const r = await doFetch(url, { headers });
      if (!r.ok) throw new Error(`Falha ao copiar ${t.table} (HTTP ${r.status}).`);
      const page = (await r.json()) as { rows: Record<string, unknown>[]; done: boolean; next?: string | null };

      const linhas = page.rows.filter((row) => Object.keys(row).length > 0);
      if (linhas.length > 0) {
        // UMA instrução por página (json_populate_recordset), em vez de uma por
        // linha: milhões de linhas deixam de ser milhões de idas à base.
        const cols = [...new Set(linhas.flatMap((row) => Object.keys(row)))];
        const tabela = `${ident(o.schema)}.${ident(t.table)}`;
        const lista = cols.map(ident).join(', ');
        // ON CONFLICT DO NOTHING: repetir a cópia nunca estraga o que já cá está.
        const sql = `INSERT INTO ${tabela} (${lista}) SELECT ${lista} `
          + `FROM json_populate_recordset(NULL::${tabela}, $1::json)`;
        try {
          await o.run(`${sql} ON CONFLICT DO NOTHING`, [JSON.stringify(linhas)]);
        } catch (e) {
          // Tabelas FISCAIS só de acréscimo (com RULE contra alterações) não aceitam
          // ON CONFLICT: inserção simples — a cópia continua pelo cursor, sem repetir.
          if (!/ON CONFLICT clause cannot be used/i.test((e as Error).message)) throw e;
          await o.run(sql, [JSON.stringify(linhas)]);
        }
        totalLinhas += linhas.length;
      }
      offset += page.rows.length;
      // Servidor novo devolve `next` (cursor); o antigo não — continua por offset.
      if ('next' in page) after = page.next ?? null;
      progresso.partial = { table: t.table, offset, after };
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
