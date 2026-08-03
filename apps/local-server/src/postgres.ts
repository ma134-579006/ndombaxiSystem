/**
 * PostgreSQL LOCAL, sem instalação e sem Docker.
 *
 * Porquê PostgreSQL e não SQLite (a pergunta óbvia): a API não é portável entre
 * motores. Usa schema por empresa (`SET search_path`), `$queryRaw` com sintaxe
 * do Postgres, `FOR UPDATE`, índices ÚNICOS PARCIAIS (é deles que depende a
 * impossibilidade de duplicar uma fatura) e `to_regclass`. Trocar o motor
 * obrigaria a reescrever a camada fiscal — exatamente o que não se pode partir.
 * Por isso o servidor local corre o MESMO Postgres, apenas em modo portátil.
 *
 * "Portátil" aqui quer dizer: usamos os binários (`initdb`, `pg_ctl`, `postgres`)
 * a partir de uma pasta, sem passar por um instalador do sistema, sem serviço
 * registado e sem privilégios de administrador. É assim que o SQL Server Express
 * LocalDB e o Docker Desktop resolvem o mesmo problema.
 *
 * Nada aqui pergunta seja o que for ao utilizador: se a base não existe, cria-se.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export interface PostgresPaths {
  /** Pasta com `bin/` do Postgres portátil (initdb, pg_ctl, postgres). */
  binDir: string;
  /** Pasta de dados do cluster (criada na 1.ª execução). */
  dataDir: string;
  /** Ficheiro onde guardamos a senha gerada e a porta escolhida. */
  configFile: string;
  /** Pasta de logs. */
  logDir: string;
}

export interface LocalDbConfig {
  port: number;
  password: string;
  database: string;
  user: string;
}

const DB_NAME = 'ndombaxi';
const DB_USER = 'ndombaxi';
/** Fora do intervalo habitual (5432) para não colidir com um Postgres já instalado. */
const DEFAULT_PORT = 55432;

function exe(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

/** Caminho de um utilitário do Postgres portátil. */
function tool(paths: PostgresPaths, name: string): string {
  return path.join(paths.binDir, exe(name));
}

/**
 * Os binários existem? Sem eles não há servidor local — e é melhor dizê-lo alto
 * do que arrancar meio sistema e falhar mais à frente, com o utilizador já a
 * vender.
 */
export function binariesPresent(paths: PostgresPaths): boolean {
  return ['initdb', 'pg_ctl', 'postgres'].every((t) => existsSync(tool(paths, t)));
}

/** Porta livre a partir da preferida (o posto pode já ter algo a ouvir). */
export async function findFreePort(preferred = DEFAULT_PORT): Promise<number> {
  for (let p = preferred; p < preferred + 50; p++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => srv.close(() => resolve(true)));
      srv.listen(p, '127.0.0.1');
    });
    if (free) return p;
  }
  throw new Error('Não há portas livres para a base de dados local.');
}

/** Lê a configuração já criada, ou `null` na primeira execução. */
export function readConfig(paths: PostgresPaths): LocalDbConfig | null {
  try {
    if (!existsSync(paths.configFile)) return null;
    return JSON.parse(readFileSync(paths.configFile, 'utf8')) as LocalDbConfig;
  } catch {
    return null;
  }
}

