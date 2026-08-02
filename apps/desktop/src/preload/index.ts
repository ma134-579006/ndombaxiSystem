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
    /** Volta ao lançador (o 1.º ecrã, para trocar de módulo). */
    openLauncher: (): Promise<void> => ipcRenderer.invoke('ndombaxi:open-launcher'),
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

/**
 * Seta de VOLTAR ao lançador — injetada pelo shell APENAS nos módulos (Gestão e
 * Caixa), nunca no próprio lançador. É a forma de trocar de módulo: clara,
 * sempre visível, sem barra de menus. Vive no shell (desktop), por isso não
 * obriga a mexer nos frontends — o site continua sem este botão.
 */
function injectBackButton(): void {
  const host = window.location.host; // 'gestao' | 'caixa' | 'launcher'
  if (host !== 'gestao' && host !== 'caixa') return;
  if (document.getElementById('ndx-back-launcher')) return;

  const btn = document.createElement('button');
  btn.id = 'ndx-back-launcher';
  btn.type = 'button';
  btn.title = 'Voltar ao início (trocar de módulo)';
  btn.setAttribute('aria-label', 'Voltar ao início');
  btn.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M19 12H5M11 18l-6-6 6-6"/></svg>';

  const s = btn.style;
  s.position = 'fixed';
  s.top = '8px';
  s.left = '8px';
  s.zIndex = '2147483647';
  s.width = '34px';
  s.height = '34px';
  s.display = 'grid';
  s.placeItems = 'center';
  s.padding = '0';
  s.borderRadius = '10px';
  s.border = '1px solid rgba(148,163,184,.32)';
  s.background = 'rgba(15,23,42,.78)';
  s.color = '#e2e8f0';
  s.cursor = 'pointer';
  s.boxShadow = '0 4px 14px rgba(0,0,0,.28)';
  s.transition = 'background .15s ease, transform .15s ease';
  btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(36,48,232,.9)'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(15,23,42,.78)'; });
  btn.addEventListener('click', () => { void ipcRenderer.invoke('ndombaxi:open-launcher'); });

  document.body.appendChild(btn);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectBackButton);
} else {
  injectBackButton();
}

export type NdombaxiBridge = typeof api;
