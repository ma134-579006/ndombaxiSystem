/**
 * Processo principal do Ndombaxi System para Windows.
 *
 * Postura de segurança, e o ataque que cada linha fecha:
 *   • `contextIsolation: true`      → uma biblioteca comprometida no frontend não
 *                                     alcança os módulos internos do Electron.
 *   • `nodeIntegration: false`      → nenhum `require` dentro da interface.
 *   • `sandbox: true`               → o renderer corre no sandbox do Chromium.
 *   • navegação bloqueada           → uma página externa nunca substitui a app;
 *                                     ligações externas abrem no navegador.
 *   • `setWindowOpenHandler` a negar→ sem janelas-filhas com privilégios.
 *   • instância única                → dois postos a escrever no mesmo SQLite dava
 *                                     corrupção; a 2.ª execução foca a 1.ª janela.
 */
import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { registerScheme, serveModules, SCHEME } from './protocol';
import { openDatabase, closeDatabase, query, exec, batch, backupTo } from './database';
import { deviceSecret } from './secure-store';
import { readSettings, writeSettings, type ModuleId } from './settings';
import { checkForUpdates, openDownloadPage, scheduleUpdateCheck } from './updater';
import { buildMenu } from './menu';

registerScheme(); // obrigatoriamente antes de `whenReady`

/** Um único posto por máquina — protege a integridade da base local. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

/**
 * Endereço da API que os frontends devem usar.
 *
 * `null` = usar o endereço gravado no build (a nuvem), que é o comportamento de
 * sempre. Passa a ter valor quando o SERVIDOR LOCAL arranca — aí as aplicações
 * falam com `127.0.0.1` e deixam de precisar de internet para trabalhar.
 *
 * O recuo é deliberado: se o servidor local não puder arrancar (binários em
 * falta numa atualização, disco cheio, porta tomada), a aplicação continua a
 * funcionar contra a nuvem em vez de não abrir. Uma funcionalidade nova não pode
 * tirar ao lojista o que ele já tinha.
 */
let localApiUrl: string | null = null;
let localServer: import('@nexus/local-server').LocalServer | null = null;

/** Arranca o servidor local, se estiver disponível. Nunca impede a app de abrir. */
async function startLocalServer(): Promise<void> {
  try {
    const { LocalServer, layout, binariesPresent } = await import('@nexus/local-server');
    const paths = layout({
      userDataDir: app.getPath('userData'),
      resourcesDir: app.isPackaged
        ? process.resourcesPath
        : path.join(__dirname, '..', '..', 'resources'),
    });
    if (!binariesPresent(paths)) {
      logLocal('servidor local indisponível (binários não incluídos) — a usar a nuvem');
      return;
    }
    localServer = new LocalServer({ paths, apiDir: paths.apiDir, log: logLocal });
    const info = await localServer.start();
    localApiUrl = info.apiUrl;
    logLocal(`servidor local pronto em ${info.apiUrl}`);
  } catch (e) {
    localServer = null;
    localApiUrl = null;
    logLocal(`servidor local não arrancou (${(e as Error).message}) — a usar a nuvem`);
  }
}

/** Diagnóstico em ficheiro: num posto sem consola, é a única forma de saber. */
function logLocal(line: string): void {
  try {
    const f = path.join(app.getPath('userData'), 'local-server.log');
    fs.appendFileSync(f, `[${new Date().toISOString()}] ${line}\n`);
  } catch { /* nada mais a fazer */ }
}

/** Pasta com os frontends compilados (empacotados como `resources/modules`). */
function modulesRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'modules')
    : path.join(__dirname, '..', '..', 'resources', 'modules');
}

const MODULE_HOSTS: Record<ModuleId, string> = {
  gestao: 'gestao',
  caixa: 'caixa',
};

function moduleUrl(id: ModuleId): string {
  return `${SCHEME}://${MODULE_HOSTS[id]}/index.html`;
}

