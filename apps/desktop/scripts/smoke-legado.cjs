/**
 * Verificação do protocolo ndombaxi:// nas DUAS edições, no Electron real (QA-041).
 *   electron scripts/smoke-legado.cjs              → caminho legado (Windows 7/8: registerBufferProtocol)
 *   MODO=moderno electron scripts/smoke-legado.cjs → caminho moderno (protocol.handle + net.fetch)
 * Precisa de dist/ (pnpm build:main) e de resources/modules/{gestao,caixa}. Resultados em OUTFILE (padrão: smoke-legado.txt).
 */
const MOD = process.env.MODO === 'moderno'; process.env.NDOMBAXI_LEGACY = MOD ? '0' : '1'; const PL = MOD ? 'windows' : 'windows7';
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain } = require('electron');
ipcMain.on('ndombaxi:api-url', (e) => { e.returnValue = null; });
ipcMain.handle('ndombaxi:version', () => '9.9.9');
const D = process.env.DESKTOP || path.join(__dirname, "..");
const OUT = process.env.OUTFILE || path.join(D, "smoke-legado.txt");
fs.writeFileSync(OUT, 'inicio\n');
const out = (ok, n, d) => fs.appendFileSync(OUT, `${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}\n`);
const comLimite = (p, ms, nome) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('tempo esgotado: ' + nome)), ms))]);
process.on('uncaughtException', (e) => { out(false, 'exceção', String(e && e.message)); app.exit(1); });
const { registerScheme, serveModules, SCHEME } = require(path.join(D, 'dist/main/protocol'));
const compat = require(path.join(D, 'dist/main/compat'));
registerScheme();
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  out(compat.LEGACY === !MOD, 'compat.LEGACY = ' + !MOD, String(compat.LEGACY));
  out(compat.PLATFORM === PL, 'plataforma de atualização = ' + PL, compat.PLATFORM);
  const root = path.join(D, 'resources', 'modules');
  serveModules({ gestao: path.join(root, 'gestao'), caixa: path.join(root, 'caixa'), launcher: path.join(root, 'launcher') });
  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(D, 'dist/preload/index.js'), contextIsolation: true, sandbox: false } });
  try {
    out(true, 'a carregar a Gestão');
    win.webContents.on('console-message', (_e, lvl, msg) => { if (lvl >= 2) out(false, 'consola', String(msg).slice(0, 200)); });
    win.webContents.on('did-fail-load', (_e, code, desc, url) => out(false, 'did-fail-load', code + ' ' + desc + ' ' + url));
    await comLimite(win.loadURL(`${SCHEME}://gestao/index.html`), 150000, 'loadURL gestao');
    const r = await comLimite(win.webContents.executeJavaScript(`(async () => {
      const res = await fetch(location.href);
      const csp = res.headers.get('content-security-policy') || '';
      const trav = await fetch('${SCHEME}://gestao/..%2F..%2Fpackage.json').then((x) => x.status).catch(() => -1);
      const spa = await fetch('${SCHEME}://gestao/rota/que/nao/existe').then(async (x) => (await x.text()).includes('id="root"')).catch(() => false);
      const js = [...document.scripts].map((s) => s.src).find((s) => s.includes('/assets/'));
      const jsType = js ? (await fetch(js)).headers.get('content-type') : null;
      let secure = false; try { await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']); secure = isSecureContext; } catch (e) {}
      return { title: document.title, csp: csp.includes("default-src 'self'"), nosniff: res.headers.get('x-content-type-options'), trav, spa, jsType, secure, plat: window.ndombaxi && window.ndombaxi.platform };
    })()`), 90000, 'verificações');
        out(!!r.title, 'Gestão carrega por ndombaxi:// (registerBufferProtocol)', r.title);
    out(r.csp && r.nosniff === 'nosniff', 'cabeçalhos de segurança (CSP + nosniff)', `${r.csp} ${r.nosniff}`);
    out(r.trav === 403 || r.trav === 404 || r.trav === -1, 'travessia de caminho bloqueada', String(r.trav));
    out(r.spa === true, 'rota SPA desconhecida devolve o index.html', String(r.spa));
    out(!!r.jsType && r.jsType.includes('javascript'), 'tipo MIME dos scripts', String(r.jsType));
    out(r.secure === true, 'contexto seguro (crypto.subtle)', String(r.secure));
    out(r.plat === PL, 'preload expõe platform = ' + PL, String(r.plat));
    await comLimite(win.loadURL(`${SCHEME}://caixa/index.html`), 150000, 'loadURL caixa');
    const t = await win.webContents.executeJavaScript('document.title');
    out(!!t, 'Caixa carrega por ndombaxi://', t);
  } catch (e) { out(false, 'percurso', String(e.message || e)); }
  fs.appendFileSync(OUT, 'fim\n');
  app.exit(0);
});
