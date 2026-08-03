/**
 * Arranque do motor Offline-First na Gestão (web/desktop).
 *
 * Fatia 1 da integração offline-first: liga o `@nexus/offline-core` — o MESMO
 * motor testado que corre no POS e no móvel — à Gestão, que até agora não tinha
 * qualquer capacidade offline. É ADITIVO: mantém o cache local das entidades de
 * referência (produtos, clientes, …) e expõe o estado de sincronização, sem
 * alterar nenhum fluxo de dados existente.
 *
 * O motor arranca quando o gestor autentica e pára no logout (ver AuthContext).
 * Reutiliza a mesma fonte de sessão do cliente de API (token + código do tenant),
 * por isso segue automaticamente a renovação proativa do token.
 */
import { API_URL } from '../config';
import {
  SyncEngine,
  NetMonitor,
  httpTransport,
  pickStorage,
  type SyncStatus,
} from '@nexus/offline-core';
import { deviceSqlBridge } from './sqlBridge';

/**
 * Entidades que o endpoint `/sync` sabe servir (ver `sync-registry.ts` na API).
 * O push só aceita `sale`/`customer`; aqui interessa sobretudo o PULL — manter o
 * catálogo e os clientes em cache local para leitura offline.
 */
const ENTITIES = ['product', 'category', 'customer', 'promotion', 'store', 'paymentMethod'];

export interface OfflineAuth {
  getAccessToken(): string | null;
  getCompanyCode(): string | null | undefined;
}

let engine: SyncEngine | null = null;
let starting: Promise<SyncEngine | null> | null = null;
let wired = false;
let lastStatus: SyncStatus | null = null;
const listeners = new Set<(s: SyncStatus) => void>();

/** Motor atual (ou null se ainda não arrancou). */
export function getOfflineEngine(): SyncEngine | null {
  return engine;
}

/** Estado de sincronização atual (ou null). */
export function getSyncStatus(): SyncStatus | null {
  return lastStatus;
}

/** Observa o estado de sincronização. Devolve uma função para cancelar. */
export function subscribeSyncStatus(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  if (lastStatus) fn(lastStatus);
  return () => { listeners.delete(fn); };
}

/** Acorda o motor ao regressar ao 1.º plano — torna o `wake()` vivo na Gestão. */
function wireForeground(): void {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  const wake = () => { if (document.visibilityState === 'visible') void engine?.wake(); };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', () => { void engine?.wake(); });
}

/** Arranca o motor (idempotente). Seguro chamar em cada autenticação. */
export async function startOfflineEngine(auth: OfflineAuth): Promise<SyncEngine | null> {
  if (engine) return engine;
  if (starting) return starting;
  starting = (async () => {
    // SQLite do APARELHO quando existe (Electron via preload, Android via
    // plugin) — é ele que dá WAL e um ficheiro único para backup. Sem ponte,
    // `pickStorage` segue para IndexedDB e, em último recurso, memória: o
    // trabalho nunca é bloqueado por causa do armazenamento.
    const storage = await pickStorage(await deviceSqlBridge());
    const net = new NetMonitor({ healthUrl: `${API_URL}/health` });
    const transport = httpTransport({
      baseUrl: API_URL,
      getAuthHeader: () => {
        const t = auth.getAccessToken();
        return t ? `Bearer ${t}` : null;
      },
      getTenantCode: () => auth.getCompanyCode() ?? null,
    });
    const e = new SyncEngine({ storage, net, transport, entities: ENTITIES });
    e.subscribe((s) => {
      lastStatus = s;
      for (const fn of listeners) fn(s);
    });
    await e.start();
    engine = e;
    wireForeground();
    return e;
  })().finally(() => { starting = null; });
  return starting;
}

/** Pára o motor (no logout). */
export async function stopOfflineEngine(): Promise<void> {
  const e = engine;
  engine = null;
  lastStatus = null;
  if (e) await e.stop();
}
