/**
 * Verificação de arranque da aplicação Windows (QA automatizado).
 *
 * Corre dentro do Electron real — não num duplo — e valida as quatro coisas de
 * que tudo o resto depende:
 *   1. o protocolo ndombaxi:// serve os frontends a partir do disco;
 *   2. a janela carrega o Painel de Gestão sem erros de consola;
 *   3. o contexto é SEGURO (sem isso não há crypto.subtle → não há cifra);
 *   4. o SQLite grava com durabilidade e sobrevive a uma reabertura.
 *
 * Uso: electron scripts/smoke.js
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert');

const { registerScheme, serveModules, SCHEME } = require('../dist/main/protocol');
const { openDatabase, closeDatabase, query, exec, batch } = require('../dist/main/database');
const { deviceSecret } = require('../dist/main/secure-store');

registerScheme();

const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ ok: true, name, detail });
  } catch (e) {
    results.push({ ok: false, name, detail: e.message });
  }
}

async function checkAsync(name, fn) {
  try {
    results.push({ ok: true, name, detail: await fn() });
  } catch (e) {
    results.push({ ok: false, name, detail: e.message });
  }
}

app.whenReady().then(async () => {
  const root = path.join(__dirname, '..', 'resources', 'modules');
  serveModules({
    gestao: path.join(root, 'gestao'),
    caixa: path.join(root, 'caixa'),
    launcher: path.join(root, 'launcher'),
  });

  // 1 — os módulos certos estão empacotados, e SÓ esses
  check('Gestão e Caixa empacotados (sem Loja)', () => {
    for (const m of ['gestao', 'caixa', 'launcher']) {
      const index = path.join(root, m, 'index.html');
      assert.ok(fs.existsSync(index), `falta ${m}/index.html`);
    }
    // A Loja não pode ter ficado para trás de uma compilação anterior: iria
    // inchar o instalador com ~2 MB de código que ninguém abre.
    assert.ok(!fs.existsSync(path.join(root, 'loja')),
      'a pasta "loja" ainda existe — apague resources/modules/loja');
    return 'gestao, caixa, launcher';
  });

  // 2 — SQLite: escrita durável, transação e persistência entre aberturas
  check('SQLite grava com synchronous=FULL e WAL', () => {
    const db = openDatabase();
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    // synchronous FULL === 2
    assert.equal(db.pragma('synchronous', { simple: true }), 2);
    return 'journal_mode=wal, synchronous=FULL';
  });

  check('Transação em lote é atómica', () => {
    exec('CREATE TABLE IF NOT EXISTS smoke (id INTEGER PRIMARY KEY, v TEXT)');
    exec('DELETE FROM smoke');
    batch([
      { sql: 'INSERT INTO smoke (v) VALUES (?)', params: ['venda-1'] },
      { sql: 'INSERT INTO smoke (v) VALUES (?)', params: ['venda-2'] },
    ]);
    const rows = query('SELECT v FROM smoke ORDER BY id');
    assert.equal(rows.length, 2);

    // Um lote com uma instrução inválida NÃO pode deixar metade gravada.
    try {
      batch([
        { sql: 'INSERT INTO smoke (v) VALUES (?)', params: ['venda-3'] },
        { sql: 'INSERT INTO tabela_que_nao_existe (v) VALUES (?)', params: ['x'] },
      ]);
      throw new Error('o lote inválido devia ter falhado');
    } catch { /* esperado */ }

    const after = query('SELECT v FROM smoke ORDER BY id');
    assert.equal(after.length, 2, 'a venda-3 não podia ter ficado gravada sozinha');
    return '2 linhas gravadas; reversão do lote inválido confirmada';
  });

  check('Os dados sobrevivem a fechar e reabrir a base', () => {
    closeDatabase();
    const rows = query('SELECT v FROM smoke ORDER BY id');
    assert.equal(rows.length, 2);
    exec('DROP TABLE smoke');
    return 'dados intactos após reabertura';
  });

  // 3 — cofre do sistema operativo
  check('Segredo do dispositivo protegido pelo SO', () => {
    const { secret, hardwareBacked } = deviceSecret();
    assert.ok(secret && secret.length >= 32);
    const again = deviceSecret();
    assert.equal(again.secret, secret, 'o segredo tem de ser estável entre chamadas');
    return hardwareBacked ? 'DPAPI do Windows (ligado à conta)' : 'sem DPAPI — apenas ofuscado';
  });

  // 4 — a janela carrega mesmo o frontend, e num contexto seguro
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'dist', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const consoleErrors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) consoleErrors.push(message);
  });

  await checkAsync('O Painel de Gestão carrega pelo protocolo ndombaxi://', async () => {
    await win.loadURL(`${SCHEME}://gestao/index.html`);
    const title = await win.webContents.executeJavaScript('document.title');
    assert.ok(title && title.length > 0, 'a página não tem título');
    return `título: "${title}"`;
  });

  await checkAsync('O contexto é SEGURO (crypto.subtle disponível)', async () => {
    const report = await win.webContents.executeJavaScript(`
      (async () => {
        if (!window.isSecureContext) return { secure: false };
        // Prova real: derivar uma chave e cifrar, como faz o motor offline.
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
        const ct = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: crypto.getRandomValues(new Uint8Array(12)) },
          key, new TextEncoder().encode('venda'));
        return { secure: true, bytes: ct.byteLength, hasIndexedDB: typeof indexedDB !== 'undefined' };
      })()
    `);
    assert.ok(report.secure, 'contexto NÃO seguro — a cifra em repouso seria impossível');
    assert.ok(report.bytes > 0, 'a cifra não produziu resultado');
    return `isSecureContext=true, AES-GCM ok (${report.bytes} bytes), IndexedDB=${report.hasIndexedDB}`;
  });

  await checkAsync('A ponte do preload está exposta e é a única superfície', async () => {
    const shape = await win.webContents.executeJavaScript(`
      ({
        hasBridge: typeof window.ndombaxi === 'object',
        hasDb: typeof window.ndombaxi?.db?.query === 'function',
        leakedRequire: typeof window.require,
        leakedProcess: typeof window.process,
      })
    `);
    assert.ok(shape.hasBridge, 'window.ndombaxi em falta');
    assert.ok(shape.hasDb, 'ponte SQLite em falta');
    assert.equal(shape.leakedRequire, 'undefined', 'require() ficou exposto ao frontend');
    assert.equal(shape.leakedProcess, 'undefined', 'process ficou exposto ao frontend');
    return 'ponte presente; require/process NÃO acessíveis ao frontend';
  });

  // 4b — O LANÇADOR: carregar → clicar num cartão → abrir o módulo.
  // Este é o fluxo que o cliente vê primeiro e que ANTES falhava: a CSP
  // `script-src 'self'` do protocolo bloqueava o <script> inline do launcher,
  // por isso os cliques em "Gestão"/"Caixa" não faziam nada. Agora o script é
  // externo (launcher.js). Provamos que corre sob a CSP e que liga os cliques.
  await checkAsync('O lançador liga os cliques sob a CSP (regressão dos módulos que não abriam)', async () => {
    await win.loadURL(`${SCHEME}://launcher/index.html`);
    // Damos um instante para o DOMContentLoaded + wire() do launcher.js correrem.
    await new Promise((r) => setTimeout(r, 200));
    const r = await win.webContents.executeJavaScript(`
      ({
        // data-launcher='ready' SÓ existe se launcher.js correu — ou seja, se a
        // CSP 'self' o permitiu. Era isto que falhava com o script inline.
        scriptRan: document.documentElement.getAttribute('data-launcher') === 'ready',
        bridge: typeof window.ndombaxi?.settings?.setModule === 'function',
        cards: document.querySelectorAll('.card[data-module]').length,
        modules: [...document.querySelectorAll('.card[data-module]')].map(c => c.getAttribute('data-module')).sort().join(','),
      })
    `);
    assert.ok(r.scriptRan, 'launcher.js NÃO correu — CSP a bloquear o script do launcher (os módulos não abririam)');
    assert.ok(r.bridge, 'a ponte window.ndombaxi.settings.setModule não chegou ao launcher');
    assert.equal(r.cards, 2, 'o launcher deve ter 2 cartões');
    assert.equal(r.modules, 'caixa,gestao', 'os cartões devem ser Gestão e Caixa');
    return 'launcher.js correu sob a CSP; ponte OK; cartões: ' + r.modules;
  });

  // 4c — CADEIA COMPLETA: clicar no cartão ABRE mesmo o módulo.
  // Liga o handler IPC real (como o main faz) e confirma que, após o clique, a
  // janela NAVEGA para o módulo e o renderiza. É o cenário exato do cliente.
  await checkAsync('Clicar no lançador abre e renderiza o módulo (cadeia completa)', async () => {
    let navegouPara = null;
    ipcMain.removeHandler('ndombaxi:settings-module');
    ipcMain.handle('ndombaxi:settings-module', async (_e, id) => {
      if (id === 'gestao' || id === 'caixa') {
        navegouPara = id;
        await win.loadURL(`${SCHEME}://${id}/index.html`);
      }
    });

    await win.loadURL(`${SCHEME}://launcher/index.html`);
    await new Promise((r) => setTimeout(r, 200));
    // Clica no cartão da Caixa e espera pela navegação real.
    await win.webContents.executeJavaScript(`
      [...document.querySelectorAll('.card[data-module]')]
        .find(c => c.getAttribute('data-module') === 'caixa').click()
    `);
    // Espera o carregamento do módulo (a caixa é um SPA React).
    for (let i = 0; i < 50 && !win.webContents.getURL().includes('/caixa/'); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const url = win.webContents.getURL();
    const title = await win.webContents.executeJavaScript('document.title').catch(() => '');
    ipcMain.removeHandler('ndombaxi:settings-module');

    assert.equal(navegouPara, 'caixa', 'o clique não disparou a abertura do módulo pela ponte/IPC');
    assert.ok(url.includes(`${SCHEME}://caixa/`), `a janela não navegou para a Caixa (está em ${url})`);
    assert.ok(title && title.length > 0, 'o módulo da Caixa não renderizou (sem título)');
    return `clique → Caixa aberta e renderizada ("${title}")`;
  });

  check('O frontend carregou sem erros de código', () => {
    // Separamos três famílias, porque só uma delas é um defeito nosso:
    //  • rede — esperado: este teste corre sem sessão e as fontes do Google não
    //    carregam offline. É exatamente o cenário do cliente numa loja sem net.
    //  • CORS — a API EM PRODUÇÃO ainda não conhece a origem `ndombaxi://`.
    //    Já está corrigido em apps/api/src/main.ts; desaparece ao publicar.
    //  • aviso de CSP do Electron — só aparece em desenvolvimento.
    const isNetwork = (m) => /ERR_|net::|Failed to load resource/i.test(m);
    const isCors = (m) => /blocked by CORS policy/i.test(m);
    const isDevWarning = (m) => /Electron Security Warning/i.test(m);

    const cors = consoleErrors.filter(isCors);
    const real = consoleErrors.filter((m) => !isNetwork(m) && !isCors(m) && !isDevWarning(m));
    assert.equal(real.length, 0, real.slice(0, 3).join(' | '));
    return `0 erros de código`
      + (cors.length ? ` · ${cors.length} bloqueio(s) CORS (corrigido; falta publicar a API)` : '');
  });

  // ── Relatório ──────────────────────────────────────────────
  const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
  process.stdout.write('\n  VERIFICAÇÃO DE ARRANQUE — Ndombaxi System (Windows)\n');
  process.stdout.write('  ' + '─'.repeat(72) + '\n');
  for (const r of results) {
    process.stdout.write(`  ${r.ok ? '[OK]  ' : '[FALHA]'} ${pad(r.name, 52)} ${r.detail}\n`);
  }
  const failed = results.filter((r) => !r.ok).length;
  process.stdout.write('  ' + '─'.repeat(72) + '\n');
  process.stdout.write(`  ${results.length - failed}/${results.length} verificações passaram\n\n`);

  closeDatabase();
  app.exit(failed === 0 ? 0 : 1);
});
