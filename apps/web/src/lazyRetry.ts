import React from 'react';

const KEY = 'nx.chunkReload';

export function isChunkError(e: unknown): boolean {
  const msg = String((e as { message?: string } | null)?.message ?? e ?? '');
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|error loading dynamically/i.test(msg);
}

/** Uma recarga por chunk em falta a cada 30 s (evita ciclos). */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* sem sessionStorage: recarrega na mesma */ }
  location.reload();
  return true;
}

/**
 * React.lazy que sobrevive a uma nova publicação: se o ficheiro da página já não
 * existe (versão antiga em cache), recarrega a app e mantém o "A carregar…" no
 * ecrã — o utilizador nunca vê um erro passageiro.
 */
export function lazyRetry<T extends React.ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return React.lazy(async () => {
    try {
      return await factory();
    } catch (e) {
      if (isChunkError(e) && reloadForNewVersion()) return new Promise<{ default: T }>(() => undefined);
      throw e;
    }
  });
}
