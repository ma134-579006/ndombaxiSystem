/**
 * QUANDO copiar a empresa para o posto — sozinho, sem perguntar nada.
 *
 * O dono do produto foi claro: *"não precisa de botão, deve ser automático e
 * inteligente"*. Automático é fácil. **Inteligente é o que este ficheiro faz.**
 *
 * Um "automático" ingénuo — copiar assim que houver rede — daria, em campo:
 *   • a cópia inteira a arrancar no meio da hora de ponta, com o operador a
 *     tentar cobrar enquanto a máquina puxa 30 mil linhas;
 *   • tentativas em ciclo contra um servidor em baixo, a gastar os dados móveis
 *     do lojista;
 *   • um posto emprestado, ou o portátil do contabilista, a ficar com uma cópia
 *     da empresa inteira só porque alguém entrou lá uma vez;
 *   • uma cópia iniciada com o disco cheio, que morre a meio e deixa a base
 *     ocupada sem servir para nada.
 *
 * Por isso a decisão está aqui, isolada e testável — em vez de espalhada por
 * `if`s no arranque do Electron, onde ninguém a conseguiria verificar.
 *
 * O que continua a valer, e não é negociável: a base local **nunca** serve a
 * aplicação antes de a cópia terminar por inteiro (`readiness.ts`). Tirou-se o
 * botão, não a proteção.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { readReadiness, type ReadinessPaths } from './readiness';

/** Estado das tentativas, para não insistir sem tino. */
interface AttemptState {
  failures: number;
  lastAttemptAt?: string;
  lastError?: string;
}

const FILE = 'provision-attempts.json';

function file(paths: ReadinessPaths): string {
  return path.join(path.dirname(paths.dataDir), FILE);
}
export function readAttempts(paths: ReadinessPaths): AttemptState {
  try { return JSON.parse(readFileSync(file(paths), 'utf-8')) as AttemptState; }
  catch { return { failures: 0 }; }
}
function writeAttempts(paths: ReadinessPaths, s: AttemptState): void {
  const f = file(paths);
  try { mkdirSync(path.dirname(f), { recursive: true }); } catch { /* já existe */ }
  try { writeFileSync(f, JSON.stringify(s), 'utf-8'); } catch { /* melhor esforço */ }
}

export function recordFailure(paths: ReadinessPaths, err: string): void {
  const s = readAttempts(paths);
  writeAttempts(paths, {
    failures: s.failures + 1,
    lastAttemptAt: new Date().toISOString(),
    lastError: err.slice(0, 300),
  });
}
export function recordSuccess(paths: ReadinessPaths): void {
  writeAttempts(paths, { failures: 0, lastAttemptAt: new Date().toISOString() });
}

/**
 * Espera entre tentativas: 1 min, 2, 4, 8 … até 6 horas.
 *
 * Sem isto, um servidor em baixo faria o posto tentar em ciclo — e num
 * telemóvel ou modem por dados móveis isso é dinheiro do lojista a arder.
 */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(60_000 * 2 ** (failures - 1), 6 * 60 * 60 * 1000);
}

export interface AutoContext {
  /** Os binários do PostgreSQL vieram no instalador? */
  binariesPresent: boolean;
  /** Há sessão iniciada de um administrador da empresa? */
  isCompanyAdmin: boolean;
  /** Empresa da sessão atual. */
  companyCode: string | null;
  /** Espaço livre no disco, em bytes (null = não foi possível saber). */
  freeDiskBytes: number | null;
  /** Está a decorrer uma venda / turno aberto? */
  busy: boolean;
  /** Agora (injetável para teste). */
  now?: Date;
}

export type AutoDecision =
  | { provision: true }
  | { provision: false; reason: string; retryInMs?: number };

/**
 * Espaço mínimo livre exigido. A cópia de uma empresa média não chega perto
 * disto, mas começar com o disco à beira do fim é garantir uma cópia morta a
 * meio — e uma base ocupada que não serve para nada.
 */
export const MIN_FREE_DISK = 2 * 1024 * 1024 * 1024; // 2 GB

/** Decide, e diz sempre PORQUÊ — o motivo vai para o log do posto. */
export function shouldProvision(paths: ReadinessPaths, ctx: AutoContext): AutoDecision {
  if (!ctx.binariesPresent) {
    return { provision: false, reason: 'os ficheiros da base local não vieram nesta instalação' };
  }

  const readiness = readReadiness(paths);
  if (readiness.provisioned) {
    // Já cá está. Se a empresa da sessão for OUTRA, não se copia por cima —
    // seria misturar duas empresas na mesma base.
    if (ctx.companyCode && readiness.companyCode && readiness.companyCode !== ctx.companyCode) {
      return {
        provision: false,
        reason: `este posto já tem os dados de ${readiness.companyCode}; não se copia outra empresa por cima`,
      };
    }
    return { provision: false, reason: 'já provisionado' };
  }

  // Só um ADMINISTRADOR pode trazer a empresa inteira para um aparelho. Um
  // operador de caixa entrar num posto emprestado não pode deixar lá as vendas,
  // os clientes e os salários da empresa.
  if (!ctx.isCompanyAdmin) {
    return { provision: false, reason: 'à espera de uma sessão de administrador da empresa' };
  }
  if (!ctx.companyCode) {
    return { provision: false, reason: 'sem empresa na sessão' };
  }

  // Copiar durante uma venda rouba a máquina a quem está a cobrar.
  if (ctx.busy) {
    return { provision: false, reason: 'há trabalho em curso na caixa — fica para depois', retryInMs: 5 * 60_000 };
  }

  if (ctx.freeDiskBytes !== null && ctx.freeDiskBytes < MIN_FREE_DISK) {
    const gb = (ctx.freeDiskBytes / 1024 / 1024 / 1024).toFixed(1);
    return { provision: false, reason: `espaço livre insuficiente (${gb} GB)`, retryInMs: 6 * 60 * 60 * 1000 };
  }

  // Falhou antes? Espera antes de voltar a insistir.
  const s = readAttempts(paths);
  if (s.failures > 0 && s.lastAttemptAt) {
    const espera = backoffMs(s.failures);
    const passou = (ctx.now ?? new Date()).getTime() - Date.parse(s.lastAttemptAt);
    if (passou < espera) {
      return {
        provision: false,
        reason: `${s.failures} tentativa(s) falhada(s); nova tentativa mais tarde`,
        retryInMs: espera - passou,
      };
    }
  }

  return { provision: true };
}
