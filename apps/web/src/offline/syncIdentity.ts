/**
 * Identidade de sincronização da GESTÃO no aparelho (ver `syncAuth.ts`).
 * Chave própria: no Android a Gestão e a Caixa partilham a memória e cada uma
 * tem a sua família de tokens — uma nunca roda os tokens da outra.
 * O refresh é injetado por `api/client.ts` (evita import circular).
 */
import { durableGet, durableSet } from '../sharedCache';
import { createSyncAuth, type SyncIdentity, type TokenPairLike } from './syncAuth';
import { bootstrapFromVault, vaultTokensRotated } from './session';

const KEY = 'offline:syncIdentity:gestao';

let refreshImpl: ((rt: string) => Promise<TokenPairLike>) | null = null;
export function setSyncRefresh(fn: (rt: string) => Promise<TokenPairLike>): void { refreshImpl = fn; }

export const syncAuth = createSyncAuth({
  async load() {
    const v = await durableGet<SyncIdentity>(KEY).catch(() => null);
    if (v?.accessToken && v.refreshToken) return v;
    return bootstrapFromVault();
  },
  async save(v) { await durableSet(KEY, v); },
  async refresh(rt) {
    if (!refreshImpl) throw Object.assign(new Error('sem cliente'), { status: 0 });
    return refreshImpl(rt);
  },
  onRotated(oldRt, pair) { void vaultTokensRotated(oldRt, pair); },
});
