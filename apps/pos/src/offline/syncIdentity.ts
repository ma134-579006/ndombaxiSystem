/**
 * Identidade de sincronização no APARELHO (ver `pos/syncAuth.ts`).
 * Guardada no armazenamento durável (IndexedDB partilhado + espelho), tal como o
 * cofre offline. O refresh é injetado por `api/client.ts` (evita import circular).
 */
import { durableGet, durableSet } from '../sharedCache';
import { createSyncAuth, type SyncIdentity, type TokenPairLike } from '../pos/syncAuth';
import { bootstrapFromVault, vaultTokensRotated } from './session';

const KEY = 'offline:syncIdentity';

let refreshImpl: ((rt: string, company: string) => Promise<TokenPairLike>) | null = null;
export function setSyncRefresh(fn: (rt: string, company: string) => Promise<TokenPairLike>): void { refreshImpl = fn; }

export const syncAuth = createSyncAuth({
  async load() {
    const v = await durableGet<SyncIdentity>(KEY).catch(() => null);
    if (v?.accessToken && v.refreshToken) return v;
    // Instalações anteriores a esta versão: parte do cofre offline (último login
    // com rede). Pode estar desatualizado — se o servidor o recusar, é apagado.
    return bootstrapFromVault(localStorage.getItem('nexus.pos.company'));
  },
  async save(v) { await durableSet(KEY, v); },
  async refresh(rt, company) {
    if (!refreshImpl) throw Object.assign(new Error('sem cliente'), { status: 0 });
    return refreshImpl(rt, company);
  },
  onRotated(oldRt, pair) { void vaultTokensRotated(oldRt, pair); },
});
