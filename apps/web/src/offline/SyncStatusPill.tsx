import { useEffect, useState } from 'react';
import { isNativeApp } from '../config';
import type { SyncStatus } from '@nexus/offline-core';
import { subscribeSyncStatus, getSyncStatus } from './boot';
import { subscribeOutbox } from './outbox';
import { toast } from '../components/feedback';

/**
 * Indicador de estado de sincronização Offline-First na barra da Gestão.
 * Consumidor real do motor (`@nexus/offline-core`): mostra ONLINE / OFFLINE /
 * SERVIDOR e quantas operações estão por sincronizar. Renderiza NADA quando o
 * motor não está a correr (ex.: sessão de super admin, sem schema de tenant).
 */
const LABEL: Record<SyncStatus['link'], { text: string; color: string }> = {
  ONLINE: { text: 'Sincronizado', color: '#16a34a' },
  OFFLINE: { text: 'Offline', color: '#a16207' },
  SERVER_DOWN: { text: 'Servidor indisponível', color: '#dc2626' },
};

export function SyncStatusPill() {
  if (!isNativeApp()) return null; // navegador: 100% online — sem indicador de sincronização
  const [status, setStatus] = useState<SyncStatus | null>(getSyncStatus());
  const [queued, setQueued] = useState(0);
  useEffect(() => subscribeSyncStatus(setStatus), []);
  useEffect(() => subscribeOutbox(setQueued), []);
  useEffect(() => {
    const onFail = (e: Event) => {
      const d = (e as CustomEvent<{ message?: string }>).detail;
      toast.warning(`Uma alteração feita sem rede não pôde ser aplicada: ${d?.message ?? 'recusada pelo servidor'}.`);
    };
    window.addEventListener('ndombaxi:outbox-failed', onFail);
    return () => window.removeEventListener('ndombaxi:outbox-failed', onFail);
  }, []);
  // Sincronização AUTOMÁTICA e INVISÍVEL (decisão do dono do produto): com ou sem rede,
  // a barra não mostra nada. Só a recusa de uma alteração pelo servidor avisa (toast acima).
  void status; void queued;
  return null;
}
