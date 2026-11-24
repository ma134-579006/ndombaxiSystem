/**
 * Onde vive o servidor local, no disco.
 *
 * Regra: os DADOS do lojista ficam na pasta de dados do utilizador (sobrevivem a
 * atualizações e desinstalações) e os BINÁRIOS ficam junto da aplicação (são
 * substituídos a cada atualização). Misturar os dois é como se perdem bases de
 * dados numa atualização — por isso estão separados aqui, num sítio só.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { PostgresPaths } from './postgres';

/**
 * INSTALAÇÃO RÁPIDA: a API do servidor local (~15 000 ficheiros pequenos) vai no
 * instalador como UM só arquivo, `resources/api.zip`. Criar milhares de
 * ficheiros um a um (com o antivírus a ver cada um) era o que tornava a
 * instalação lenta. O arquivo só é extraído — uma vez por versão, para a pasta
 * do utilizador — quando o servidor local é mesmo usado.
 */
const archives = new Map<string, string>();

function apiDirFor(o: LayoutOptions, base: string): string {
  const unpacked = path.join(o.resourcesDir, 'api');
  const archive = path.join(o.resourcesDir, 'api.zip');
  if (fs.existsSync(unpacked) || !fs.existsSync(archive)) return unpacked; // desenvolvimento / instaladores antigos
  const st = fs.statSync(archive);
  const dir = path.join(base, 'api', `${st.size}-${Math.round(st.mtimeMs)}`);
  archives.set(dir, archive);
  return dir;
}

/**
 * Garante que a API está extraída (no-op quando já está ou quando não há
 * arquivo). Extrai para uma pasta temporária e só no fim a torna definitiva —
 * uma extração interrompida nunca fica a meio. Apaga as versões anteriores.
 */
export function ensureApiExtracted(apiDir: string): void {
  const archive = archives.get(apiDir);
  if (!archive || fs.existsSync(path.join(apiDir, '.pronto'))) return;
  const parent = path.dirname(apiDir);
  fs.mkdirSync(parent, { recursive: true });
  const tmp = `${apiDir}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  // tar.exe vem com o Windows 10 (1803+) e 11 e extrai .zip.
  const tar = process.platform === 'win32' && process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', archive, '-C', tmp], { stdio: 'ignore', windowsHide: true });
  const inner = path.join(tmp, 'api');
  fs.rmSync(apiDir, { recursive: true, force: true });
  fs.renameSync(fs.existsSync(inner) ? inner : tmp, apiDir);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(path.join(apiDir, '.pronto'), new Date().toISOString());
  for (const e of fs.readdirSync(parent)) {
    const p = path.join(parent, e);
    if (p !== apiDir) fs.rmSync(p, { recursive: true, force: true });
  }
}

export interface LayoutOptions {
  /** Pasta de dados do utilizador (no Electron: `app.getPath('userData')`). */
  userDataDir: string;
  /** Pasta onde ficam os binários do Postgres portátil (dentro da app). */
  resourcesDir: string;
}

/** Estrutura de pastas do servidor local. */
export function layout(o: LayoutOptions): PostgresPaths & { apiDir: string; backupDir: string } {
  const base = path.join(o.userDataDir, 'local-server');
  return {
    // Binários: junto da aplicação (`resources/pgsql/bin`), substituíveis.
    binDir: path.join(o.resourcesDir, 'pgsql', 'bin'),
    // Dados: na pasta do utilizador. NUNCA dentro da aplicação.
    dataDir: path.join(base, 'pgdata'),
    configFile: path.join(base, 'db.json'),
    logDir: path.join(base, 'logs'),
    apiDir: apiDirFor(o, base),
    backupDir: path.join(base, 'backups'),
  };
}
