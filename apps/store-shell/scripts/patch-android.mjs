/**
 * Ajustes NATIVOS da app LPS Loja, aplicados DEPOIS de `cap add/sync android`
 * (a pasta `android/` é gerada e não vive no repositório):
 *
 *  - versão = a do produto (apps/desktop/package.json) → versionName/versionCode;
 *  - permissões: câmara (ler QR da loja) e localização (entrega ao domicílio
 *    em tempo real) — a WebView do Capacitor pede-as ao utilizador quando a
 *    página as usa;
 *  - ligações diretas: https://loja.ndombaxisystem.com/<loja> e lpsloja://<loja>
 *    abrem a loja na app;
 *  - barra de estado e de navegação brancas com ícones escuros (aspeto de app
 *    de compras, não de site);
 *  - ecrã de arranque branco com o ícone da loja.
 *
 *   node scripts/patch-android.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shell = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(shell, '..', '..');
const app = path.join(shell, 'android', 'app');
const main = path.join(app, 'src', 'main');
if (!fs.existsSync(main)) {
  process.stderr.write('\nSem android/. Corra primeiro: pnpm --filter @nexus/store-shell exec cap add android\n\n');
  process.exit(1);
}
const log = (m) => process.stdout.write(`  ${m}\n`);

// ── Versão ───────────────────────────────────────────────────────────────
const version = JSON.parse(fs.readFileSync(path.join(repo, 'apps', 'desktop', 'package.json'), 'utf-8')).version;
const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
// Igual ao LPS Vendas (mobile-shell/scripts/sync-android-version.mjs): 1.5.612 → 1050612.
const code = m ? Number(m[1]) * 1_000_000 + Number(m[2]) * 10_000 + Number(m[3]) : 1;
const gradlePath = path.join(app, 'build.gradle');
let gradle = fs.readFileSync(gradlePath, 'utf-8');
gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${version}"`).replace(/versionCode\s+\d+/, `versionCode ${code}`);
fs.writeFileSync(gradlePath, gradle);
log(`versão ${version} (versionCode ${code})`);

// ── Manifesto: permissões + ligações diretas ─────────────────────────────
const manifestPath = path.join(main, 'AndroidManifest.xml');
let manifest = fs.readFileSync(manifestPath, 'utf-8');
const perms = [
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
  '<uses-feature android:name="android.hardware.location.gps" android:required="false" />',
];
for (const p of perms) {
  if (!manifest.includes(p)) manifest = manifest.replace('</manifest>', `    ${p}\n</manifest>`);
}
const deepLinks = `
            <!-- LPS Loja: abrir a loja a partir de um link partilhado -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="loja.ndombaxisystem.com" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="lpsloja" />
            </intent-filter>
`;
if (!manifest.includes('loja.ndombaxisystem.com')) {
  // Dentro da MainActivity, logo a seguir ao intent-filter do LAUNCHER.
  manifest = manifest.replace(/(<category android:name="android\.intent\.category\.LAUNCHER" \/>\s*<\/intent-filter>)/, `$1\n${deepLinks}`);
}
fs.writeFileSync(manifestPath, manifest);
log('manifesto: câmara, localização e ligações diretas');

// ── Cores (barras do sistema e arranque) ─────────────────────────────────
const values = path.join(main, 'res', 'values');
fs.mkdirSync(values, { recursive: true });
fs.writeFileSync(path.join(values, 'lps_colors.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="lps_surface">#FFFFFF</color>
    <color name="lps_brand">#2430E8</color>
</resources>
`);
const stylesPath = path.join(values, 'styles.xml');
let styles = fs.readFileSync(stylesPath, 'utf-8');
const sysBars = `
        <item name="android:statusBarColor">@color/lps_surface</item>
        <item name="android:navigationBarColor">@color/lps_surface</item>
        <item name="android:windowLightStatusBar">true</item>
        <item name="android:windowLightNavigationBar">true</item>`;
// Tema da app (depois do arranque): barras brancas com ícones escuros.
styles = styles.replace(/(<style name="AppTheme\.NoActionBar"[^>]*>)/, (s) => (styles.includes('lps_surface') ? s : s + sysBars));
// Arranque: fundo branco (Android 12+ usa o ícone da app ao centro).
if (styles.includes('windowSplashScreenBackground')) {
  styles = styles.replace(/<item name="windowSplashScreenBackground">[^<]*<\/item>/, '<item name="windowSplashScreenBackground">@color/lps_surface</item>');
} else {
  styles = styles.replace(/(<style name="AppTheme\.NoActionBarLaunch"[^>]*>)/, '$1\n        <item name="windowSplashScreenBackground">@color/lps_surface</item>');
}
fs.writeFileSync(stylesPath, styles);
log('tema: barras brancas e arranque branco');
process.stdout.write('\nAjustes nativos da LPS Loja aplicados.\n\n');
