/**
 * Onde vive o servidor local, no disco.
 *
 * Regra: os DADOS do lojista ficam na pasta de dados do utilizador (sobrevivem a
 * atualizações e desinstalações) e os BINÁRIOS ficam junto da aplicação (são
 * substituídos a cada atualização). Misturar os dois é como se perdem bases de
 * dados numa atualização — por isso estão separados aqui, num sítio só.
 */
import path from 'node:path';
import type { PostgresPaths } from './postgres';

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
    apiDir: path.join(o.resourcesDir, 'api'),
    backupDir: path.join(base, 'backups'),
  };
}
