/**
 * Ndombaxi Local Server — API e base de dados no próprio posto.
 *
 * O que resolve: até aqui as aplicações falavam DIRETAMENTE com o servidor na
 * nuvem. Sem internet, tudo o que fosse ESCRITA parava — e o lojista angolano
 * passa dias sem linha. Com o servidor local, as aplicações falam sempre com
 * `127.0.0.1`; a nuvem passa a ser destino de sincronização, não dependência
 * para trabalhar.
 *
 * A API é a MESMA (mesmas regras fiscais, mesma numeração, mesmo SAF-T). Muda o
 * `DATABASE_URL` — e é essa a razão de isto ser viável sem reescrever o sistema.
 */
export { LocalServer, type LocalServerInfo, type SupervisorOptions } from './supervisor';
export { layout, type LayoutOptions } from './paths';
export {
  binariesPresent, ensureLocalDatabase, backup, connectionUrl, readConfig,
  type PostgresPaths, type LocalDbConfig,
} from './postgres';
export {
  blockedReason, readReadiness, markProvisioned, isProvisionedFor,
  type ReadinessPaths,
} from './readiness';
export {
  provisionFromCloud,
  type ProvisionOptions, type ProvisionResult, type CloudAccess,
  type SnapshotTable, type SqlRunner,
} from './provision';
export {
  shouldProvision, backoffMs, readAttempts, recordFailure, recordSuccess,
  MIN_FREE_DISK, type AutoContext, type AutoDecision,
} from './autoprovision';
export { openRunner, type RunnerHandle } from './sql-runner';
// A política é PARTILHADA com a nuvem (mesmo ficheiro, não uma cópia).
export {
  classify, isReplicated, canPushFromDevice, canPullToDevice, unknownTables, resolve,
  type DataClass, type Version, type Winner, type Resolution,
} from '@nexus/replication';
export {
  journalDdl, attachTriggersSql, skippedTables, pendingSql, markSyncedSql, pruneSql,
  JOURNAL_TABLE, type PendingChange,
} from './replication/journal';
export {
  pushPending, pullAndApply, pullStateDdl, pruneJournal,
  type EngineOptions, type PushResult, type PullApplyResult, type SqlQuery,
} from './replication/engine';
