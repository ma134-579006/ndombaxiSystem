/**
 * Ajustes NATIVOS da app Android, aplicados DEPOIS do `cap add/sync android`
 * (a pasta `android/` é gerada e não vive no repositório).
 *
 * ECRÃ INTEIRO (modo imersivo): esconde a barra de estado e a barra de navegação.
 * O utilizador pode puxá-las com um deslizar a partir da borda — reaparecem por
 * instantes e voltam a esconder-se sozinhas. Funciona do Android 6 ao atual
 * (WindowInsetsControllerCompat trata das versões antigas).
 *
 * LOCALIZAÇÃO: o manifesto passa a declarar ACCESS_FINE/COARSE_LOCATION (sem
 * isto o Android recusava SEMPRE o GPS — "Permita o acesso à localização…" ao
 * traçar o caminho até ao cliente) e a app pede a permissão logo ao abrir, uma
 * única vez; depois o mapa usa o GPS sem perguntar.
 *
 *   node scripts/patch-android.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shell = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const javaDir = path.join(shell, 'android', 'app', 'src', 'main', 'java', 'com', 'ndombaxi', 'system');
if (!fs.existsSync(javaDir)) {
  process.stderr.write(`\nSem ${javaDir}. Corra primeiro: cap add android\n\n`);
  process.exit(1);
}

const activity = `package com.ndombaxi.system;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/** LPS Vendas — ecrã inteiro (imersivo): sem barra de estado nem de navegação. */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        immersive();
        // TECLADO: com o conteúdo a ocupar o ecrã todo, o Android deixa de encolher
        // a WebView quando o teclado abre — e o teclado tapava os campos e o botão
        // de gravar. A app encolhe exatamente a altura do teclado (e volta ao fechar).
        View root = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            int ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
            v.setPadding(0, 0, 0, ime);
            return insets;
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        immersive();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    private void immersive() {
        // O CONTEÚDO OCUPA O ECRÃ TODO. Só esconder as barras não chega: sem isto a
        // WebView continua a começar por baixo do sítio da barra de estado, e essa
        // faixa ficava BRANCA (o fundo da janela) no topo, onde estão a hora e a data.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        // Se a barra reaparecer (deslizar a partir do topo), vê-se sobre a cor da
        // app — nunca sobre branco.
        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#080d1a"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        WindowInsetsControllerCompat c =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setAppearanceLightStatusBars(false);
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        // GPS automático: pede a localização ao abrir (só da primeira vez).
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] {
                Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, 4801);
        }
    }
}
`;
fs.writeFileSync(path.join(javaDir, 'MainActivity.java'), activity);
process.stdout.write('  MainActivity: ecrã inteiro (imersivo) aplicado\n');

// ── Manifesto: localização (GPS) ─────────────────────────────────────────
const manifestPath = path.join(shell, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
let manifest = fs.readFileSync(manifestPath, 'utf-8');
for (const p of [
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
  '<uses-feature android:name="android.hardware.location.gps" android:required="false" />',
]) {
  if (!manifest.includes(p)) manifest = manifest.replace('</manifest>', `    ${p}\n</manifest>`);
}
fs.writeFileSync(manifestPath, manifest);
process.stdout.write('  Manifesto: permissões de localização (GPS) declaradas\n');
