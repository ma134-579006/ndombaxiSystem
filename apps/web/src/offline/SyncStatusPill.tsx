import { useEffect, useState } from 'react';
import type { SyncStatus } from '@nexus/offline-core';
import { subscribeSyncStatus, getSyncStatus } from './boot';

/**
 * Indicador de estado de sincronização Offline-First na barra da Gestão.
 * Consumidor real do motor (`@nexus/offline-core`): mostra ONLINE / OFFLINE /
 * SERVIDOR e quantas operações estão por sincronizar. Renderiza NADA quando o
 * motor não está a correr (ex.: sessão de super admin, sem schema de tenant).
 */
const LABEL: Record<SyncStatus['link'], { text: string; color: string }> = {
  ONLINE: { text: 'Sincronizado', color: '#16a34a' },
  OFFLINE: { text: 'Offline', color: '#d97706' },
  SERVER_DOWN: { text: 'Servidor indisponível', color: '#dc2626' },
};

export function SyncStatusPill() {
  const [status, setStatus] = useState<SyncStatus | null>(getSyncStatus());
  useEffect(() => subscribeSyncStatus(setStatus), []);
  if (!status) return null;

  const meta = LABEL[status.link] ?? LABEL.OFFLINE;
  const pending = status.pending + status.blocked;
  const title = [
    meta.text,
    pending > 0 ? `${pending} por sincronizar` : null,
    status.syncing ? 'a sincronizar…' : null,
  ].filter(Boolean).join(' · ');

  return (
    <span
      title={title}
      aria-label={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
        color: 'var(--text-soft, #64748b)',
        border: '1px solid var(--border, rgba(128,128,128,.25))',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 8, height: 8, borderRadius: 999, background: meta.color,
          boxShadow: status.syncing ? `0 0 0 3px ${meta.color}22` : 'none',
          transition: 'box-shadow .2s',
        }}
      />
      <span className="sync-pill-text">{meta.text}</span>
      {pending > 0 ? (
        <span style={{ background: meta.color, color: '#fff', borderRadius: 999, padding: '0 6px', fontSize: 11 }}>
          {pending > 99 ? '99+' : pending}
        </span>
      ) : null}
    </span>
  );
}
