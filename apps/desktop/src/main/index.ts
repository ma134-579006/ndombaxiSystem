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
import { app, BrowserWindow, ipcMain, shell, dialog, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { registerScheme, serveModules, SCHEME } from './protocol';
import { openDatabase, closeDatabase, query, exec, batch, backupTo } from './database';
import { deviceSecret } from './secure-store';
import { readSettings, writeSettings, type ModuleId } from './settings';
import {
  checkForUpdates, lastDecision, openDownloadPage, quitAfterUpdatePrompt, scheduleUpdateCheck,
} from './updater';
import { signInWithGoogle } from './google-auth';
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
    const { LocalServer, layout, binariesPresent, blockedReason } = await import('@nexus/local-server');
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
    // BARREIRA — não basta os binários existirem.
    //
    // Sem isto, bastava incluir o PostgreSQL no instalador para que, na
    // atualização seguinte, cada posto passasse a falar com uma base de dados
    // VAZIA: o lojista abria a aplicação e não encontrava a empresa, nem os
    // produtos, nem as vendas. A base local só serve a aplicação depois de ter
    // sido ligada de propósito E de ter recebido os dados da empresa.
    const blocked = blockedReason(paths, { enabled: readSettings().localServer === true });
    if (blocked) {
      logLocal(`servidor local não usado (${blocked}) — a usar a nuvem`);
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

/**
 * Traz a empresa para este posto, se for a altura certa.
 *
 * A decisão de SE copiar não está aqui — está em `shouldProvision`, isolada e
 * testada. Aqui só se reúnem os factos (binários, papel de quem entrou, espaço
 * em disco) e se executa o que ela mandar.
 *
 * A definição `localServer` é ligada **no fim de uma cópia bem sucedida**, e
 * nunca antes. É o que substitui o botão sem perder a proteção: a base local
 * continua a nunca servir a aplicação enquanto não tiver os dados lá dentro.
 */
/** Último motivo de adiamento escrito no registo, para não o repetir. */
let ultimoAdiamento: string | null = null;

async function autoProvision(session: {
  accessToken: string; companyCode: string; apiUrl: string; role: string; busy?: boolean;
}): Promise<{ done: boolean; reason?: string; rows?: number }> {
  const ls = await import('@nexus/local-server');
  const paths = ls.layout({
    userDataDir: app.getPath('userData'),
    resourcesDir: app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..', 'resources'),
  });

  let freeDiskBytes: number | null = null;
  try {
    freeDiskBytes = fs.statfsSync(app.getPath('userData')).bavail
      * fs.statfsSync(app.getPath('userData')).bsize;
  } catch { /* sistema sem statfs — não bloqueia por isso */ }

  // A replicação precisa de uma sessão para falar com a nuvem. Guardamo-la SÓ
  // em memória — morre quando a aplicação fecha, e não fica um token de
  // administrador em disco à espera de ser encontrado.
  //
  // SÓ de um ADMINISTRADOR, e é essencial: `/replication/push` e `/pull` são
  // reservados ao COMPANY_ADMIN. Agora que a Caixa também oferece a sessão, um
  // operador a entrar num posto já provisionado substituiria aqui o token do
  // administrador pelo dele — e a partir desse minuto tudo o que a loja
  // vendesse sem internet ficaria a bater num 403, em silêncio, com o registo
  // a dizer apenas "replicação adiada". A sessão do administrador que já cá
  // está vale mais do que a do operador que acabou de chegar.
  if (session.role === 'COMPANY_ADMIN') {
    replicationSession = {
      accessToken: session.accessToken,
      companyCode: session.companyCode,
      apiUrl: session.apiUrl,
    };
    // Só faz sentido replicar quando este posto está mesmo a trabalhar da sua
    // base local: sem ela não há diário, e sem diário não há nada para subir.
    if (localApiUrl) startReplicationClock();
  }

  const decisao = ls.shouldProvision(paths, {
    binariesPresent: ls.binariesPresent(paths),
    isCompanyAdmin: session.role === 'COMPANY_ADMIN',
    companyCode: session.companyCode,
    freeDiskBytes,
    busy: session.busy === true,
  });
  if (!decisao.provision) {
    // Escreve o motivo só quando MUDA. São duas janelas (Gestor e Caixa) a
    // oferecer a sessão de minuto a minuto: repetir a mesma linha encheria o
    // registo com milhares de "já provisionado" por dia e afogaria a única
    // linha que interessa quando algo corre mal. Este ficheiro é o único
    // diagnóstico que existe num posto sem consola.
    if (decisao.reason !== ultimoAdiamento) {
      ultimoAdiamento = decisao.reason;
      logLocal(`cópia automática adiada: ${decisao.reason}`);
    }
    return { done: false, reason: decisao.reason };
  }
  ultimoAdiamento = null;

  logLocal(`cópia automática a começar (empresa ${session.companyCode})`);
  const url = await ls.ensureLocalDatabase(paths);
  const runner = await ls.openRunner(url);
  try {
    const r = await ls.provisionFromCloud({
      paths,
      cloud: { apiUrl: session.apiUrl, accessToken: session.accessToken, companyCode: session.companyCode },
      run: runner.run,
      schema: 'public',
      log: logLocal,
    });
    ls.recordSuccess(paths);
    // SÓ AGORA se liga: a partir do próximo arranque, este posto trabalha da
    // sua própria base. Antes disto seria servir uma empresa vazia.
    writeSettings({ localServer: true });
    logLocal(`cópia automática concluída: ${r.rows} linhas em ${r.tables} tabelas`);
    return { done: true, rows: r.rows };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erro';
    ls.recordFailure(paths, msg);
    logLocal(`cópia automática falhou: ${msg}`);
    return { done: false, reason: msg };
  } finally {
    await runner.close();
  }
}

/**
 * Relógio da replicação: leva à nuvem o que este posto fez sem internet.
 *
 * Corre em segundo plano e NUNCA no caminho de uma operação — o utilizador é
 * libertado quando a venda fica gravada na base local, não quando a nuvem a
 * recebe. É essa a arquitetura pedida, e é o que faz a diferença num sítio onde
 * a internet vai e vem.
 *
 * Só arranca com o servidor local em uso: sem base local não há diário, e sem
 * diário não há nada para replicar (a app está a falar diretamente com a nuvem).
 */
let replicationTimer: NodeJS.Timeout | null = null;
/** Credenciais da sessão atual, guardadas SÓ em memória (nunca em disco). */
let replicationSession: { accessToken: string; companyCode: string; apiUrl: string } | null = null;

const REPLICATION_EVERY_MS = 2 * 60_000;

function startReplicationClock(): void {
  if (replicationTimer) return;
  replicationTimer = setInterval(() => { void replicateOnce(); }, REPLICATION_EVERY_MS);
}

async function replicateOnce(): Promise<void> {
  if (!localApiUrl || !replicationSession) return; // sem servidor local, nada a fazer
  try {
    const ls = await import('@nexus/local-server');
    const paths = ls.layout({
      userDataDir: app.getPath('userData'),
      resourcesDir: app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..', 'resources'),
    });
    const cfg = ls.readConfig(paths);
    if (!cfg) return;
    const runner = await ls.openRunner(ls.connectionUrl(cfg));
    try {
      const r = await ls.pushPending({
        apiUrl: replicationSession.apiUrl,
        accessToken: replicationSession.accessToken,
        companyCode: replicationSession.companyCode,
        schema: 'public',
        deviceId: 'desktop',
        query: runner.query,
        run: runner.run,
        log: logLocal,
      });
      if (r.sent > 0) {
        logLocal(`replicação (subida): ${r.applied} aplicadas, ${r.rejected} recusadas, ${r.conflicts} conflitos`);
      }

      // SUBIR PRIMEIRO, descer depois. A ordem não é indiferente: subindo
      // primeiro, o trabalho deste posto já está na nuvem quando comparamos
      // versões, e uma alteração feita aqui não corre o risco de ser tapada por
      // uma cópia mais velha que ainda vinha a caminho.
      const tabelas = await runner.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      const d = await ls.pullAndApply({
        apiUrl: replicationSession.apiUrl,
        accessToken: replicationSession.accessToken,
        companyCode: replicationSession.companyCode,
        schema: 'public',
        deviceId: 'desktop',
        tables: tabelas.map((x) => x.table_name),
        query: runner.query,
        run: runner.run,
        log: logLocal,
      });
      if (d.received > 0) {
        logLocal(`replicação (descida): ${d.applied} aplicadas, ${d.skipped} ignoradas, ${d.conflicts} conflitos`);
      }

      await ls.pruneJournal({ schema: 'public', run: runner.run });
    } finally {
      await runner.close();
    }
  } catch (e) {
    // Sem rede, sem base, sem sessão — nada disto é excecional num posto.
    logLocal(`replicação adiada: ${(e as Error).message}`);
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

  /**
   * Área utilizável do ecrã onde a janela vai nascer (o ecrã menos a barra de
   * tarefas). Se houver posição gravada, é o ecrã DESSA posição — senão, num
   * computador com dois monitores a janela reabria com as medidas do outro.
   */
  const ecra = bounds?.x !== undefined
    ? screen.getDisplayMatching({
      x: bounds.x, y: bounds.y ?? 0, width: bounds.width ?? 1440, height: bounds.height ?? 900,
    })
    : screen.getPrimaryDisplay();
  const area = ecra.workArea;

  /**
   * Os mínimos NUNCA podem ser maiores do que o ecrã.
   *
   * Era isto que impedia a janela de cobrir o ecrã inteiro: num portátil de
   * 1366×768 com o Windows a 150%, o ecrã em pontos lógicos fica com ~911×512 —
   * menos do que os 1024×640 exigidos. O Windows não consegue encolher a janela
   * até à área de trabalho, e ela fica MAIOR do que o ecrã, com parte de fora e
   * sem nunca assentar ao maximizar. Descendo os mínimos até ao que o ecrã dá,
   * o maximizado passa a assentar certo em qualquer resolução.
   */
  const minWidth = Math.min(1024, area.width);
  const minHeight = Math.min(640, area.height);

  const win = new BrowserWindow({
    width: Math.min(bounds?.width ?? 1440, area.width),
    height: Math.min(bounds?.height ?? 900, area.height),
    ...(bounds?.x !== undefined ? { x: bounds.x, y: bounds.y } : {}),
    minWidth,
    minHeight,
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

  // Maximizar SÓ quando a janela já tem conteúdo. Com `show: false`, um
  // `maximize()` feito ainda antes disto é desfeito pelo `show()` em várias
  // configurações do Windows — a janela abria no tamanho normal e o utilizador
  // tinha de maximizar à mão de cada vez.
  win.once('ready-to-show', () => {
    if (bounds?.maximized) win.maximize();
    win.show();
  });

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

  /**
   * CÓPIA AUTOMÁTICA da empresa para este posto.
   *
   * Sem botão, por decisão do dono do produto. O frontend limita-se a dizer
   * "estou aqui, com esta sessão"; toda a inteligência de decidir SE e QUANDO
   * copiar vive em `@nexus/local-server/autoprovision`, isolada e testada.
   *
   * O token não é guardado em lado nenhum — é usado no momento e esquecido.
   */
  ipcMain.handle('ndombaxi:local-provision', async (_e, session: {
    accessToken: string; companyCode: string; apiUrl: string; role: string; busy?: boolean;
  }) => {
    try {
      return await autoProvision(session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'erro';
      logLocal(`cópia automática falhou: ${msg}`);
      return { done: false, reason: msg };
    }
  });

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

  /**
   * Entrar com Google — acontece no NAVEGADOR do sistema, nunca dentro da
   * janela (o Google recusa o seu login em WebViews). Devolve o `id_token`, que
   * segue o mesmo caminho do botão do site.
   */
  ipcMain.handle('ndombaxi:google-signin', async () => {
    try {
      return { idToken: await signInWithGoogle() };
    } catch (e) {
      return { idToken: null, error: e instanceof Error ? e.message : 'Falhou a entrada com Google.' };
    }
  });

  ipcMain.handle('ndombaxi:update-check', () => checkForUpdates());

  /**
   * "Atualizar Agora": abre a página oficial e ENCERRA a aplicação.
   *
   * Repare-se no que NÃO se faz aqui: não se pergunta ao servidor outra vez, e
   * não se aceita um endereço vindo do frontend. Perguntar outra vez deixava o
   * botão morto se a rede tivesse caído entretanto — e o utilizador preso num
   * ecrã sem saída. Aceitar o endereço do frontend transformava uma falha na
   * interface numa forma de abrir o que se quisesse na máquina do cliente.
   *
   * Usa-se o que a última verificação trouxe e, na falta dele, a página oficial.
   */
  ipcMain.handle('ndombaxi:update-open', async () => {
    const aberto = await openDownloadPage(lastDecision()?.release?.downloadPageUrl);
    // Não se encerra se a página não chegou a abrir: encerrar aí deixava o
    // lojista sem aplicação E sem saber onde ir buscar a nova.
    if (aberto) quitAfterUpdatePrompt();
    return { opened: aberto };
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
