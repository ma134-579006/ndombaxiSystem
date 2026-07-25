/**
 * Ponte entre a interface e o processo principal.
 *
 * Esta é a ÚNICA superfície que o código da interface consegue tocar do lado
 * nativo. É deliberadamente pequena: cada função aqui é uma porta que alguém
 * teria de arrombar. Não há `require`, não há `fs`, não há `child_process` —
 * uma dependência do npm comprometida dentro do frontend não consegue ler o
 * disco nem executar nada, só chamar estas funções nominais.
 */
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  /** Identifica o hospedeiro — o frontend adapta-se sem `if (Electron)` espalhados. */
  platform: 'windows' as const,
  version: (): Promise<string> => ipcRenderer.invoke('ndombaxi:version'),

  /** Ponte SQLite consumida pelo `SqliteAdapter` de @nexus/offline-core. */
  db: {
    query: <T>(sql: string, params?: unknown[]): Promise<T[]> =>
      ipcRenderer.invoke('ndombaxi:db-query', sql, params),
    exec: (sql: string, params?: unknown[]): Promise<void> =>
      ipcRenderer.invoke('ndombaxi:db-exec', sql, params),
    batch: (statements: { sql: string; params?: unknown[] }[]): Promise<void> =>
      ipcRenderer.invoke('ndombaxi:db-batch', statements),
    backup: (): Promise<{ ok: boolean; path?: string }> =>
      ipcRenderer.invoke('ndombaxi:db-backup'),
  },

  /** Segredo do dispositivo, para cifrar em repouso. */
  device: {
    secret: (): Promise<{ secret: string; hardwareBacked: boolean }> =>
      ipcRenderer.invoke('ndombaxi:device-secret'),
  },

  settings: {
    read: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('ndombaxi:settings-read'),
    setModule: (moduleId: string): Promise<void> =>
      ipcRenderer.invoke('ndombaxi:settings-module', moduleId),
  },

  update: {
    check: (): Promise<unknown> => ipcRenderer.invoke('ndombaxi:update-check'),
    openDownloadPage: (): Promise<void> => ipcRenderer.invoke('ndombaxi:update-open'),
    /** Avisa quando o processo principal encontra uma versão nova. */
    onAvailable: (fn: (verdict: unknown) => void): (() => void) => {
      const handler = (_e: unknown, verdict: unknown) => fn(verdict);
      ipcRenderer.on('ndombaxi:update-available', handler);
      return () => { ipcRenderer.off('ndombaxi:update-available', handler); };
    },
  },
};

contextBridge.exposeInMainWorld('ndombaxi', api);

export type NdombaxiBridge = typeof api;
