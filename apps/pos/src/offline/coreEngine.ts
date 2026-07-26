/**
 * Fatia 3 · FASE A (shadow read) — motor unificado @nexus/offline-core no POS.
 *
 * Corre EM PARALELO com o SyncController atual (`./sync.ts`), mas por agora só
 * faz PULL: mantém em cache local (IndexedDB `ndombaxi-offline`, distinta da
 * `ndombaxi-pos` das vendas pendentes) as MESMAS entidades que o endpoint `/sync`
 * serve — as projeções de nível caixa, exatamente o que o POS precisa. Objetivo
 * desta fase: validar que esta cache bate com o `CACHE_PRODUCTS` atual, SEM tocar
 * no fluxo de vendas. A migração das vendas para a outbox é a Fase B.
 *
 * Reutiliza a mesma fonte de sessão do cliente de API (token + código do tenant).
 */
import { API_URL } from '../config';
import {
  SyncEngine,
  NetMonitor,
  httpTransport,
  pickStorage,
  type SyncStatus,
} from '@nexus/offline-core';

/** Entidades que o `/sync` sabe servir (ver `sync-registry.ts` na API). */
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

export function getCoreEngine(): SyncEngine | null {
  return engine;
}

export function getCoreSyncStatus(): SyncStatus | null {
  return lastStatus;
}

export function subscribeCoreSyncStatus(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  if (lastStatus) fn(lastStatus);
  return () => { listeners.delete(fn); };
}

/** Acorda o motor ao regressar ao 1.º plano (torna o wake() vivo também no POS). */
function wireForeground(): void {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  const wake = () => { if (document.visibilityState === 'visible') void engine?.wake(); };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', () => { void engine?.wake(); });
}

/** Arranca o motor unificado (idempotente). */
export async function startCoreEngine(auth: OfflineAuth): Promise<SyncEngine | null> {
  if (engine) return engine;
  if (starting) return starting;
  starting = (async () => {
    const storage = await pickStorage(); // IndexedDB no browser/Electron
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
export async function stopCoreEngine(): Promise<void> {
  const e = engine;
  engine = null;
  lastStatus = null;
  if (e) await e.stop();
}
