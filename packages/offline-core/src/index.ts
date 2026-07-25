/**
 * @nexus/offline-core — motor Offline-First do Ndombaxi System.
 *
 * Um só motor para as três aplicações (Windows, Android, iOS) e para os três
 * frontends web. Zero dependências de runtime: o que corre no posto de venda é
 * exatamente o que corre nos testes.
 *
 * Uso típico:
 * ```ts
 * const storage = new IndexedDbAdapter();            // ou SqliteAdapter no Electron
 * const net = new NetMonitor({ healthUrl: `${API}/health` });
 * const engine = new SyncEngine({
 *   storage,
 *   net,
 *   transport: httpTransport({ baseUrl: API, getAuthHeader, getTenantCode }),
 *   entities: ['product', 'customer', 'promotion'],
 * });
 * await engine.start();
 *
 * // Vender sem internet — devolve mal fique gravado em disco:
 * await engine.enqueue({ entity: 'sale', op: 'create', payload: venda });
 * ```
 */

export * from './types';
export * from './backoff';
export * from './conflict';
export * from './crypto';
export * from './net';
export * from './transport';
export * from './engine';
export * from './session';

export { TABLES, entityKey, type StorageAdapter } from './storage/adapter';
export { IndexedDbAdapter } from './storage/indexeddb';
export { SqliteAdapter, type SqlBridge } from './storage/sqlite';
export { MemoryAdapter } from './storage/memory';

/**
 * Escolhe o melhor armazenamento disponível no ambiente atual.
 * Preferimos SQLite (desktop) → IndexedDB (web/móvel) → memória (último recurso).
 */
export async function pickStorage(
  sqlBridge?: import('./storage/sqlite').SqlBridge,
): Promise<import('./storage/adapter').StorageAdapter> {
  const { SqliteAdapter } = await import('./storage/sqlite');
  const { IndexedDbAdapter } = await import('./storage/indexeddb');
  const { MemoryAdapter } = await import('./storage/memory');

  if (sqlBridge) {
    const a = new SqliteAdapter(sqlBridge);
    try { await a.open(); return a; } catch { /* cai para o seguinte */ }
  }
  if (IndexedDbAdapter.supported()) {
    const a = new IndexedDbAdapter();
    try { await a.open(); return a; } catch { /* cai para o seguinte */ }
  }
  // Sem durabilidade, mas o utilizador CONTINUA a poder trabalhar. Nunca
  // bloqueamos o trabalho por causa do armazenamento.
  const m = new MemoryAdapter();
  await m.open();
  return m;
}
