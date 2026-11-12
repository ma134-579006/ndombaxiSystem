/**
 * LPS Kwanza para Windows — janela própria do marketplace de associados.
 *
 * Abre https://loja.ndombaxisystem.com/kwanza com o contrato das apps instaladas
 * (?app=kwanza&appOs=windows&appVersion=x.y.z): a página verifica a versão oficial
 * publicada e, se esta app for mais antiga, bloqueia com "Atualização obrigatória"
 * (a mesma regra do LPS Vendas). Sem rede mostra um ecrã para tentar de novo.
 * Ligações de fora (WhatsApp, lojas, comprovativos) abrem no navegador do sistema.
 */
const { app, BrowserWindow, Menu, shell, nativeTheme } = require('electron');
const path = require('node:path');

const ORIGIN = 'https://loja.ndombaxisystem.com';
const START = `${ORIGIN}/kwanza?app=kwanza&appOs=windows&appVersion=${app.getVersion()}`;

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;

const offlinePage = () => `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>LPS Kwanza</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;font-family:Segoe UI,system-ui,sans-serif;background:#f4f6fb;color:#0f1729}
main{text-align:center;padding:24px}h1{font-size:22px;margin:16px 0 6px}p{color:#5a6679;margin:0 0 20px}
button{border:0;border-radius:10px;padding:12px 22px;font-size:15px;font-weight:700;color:#fff;background:linear-gradient(135deg,#2f3dff,#121a8f);cursor:pointer;transition:transform .2s}
button:hover{transform:translateY(-2px)}</style></head><body><main>
<svg width="72" height="72" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#1f29d6"/><path d="M6.5 11.5h4l3.2 12.6a2 2 0 0 0 2 1.5h10.4a2 2 0 0 0 2-1.5l2.3-8.6H11.6" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16.4" cy="30.6" r="2.3" fill="#fff"/><circle cx="26" cy="30.6" r="2.3" fill="#fff"/></svg>
<h1>Sem ligação à internet</h1><p>Verifique a ligação e tente de novo.</p>
<button onclick="location.href='${START}'">Tentar de novo</button></main></body></html>`)}`;

function createWindow() {
  nativeTheme.themeSource = 'light';
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, minHeight: 560,
    title: 'LPS Kwanza', backgroundColor: '#ffffff', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // Navegação dentro da janela só no marketplace; o resto vai para o navegador.
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('data:') || url.startsWith(`${ORIGIN}/kwanza`)) return;
    e.preventDefault();
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
  });
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3 && !String(url).startsWith('data:')) void win.loadURL(offlinePage());
  });
  void win.loadURL(START);
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
