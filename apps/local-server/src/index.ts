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