function writeConfig(paths: PostgresPaths, cfg: LocalDbConfig): void {
  mkdirSync(path.dirname(paths.configFile), { recursive: true });
  writeFileSync(paths.configFile, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

/**
 * Cria o cluster na primeira execução.
 *
 * A senha é GERADA e nunca mostrada — o utilizador não tem de a saber nem de a
 * escolher, e não fica um `postgres/postgres` à espera de ser encontrado. O
 * cluster só aceita ligações de 127.0.0.1 (ver `start`), por isso a base local
 * não fica exposta na rede sem alguém decidir isso explicitamente.
 */
export function initCluster(paths: PostgresPaths): LocalDbConfig {
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.logDir, { recursive: true });

  const password = randomBytes(24).toString('base64url');
  const pwFile = path.join(path.dirname(paths.configFile), '.pgpw');
  writeFileSync(pwFile, password, { mode: 0o600 });

  const r = spawnSync(
    tool(paths, 'initdb'),
    [
      '-D', paths.dataDir,
      '-U', DB_USER,
      '--pwfile', pwFile,
      '-E', 'UTF8',
      // Ordenação independente do idioma do Windows: dois postos com
      // configurações regionais diferentes têm de ordenar igual, senão os
      // relatórios divergem entre máquinas da mesma empresa.
      '--locale=C',
      '--auth-local=trust',
      '--auth-host=scram-sha-256',
    ],
    { encoding: 'utf8' },
  );
  try { writeFileSync(pwFile, ''); } catch { /* melhor esforço */ }
  if (r.status !== 0) {
    throw new Error(`initdb falhou: ${r.stderr || r.stdout || 'sem detalhe'}`);
  }

  const cfg: LocalDbConfig = { port: DEFAULT_PORT, password, database: DB_NAME, user: DB_USER };
  writeConfig(paths, cfg);
  return cfg;
}

/** O cluster já está a servir nesta porta? */
export function isRunning(paths: PostgresPaths, port: number): boolean {
  const r = spawnSync(tool(paths, 'pg_isready'), ['-h', '127.0.0.1', '-p', String(port)], {
    encoding: 'utf8',
  });
  return r.status === 0;
}

/**
 * Arranca o cluster.
 *
 * `listen_addresses=127.0.0.1` é deliberado: a base local NÃO fica aberta à rede.
 * A partilha entre postos (LAN) é uma decisão à parte, com regra de firewall
 * própria — não um efeito colateral de instalar o programa.
 */
export function start(paths: PostgresPaths, cfg: LocalDbConfig): void {
  if (isRunning(paths, cfg.port)) return;
  mkdirSync(paths.logDir, { recursive: true });
  const logFile = path.join(paths.logDir, 'postgres.log');

  const r = spawnSync(
    tool(paths, 'pg_ctl'),
    [
      '-D', paths.dataDir,
      '-l', logFile,
      '-o', `-p ${cfg.port} -c listen_addresses=127.0.0.1`,
      // Espera até estar a aceitar ligações — arrancar a API contra uma base que
      // ainda não responde dava um erro de arranque intermitente e inexplicável.
      '-w', '-t', '60',
      'start',
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0 && !isRunning(paths, cfg.port)) {
    throw new Error(`Não foi possível arrancar a base local: ${r.stderr || r.stdout}`);
  }
}

/** Pára o cluster em modo `fast` (faz checkpoint; não corrompe). */
export function stop(paths: PostgresPaths): void {
  spawnSync(tool(paths, 'pg_ctl'), ['-D', paths.dataDir, '-m', 'fast', '-w', '-t', '30', 'stop'], {
    encoding: 'utf8',
  });
}

/** Cria a base de dados da aplicação se ainda não existir (idempotente). */
export function ensureDatabase(paths: PostgresPaths, cfg: LocalDbConfig): void {
  const env = { ...process.env, PGPASSWORD: cfg.password };
  const exists = spawnSync(
    tool(paths, 'psql'),
    ['-h', '127.0.0.1', '-p', String(cfg.port), '-U', cfg.user, '-d', 'postgres',
      '-tAc', `SELECT 1 FROM pg_database WHERE datname='${cfg.database}'`],
    { encoding: 'utf8', env },
  );
  if (exists.stdout.trim() === '1') return;
  const created = spawnSync(
    tool(paths, 'createdb'),
    ['-h', '127.0.0.1', '-p', String(cfg.port), '-U', cfg.user, cfg.database],
    { encoding: 'utf8', env },
  );
  if (created.status !== 0) {
    throw new Error(`Não foi possível criar a base local: ${created.stderr}`);
  }
}

/** URL de ligação para a API (o mesmo formato que ela já usa para o Aiven). */
export function connectionUrl(cfg: LocalDbConfig): string {
  const pw = encodeURIComponent(cfg.password);
  return `postgresql://${cfg.user}:${pw}@127.0.0.1:${cfg.port}/${cfg.database}?schema=public`;
}

/**
 * Garante a base local pronta a receber a API: cluster criado, a correr e com a
 * base de dados existente. Devolve o URL de ligação. Idempotente — pode ser
 * chamado em todos os arranques.
 */
export async function ensureLocalDatabase(paths: PostgresPaths): Promise<string> {
  if (!binariesPresent(paths)) {
    throw new Error(
      'Os ficheiros da base de dados local não foram encontrados. '
      + 'Reinstale o Ndombaxi System — o instalador inclui tudo o que é preciso.',
    );
  }
  let cfg = readConfig(paths);
  if (!cfg || !existsSync(path.join(paths.dataDir, 'PG_VERSION'))) {
    cfg = initCluster(paths);
  }
  if (!isRunning(paths, cfg.port)) {
    // A porta guardada pode ter sido ocupada por outro programa entretanto.
    const free = await findFreePort(cfg.port);
    if (free !== cfg.port) { cfg = { ...cfg, port: free }; writeConfig(paths, cfg); }
    start(paths, cfg);
  }
  ensureDatabase(paths, cfg);
  return connectionUrl(cfg);
}

/** Cópia de segurança do cluster inteiro (ficheiro único, restaurável). */
export function backup(paths: PostgresPaths, cfg: LocalDbConfig, destFile: string): void {
  mkdirSync(path.dirname(destFile), { recursive: true });
  const env = { ...process.env, PGPASSWORD: cfg.password };
  const r = spawnSync(
    tool(paths, 'pg_dump'),
    ['-h', '127.0.0.1', '-p', String(cfg.port), '-U', cfg.user, '-d', cfg.database,
      '-F', 'c', '-f', destFile],
    { encoding: 'utf8', env },
  );
  if (r.status !== 0) throw new Error(`Backup falhou: ${r.stderr}`);
}

/** Arranca o `postgres` em primeiro plano (para quem quiser supervisionar). */
export function spawnForeground(paths: PostgresPaths, cfg: LocalDbConfig) {
  return spawn(
    tool(paths, 'postgres'),
    ['-D', paths.dataDir, '-p', String(cfg.port), '-c', 'listen_addresses=127.0.0.1'],
    { stdio: 'ignore', windowsHide: true },
  );
}
