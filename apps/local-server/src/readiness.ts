/**
 * QUANDO é que o servidor local pode passar a ser a API da aplicação.
 *
 * Isto existe por causa de uma armadilha real, encontrada ao preparar o
 * empacotamento dos binários do PostgreSQL:
 *
 *   `startLocalServer()` (no Electron) arranca assim que os binários existem, e
 *   a partir daí TODOS os frontends preferem `window.ndombaxi.apiUrl`. Ou seja:
 *   bastava incluir os binários no instalador para que, na atualização
 *   seguinte, cada posto passasse a falar com uma base de dados VAZIA. O
 *   lojista abria a aplicação e não encontrava a empresa, nem os produtos, nem
 *   as vendas. Um servidor local sem os dados lá dentro não é uma
 *   funcionalidade a meio — é perda de acesso ao negócio.
 *
 * Por isso a base local só pode servir a aplicação quando estiverem reunidas
 * DUAS condições, e ambas são verificadas aqui:
 *
 *   1. **Ligado de propósito** — nunca por omissão, nunca por uma atualização.
 *      Se aparecesse sozinho numa atualização, ninguém tinha escolhido nada.
 *   2. **Provisionado** — a base local já recebeu os dados da empresa. Marcado
 *      por quem fizer essa sincronização, e por mais ninguém.
 *
 * Enquanto as duas não se verificarem, o servidor local pode até estar a
 * correr, mas a aplicação continua a usar a nuvem. É a diferença entre uma
 * fundação e uma ratoeira.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface ReadinessPaths {
  /** Pasta de dados do servidor local (`userData/local-server`). */
  dataDir: string;
}

/** Estado gravado em disco, ao lado dos dados do cluster. */
interface ReadinessState {
  /** A base local já recebeu os dados da empresa? */
  provisioned: boolean;
  /** Empresa que lá está (evita servir os dados de outra). */
  companyCode?: string;
  /** Quando foi provisionada (ISO). */
  provisionedAt?: string;
  /** Última sincronização com a nuvem bem sucedida (ISO). */
  syncedAt?: string;
}

const FILE = 'readiness.json';

function stateFile(paths: ReadinessPaths): string {
  // O ficheiro vive JUNTO dos dados, não dos binários: se o cluster for
  // apagado, a marca desaparece com ele — que é exatamente o que queremos.
  return path.join(path.dirname(paths.dataDir), FILE);
}

/** Lê o estado (nunca falha: sem ficheiro = não provisionado). */
export function readReadiness(paths: ReadinessPaths): ReadinessState {
  try {
    const raw = readFileSync(stateFile(paths), 'utf-8');
    const s = JSON.parse(raw) as ReadinessState;
    return { provisioned: s.provisioned === true, companyCode: s.companyCode, provisionedAt: s.provisionedAt, syncedAt: s.syncedAt };
  } catch {
    return { provisioned: false };
  }
}

/**
 * Marca a base local como provisionada. Só deve ser chamado por quem tiver
 * MESMO trazido os dados da empresa para cá — chamar isto sem os dados é
 * exatamente a avaria que este ficheiro existe para evitar.
 */
export function markProvisioned(paths: ReadinessPaths, companyCode: string): void {
  const f = stateFile(paths);
  try { mkdirSync(path.dirname(f), { recursive: true }); } catch { /* já existe */ }
  const current = readReadiness(paths);
  const next: ReadinessState = {
    ...current,
    provisioned: true,
    companyCode,
    provisionedAt: current.provisionedAt ?? new Date().toISOString(),
    syncedAt: new Date().toISOString(),
  };
  writeFileSync(f, JSON.stringify(next, null, 2), 'utf-8');
}

/** Motivo por que o servidor local NÃO pode servir a aplicação (null = pode). */
export function blockedReason(
  paths: ReadinessPaths, opts: { enabled: boolean },
): string | null {
  if (!opts.enabled) return 'não está ligado nas definições deste posto';
  const state = readReadiness(paths);
  if (!state.provisioned) {
    return 'a base local ainda não recebeu os dados da empresa (por sincronizar)';
  }
  return null;
}

/** Existe estado provisionado para esta empresa? */
export function isProvisionedFor(paths: ReadinessPaths, companyCode: string): boolean {
  const s = readReadiness(paths);
  return s.provisioned && (!s.companyCode || s.companyCode === companyCode);
}
