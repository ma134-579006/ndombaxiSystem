/**
 * Definições do posto. Poucas, e nenhuma delas técnica ao ponto de o lojista
 * ter de a perceber — o requisito é "baixar, instalar, abrir, usar".
 */
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

/** As apps instaláveis são ferramentas de trabalho: gerir e vender. A Loja
 *  Online é a montra do cliente final e vive no navegador — não é empacotada. */
export type ModuleId = 'gestao' | 'caixa';

export interface Settings {
  /** Módulo que abre por omissão. `null` = ainda não escolheu. */
  module: ModuleId | null;
  /** API a que este posto se liga. */
  apiUrl: string;
  /** Última janela: posição e tamanho, para abrir onde o utilizador deixou. */
  window?: { x?: number; y?: number; width: number; height: number; maximized: boolean };
  /**
   * Usar o servidor local (PostgreSQL neste posto) em vez da nuvem.
   *
   * Falso por omissão, e tem de continuar assim: uma base local VAZIA a servir
   * a aplicação é o lojista a abrir o programa e não encontrar a empresa. Só
   * pode ficar verdadeiro depois de os dados terem sido trazidos para cá — e
   * mesmo assim o `local-server` volta a verificar (ver `readiness.ts`).
   */
  localServer?: boolean;
}

/** API de produção. O instalador não pergunta nada ao lojista. */
const DEFAULT_API = 'https://ndombaxi-api-img.onrender.com';

const DEFAULTS: Settings = {
  module: null,
  apiUrl: process.env.NDOMBAXI_API_URL || DEFAULT_API,
  // Nunca ligado por omissão — ver o comentário em `Settings.localServer`.
  localServer: false,
};

function file(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function readSettings(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<Settings>;
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(patch: Partial<Settings>): Settings {
  const next = { ...readSettings(), ...patch };
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8');
  } catch { /* preferências são melhor-esforço; não travam a aplicação */ }
  return next;
}
