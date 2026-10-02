/**
 * Ajustes NATIVOS da app Android, aplicados DEPOIS do `cap add/sync android`
 * (a pasta `android/` é gerada e não vive no repositório).
 *
 * ECRÃ INTEIRO (modo imersivo): esconde a barra de estado e a barra de navegação.
 * O utilizador pode puxá-las com um deslizar a partir da borda — reaparecem por
 * instantes e voltam a esconder-se sozinhas. Funciona do Android 6 ao atual
 * (WindowInsetsControllerCompat trata das versões antigas).
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

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        WindowInsetsControllerCompat c =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
`;
fs.writeFileSync(path.join(javaDir, 'MainActivity.java'), activity);
process.stdout.write('  MainActivity: ecrã inteiro (imersivo) aplicado\n');
