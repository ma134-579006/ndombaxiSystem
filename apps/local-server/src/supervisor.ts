/**
 * Supervisor do Ndombaxi Local Server.
 *
 * Responsabilidade única: garantir que, quando o lojista abre a aplicação, existe
 * uma API a responder em `127.0.0.1` — com ou sem internet, tenha ou não alguém
 * mexido no computador. Se algo cair, levanta-o outra vez. O utilizador nunca
 * abre um terminal, nunca vê uma senha, nunca escolhe uma porta.
 *
 * Ordem de arranque (e a razão de cada passo):
 *   1. Base local pronta      → sem base não há nada; é o único passo que pode
 *                               ter de CRIAR alguma coisa (primeira execução).
 *   2. Migrações              → o esquema tem de corresponder a esta versão da
 *                               app ANTES de a API aceitar o primeiro pedido,
 *                               senão o primeiro utilizador apanha erros de SQL.
 *   3. API                    → arranca contra a base local.
 *   4. Vigia                  → sonda de saúde periódica; reinicia o que morrer.
 *
 * O que este ficheiro NÃO faz, de propósito: não reimplementa regra de negócio
 * nenhuma. A API que corre aqui é exatamente a mesma que corre no Aiven — a
 * diferença está só no `DATABASE_URL`.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  ensureLocalDatabase, findFreePort, readConfig, stop as stopPostgres,
  type PostgresPaths,
} from './postgres';

export interface SupervisorOptions {
  paths: PostgresPaths;
  /** Pasta da API compilada (com `dist/main.js`). */
  apiDir: string;
  /** Executável do Node a usar (no Electron, o próprio binário em modo Node). */
  nodePath?: string;
  /** Porta preferida para a API local. */
  apiPort?: number;
  /** Para onde sincronizar quando houver internet (Aiven). */
  cloudApiUrl?: string | null;
  /** Registo de diagnóstico (o chamador decide se escreve em ficheiro). */
  log?: (line: string) => void;
}

export interface LocalServerInfo {
  /** URL que as aplicações devem usar (ex.: http://127.0.0.1:3399). */
  apiUrl: string;
  apiPort: number;
  databaseUrl: string;
}

const DEFAULT_API_PORT = 3399;
const HEALTH_EVERY_MS = 15_000;
/** Falhas seguidas antes de reiniciar — uma sonda falhada pode ser só um pico. */
const FAILURES_BEFORE_RESTART = 3;

export class LocalServer {
  private api: ChildProcess | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  private info: LocalServerInfo | null = null;
  private stopping = false;

  constructor(private readonly o: SupervisorOptions) {}

  private log(line: string): void {
    this.o.log?.(`[local-server] ${line}`);
  }

  /** Arranca tudo. Idempotente: chamar duas vezes não duplica processos. */
  async start(): Promise<LocalServerInfo> {
    if (this.info && this.api && !this.api.killed) return this.info;
    this.stopping = false;

    this.log('a preparar a base de dados local…');
    const databaseUrl = await ensureLocalDatabase(this.o.paths);

    this.log('a aplicar migrações…');
    this.migrate(databaseUrl);

    const apiPort = await findFreePort(this.o.apiPort ?? DEFAULT_API_PORT);
    this.info = { apiUrl: `http://127.0.0.1:${apiPort}`, apiPort, databaseUrl };

    this.spawnApi();
    await this.waitHealthy(apiPort);
    this.watch();

    this.log(`pronto em ${this.info.apiUrl}`);
    return this.info;
  }

  /**
   * Aplica o esquema. `prisma db push` é deliberado em vez de `migrate deploy`:
   * o projeto mantém o esquema dos tenants em SQL próprio (`tenant_template.sql`
   * e `tenant_migrations.sql`, aplicados pelo provisionamento) e o `db push`
   * alinha o esquema público sem exigir um histórico de migrações que este
   * repositório não usa.
   */
  private migrate(databaseUrl: string): void {
    const r = spawnSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss=false'],
      {
        cwd: this.o.apiDir,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    if (r.status !== 0) {
      // Não escondemos: sem esquema correto, a app trabalharia sobre uma base
      // que não corresponde ao código — pior do que não arrancar.
      throw new Error(`Migração da base local falhou: ${r.stderr || r.stdout}`);
    }
  }

  private spawnApi(): void {
    const info = this.info;
    if (!info) throw new Error('start() ainda não correu');
    const entry = path.join(this.o.apiDir, 'dist', 'main.js');
    if (!existsSync(entry)) {
      throw new Error(`API local não encontrada em ${entry}. Reinstale o Ndombaxi System.`);
    }
    mkdirSync(this.o.paths.logDir, { recursive: true });

    this.api = spawn(this.o.nodePath ?? process.execPath, [entry], {
      cwd: this.o.apiDir,
      env: {
        ...process.env,
        // `ELECTRON_RUN_AS_NODE`: quando o executável é o do Electron, isto faz
        // com que corra como Node puro — assim não é preciso empacotar um Node
        // à parte só para servir a API.
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        DATABASE_URL: info.databaseUrl,
        PORT: String(info.apiPort),
        NDOMBAXI_MODE: 'local',
        ...(this.o.cloudApiUrl ? { NDOMBAXI_CLOUD_API: this.o.cloudApiUrl } : {}),
      },
      stdio: 'ignore',
      windowsHide: true,
    });

    this.api.on('exit', (code) => {
      this.log(`a API local terminou (código ${code ?? 'desconhecido'})`);
      this.api = null;
      // Não reiniciamos aqui: quem decide é a vigia, que já tem a política de
      // tentativas. Reiniciar nos dois sítios dava dois processos.
    });
  }

  /** Espera que a API responda — evita a app falar com um servidor a meio de subir. */
  private async waitHealthy(port: number, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.healthy(port)) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('A API local não respondeu a tempo.');
  }

  private async healthy(port: number): Promise<boolean> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: ctrl.signal });
        return res.ok;
      } finally { clearTimeout(t); }
    } catch {
      return false;
    }
  }

  /** Sonda periódica: se a API cair (ou deixar de responder), volta a levantá-la. */
  private watch(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void (async () => {
        if (this.stopping || !this.info) return;
        const ok = await this.healthy(this.info.apiPort);
        if (ok) { this.failures = 0; return; }
        this.failures++;
        if (this.failures < FAILURES_BEFORE_RESTART) return;
        this.failures = 0;
        this.log('a API local não responde — a reiniciar');
        try {
          this.api?.kill();
          this.api = null;
          this.spawnApi();
        } catch (e) {
          this.log(`falha ao reiniciar: ${(e as Error).message}`);
        }
      })();
    }, HEALTH_EVERY_MS);
    this.timer.unref?.();
  }

  /** URL para as aplicações (ou null se ainda não arrancou). */
  getInfo(): LocalServerInfo | null {
    return this.info;
  }

  /** Encerra API e base — chamado quando a aplicação fecha. */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.api?.kill();
    this.api = null;
    // Parar o Postgres em `fast` faz checkpoint: o próximo arranque não tem de
    // recuperar o WAL e nada fica por gravar.
    try {
      if (readConfig(this.o.paths)) stopPostgres(this.o.paths);
    } catch { /* melhor esforço no encerramento */ }
    this.info = null;
  }
}
