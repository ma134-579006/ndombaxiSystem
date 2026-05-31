import { useEffect, useState } from 'react';
import { syncController, type SyncState } from './sync';

/** Subscreve o estado de sincronização (online/pendentes/a sincronizar). */
export function useSync(): SyncState & { flush: () => void } {
  const [state, setState] = useState<SyncState>(syncController.getState());

  useEffect(() => {
    syncController.start();
    const unsub = syncController.subscribe(setState);
    return unsub;
  }, []);

  return { ...state, flush: () => void syncController.flush() };
}
