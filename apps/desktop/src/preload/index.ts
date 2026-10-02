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

  /**
   * Endereço da API a usar. `null` = o que ficou gravado no build (a nuvem).
   * Com o SERVIDOR LOCAL a correr, traz `http://127.0.0.1:<porta>` e a aplicação
   * deixa de precisar de internet para trabalhar.
   *
   * Vem por `sendSync` de propósito: o frontend lê isto ao definir a sua base de
   * API, ANTES do primeiro pedido. Uma promessa obrigaria o código de arranque a
   * ser assíncrono e abria uma janela em que os primeiros pedidos ainda saíam
   * para a nuvem. É a leitura de uma variável em memória do processo principal.
   */
  apiUrl: ipcRenderer.sendSync('ndombaxi:api-url') as string | null,

  /**
   * Oferece a sessão atual ao processo principal para ele decidir, sozinho, se
   * é altura de trazer a empresa para este posto (ver `autoProvision`).
   *
   * O frontend NÃO decide nada: só diz quem está a usar a aplicação. Toda a
   * inteligência — papel de quem entrou, espaço em disco, caixa ocupada,
   * tentativas falhadas — vive do lado do processo principal, onde é testável.
   */
  provisionLocal: (session: {
    accessToken: string; companyCode: string; apiUrl: string; role: string; busy?: boolean;
  }): Promise<{ done: boolean; reason?: string; rows?: number }> =>
    ipcRenderer.invoke('ndombaxi:local-provision', session),

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

  /**
   * O SERVIDOR DESTA LOJA: em que estado está e em que endereço os outros
   * aparelhos (telemóvel, tablet, 2.º posto) o encontram.
   */
  localServer: {
    status: (): Promise<{
      binaries: boolean; provisioned: boolean; companyCode?: string | null;
      running: boolean; apiUrl?: string | null; sharing?: boolean;
      lanUrl?: string | null; blocked?: string | null; error?: string;
    }> => ipcRenderer.invoke('ndombaxi:local-status'),
    setSharing: (on: boolean): Promise<{ sharing: boolean; needsRestart: boolean }> =>
      ipcRenderer.invoke('ndombaxi:local-share', on),
  },

  /**
   * Entrar com Google. Abre o navegador do sistema (o Google recusa o seu login
   * dentro de WebViews) e devolve o `id_token` — o mesmo que o botão do site
   * produz, para o resto do fluxo não mudar nada.
   */
  google: {
    signIn: (): Promise<{ idToken: string | null; error?: string }> =>
      ipcRenderer.invoke('ndombaxi:google-signin'),
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
 * Caixa), nunca no próprio lançador. Serve para TROCAR de módulo ANTES de entrar,
 * por isso aparece SÓ no ecrã de login; assim que há sessão ativa esconde-se
 * (há "Terminar sessão" dentro do módulo) e reaparece no logout. Deteta a sessão
 * pelos mesmos tokens que os frontends guardam no sessionStorage — igual ao
 * back-launcher do móvel, para o comportamento ser idêntico nas duas apps.
 * Vive no shell (desktop), por isso não obriga a mexer nos frontends.
 */
// Sessão ativa → esconder a seta. Gestor: ndombaxi.web.access · Caixa: nexus.pos.access.
const AUTH_KEYS = ['ndombaxi.web.access', 'nexus.pos.access'];
function isLoggedIn(): boolean {
  try {
    for (const k of AUTH_KEYS) {
      if (sessionStorage.getItem(k) || localStorage.getItem(k)) return true;
    }
  } catch { /* storage indisponível */ }
  return false;
}

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

  // A entrada é feita numa SPA (sem recarregar): reavaliamos periodicamente e
  // nos eventos de foco/armazenamento — a seta desaparece assim que a sessão é
  // criada e reaparece no logout.
  const sync = () => { btn.style.display = isLoggedIn() ? 'none' : 'grid'; };
  sync();
  setInterval(sync, 800);
  window.addEventListener('focus', sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('storage', sync);
}

/**
 * Seta QUASE INVISÍVEL no canto superior direito: a app corre em ecrã inteiro
 * (sem barra de título nem barra de tarefas); um clique aqui mostra Minimizar,
 * Sair/Entrar em ecrã inteiro e Fechar. Em todos os ecrãs (lançador e módulos).
 */
function injectWindowControls(): void {
  if (document.getElementById('ndx-winctl')) return;
  const wrap = document.createElement('div');
  wrap.id = 'ndx-winctl';
  wrap.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;font:500 13px system-ui,Segoe UI,sans-serif;';
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.title = 'Janela (minimizar, ecrã inteiro, fechar)';
  tab.setAttribute('aria-label', 'Controlos da janela');
  tab.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  tab.style.cssText = 'width:22px;height:14px;padding:0;display:grid;place-items:center;border:0;border-radius:0 0 0 8px;background:rgba(100,116,139,.18);color:rgba(100,116,139,.55);cursor:pointer;opacity:.35;transition:opacity .15s,background .15s;';
  tab.addEventListener('mouseenter', () => { tab.style.opacity = '1'; tab.style.background = 'rgba(36,48,232,.9)'; tab.style.color = '#fff'; });
  tab.addEventListener('mouseleave', () => { if (panel.style.display === 'none') { tab.style.opacity = '.35'; tab.style.background = 'rgba(100,116,139,.18)'; tab.style.color = 'rgba(100,116,139,.55)'; } });
  const panel = document.createElement('div');
  panel.style.cssText = 'display:none;margin:4px 6px 0 0;padding:6px;border-radius:12px;background:#fff;color:#0f172a;box-shadow:0 18px 40px -12px rgba(15,23,42,.45);border:1px solid rgba(15,23,42,.08);min-width:190px;';
  const item = (label: string, action: string, danger = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = `display:block;width:100%;text-align:left;padding:9px 12px;border:0;border-radius:8px;background:transparent;cursor:pointer;font:inherit;color:${danger ? '#dc2626' : 'inherit'};`;
    b.addEventListener('mouseenter', () => { b.style.background = danger ? 'rgba(220,38,38,.08)' : 'rgba(36,48,232,.08)'; });
    b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
    b.addEventListener('click', async () => {
      hide();
      const fs = await ipcRenderer.invoke('ndombaxi:window', action);
      if (action === 'fullscreen') fsBtn.textContent = fs ? 'Sair de ecrã inteiro' : 'Ecrã inteiro';
    });
    panel.appendChild(b);
    return b;
  };
  item('Minimizar', 'minimize');
  const fsBtn = item('Sair de ecrã inteiro', 'fullscreen');
  item('Fechar o LPS Vendas', 'close', true);
  const hide = () => { panel.style.display = 'none'; tab.style.opacity = '.35'; tab.style.background = 'rgba(100,116,139,.18)'; tab.style.color = 'rgba(100,116,139,.55)'; };
  tab.addEventListener('click', (e) => { e.stopPropagation(); panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target as Node)) hide(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  wrap.append(tab, panel);
  document.body.appendChild(wrap);
}

function injectShell(): void {
  injectBackButton();
  injectWindowControls();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectShell);
} else {
  injectShell();
}

export type NdombaxiBridge = typeof api;