function createWindow(): BrowserWindow {
  const settings = readSettings();
  const bounds = settings.window;

  const win = new BrowserWindow({
    width: bounds?.width ?? 1440,
    height: bounds?.height ?? 900,
    ...(bounds?.x !== undefined ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 1024,
    minHeight: 640,
    // A janela só aparece quando tiver conteúdo — evita o retângulo branco a
    // piscar que faz uma aplicação parecer amadora.
    show: false,
    backgroundColor: '#080d1a', // a cor de fundo do próprio Ndombaxi
    title: 'Ndombaxi System',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    // Menu escondido — a navegação faz-se pelo LANÇADOR (1.º ecrã) e pela seta
    // de voltar dentro de cada módulo. Interface limpa, sem barra de menus.
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  if (bounds?.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  // Uma ligação externa (um site de banco, uma ajuda) abre no NAVEGADOR, nunca
  // dentro da app — dentro da app teria o nosso `preload` ao alcance.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // E também não deixamos a própria janela navegar para fora do esquema local.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${SCHEME}://`)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  const persistBounds = () => {
    if (win.isDestroyed()) return;
    const b = win.getNormalBounds();
    writeSettings({
      window: { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() },
    });
  };
  win.on('resized', persistBounds);
  win.on('moved', persistBounds);
  win.on('close', persistBounds);

  // O LANÇADOR é sempre o primeiro ecrã (escolher Gestão ou Caixa). De dentro de
  // cada módulo, a seta de voltar (injetada pelo preload) regressa aqui.
  void win.loadURL(`${SCHEME}://launcher/index.html`);

  scheduleUpdateCheck(win);
  return win;
}

function openModule(id: ModuleId): void {
  writeSettings({ module: id });
  if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadURL(moduleUrl(id));
}

// ── Canais IPC ───────────────────────────────────────────────

function registerIpc(): void {
  ipcMain.handle('ndombaxi:version', () => app.getVersion());

  // SÍNCRONO de propósito: o `preload` precisa do endereço ANTES de o bundle do
  // frontend arrancar, para o primeiro pedido já sair para o sítio certo. É uma
  // leitura de uma variável em memória — não há trabalho a bloquear.
  ipcMain.on('ndombaxi:api-url', (e) => { e.returnValue = localApiUrl; });

  ipcMain.handle('ndombaxi:db-query', (_e, sql: string, params?: unknown[]) => query(sql, params ?? []));
  ipcMain.handle('ndombaxi:db-exec', (_e, sql: string, params?: unknown[]) => exec(sql, params ?? []));
  ipcMain.handle('ndombaxi:db-batch', (_e, statements: { sql: string; params?: unknown[] }[]) =>
    batch(statements ?? []));

  ipcMain.handle('ndombaxi:db-backup', async () => {
    const dir = path.join(app.getPath('documents'), 'Ndombaxi', 'Backups');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(dir, `ndombaxi-${stamp}.db`);
    try {
      await backupTo(dest);
      return { ok: true, path: dest };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('ndombaxi:device-secret', () => deviceSecret());

  ipcMain.handle('ndombaxi:settings-read', () => {
    const s = readSettings();
    // A janela guardada não interessa ao frontend e só suja o objeto.
    return { module: s.module, apiUrl: s.apiUrl };
  });

  ipcMain.handle('ndombaxi:settings-module', (_e, moduleId: string) => {
    if (moduleId === 'gestao' || moduleId === 'caixa') openModule(moduleId);
  });

  // Voltar ao lançador (seta de voltar dentro de cada módulo).
  ipcMain.handle('ndombaxi:open-launcher', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      void mainWindow.loadURL(`${SCHEME}://launcher/index.html`);
    }
  });

  ipcMain.handle('ndombaxi:update-check', () => checkForUpdates());
  ipcMain.handle('ndombaxi:update-open', async () => {
    const verdict = await checkForUpdates();
    if (verdict.info) await openDownloadPage(verdict.info);
  });
}

// ── Arranque ─────────────────────────────────────────────────

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

void app.whenReady().then(async () => {
  const root = modulesRoot();
  serveModules({
    gestao: path.join(root, 'gestao'),
    caixa: path.join(root, 'caixa'),
    launcher: path.join(root, 'launcher'),
  });

  try {
    openDatabase();
  } catch (e) {
    // Sem base local não há modo offline. Dizemos o que aconteceu em vez de
    // abrir uma app que perde vendas em silêncio.
    dialog.showErrorBox(
      'Ndombaxi System',
      'Não foi possível abrir a base de dados local deste posto.\n\n'
      + `Detalhe: ${(e as Error).message}\n\n`
      + 'A aplicação vai fechar. Contacte o suporte — nenhum dado foi perdido.',
    );
    app.quit();
    return;
  }

  // O servidor local arranca ANTES da janela: assim o `preload` já encontra o
  // endereço e o primeiro pedido do frontend sai direto para o sítio certo, sem
  // um recarregamento a meio nem um erro de ligação no arranque.
  await startLocalServer();

  registerIpc();
  mainWindow = createWindow();
  buildMenu({ onOpenModule: openModule, getWindow: () => mainWindow });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on('window-all-closed', () => {
  closeDatabase(); // funde o WAL: deixa um ficheiro coerente e pronto a copiar
  app.quit();
});

app.on('before-quit', () => {
  closeDatabase();
  // Encerra a base local em modo `fast` (faz checkpoint): o próximo arranque não
  // tem de recuperar o WAL e nada fica por gravar.
  void localServer?.stop();
});

// Diagnóstico: um erro não apanhado fica registado em ficheiro em vez de
// desaparecer. Num posto sem consola, é a única forma de saber o que se passou.
process.on('uncaughtException', (err) => {
  try {
    const logFile = path.join(app.getPath('userData'), 'crash.log');
    fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] ${err.stack ?? err.message}\n`);
  } catch { /* nada mais a fazer */ }
});
