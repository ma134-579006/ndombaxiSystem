#!/usr/bin/env bash
# Compila e assina o APK de um projeto Capacitor (Android).
#
#   scripts/android-apk.sh <pasta-android> <pasta-saida>
#
# Com os secrets da keystore de PRODUÇÃO definidos no GitHub
#   ANDROID_KEYSTORE_BASE64   (ficheiro .jks/.keystore em base64)
#   ANDROID_KEYSTORE_PASSWORD
#   ANDROID_KEY_ALIAS
#   ANDROID_KEY_PASSWORD      (opcional; por omissão = ANDROID_KEYSTORE_PASSWORD)
# → compila em release e assina com essa chave (zipalign + apksigner, esquema v1-v3).
# Sem eles → APK de depuração com a chave fixa do repositório (comportamento antigo).
#
# ATENÇÃO: trocar de chave impede o Android de atualizar por cima de uma app
# assinada com a outra (é preciso desinstalar e instalar). Ver
# apps/mobile-shell/keystore/README.md antes de definir os secrets.
set -euo pipefail

ANDROID_DIR="$1"
OUT_DIR="$2"
mkdir -p "$OUT_DIR"

if [ -n "${ANDROID_KEYSTORE_BASE64:-}" ] && [ -n "${ANDROID_KEYSTORE_PASSWORD:-}" ] && [ -n "${ANDROID_KEY_ALIAS:-}" ]; then
  echo "Assinatura: keystore de PRODUÇÃO (secrets do GitHub)."
  KS="$RUNNER_TEMP/release.keystore"
  printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 -d > "$KS"
  (cd "$ANDROID_DIR" && ./gradlew assembleRelease --no-daemon)
  unsigned=$(ls "$ANDROID_DIR"/app/build/outputs/apk/release/*.apk | head -1)
  BT=$(ls -d "${ANDROID_HOME:-$ANDROID_SDK_ROOT}"/build-tools/* | sort -V | tail -1)
  "$BT/zipalign" -f -p 4 "$unsigned" "$OUT_DIR/aligned.apk"
  KEYPASS_VAR=ANDROID_KEYSTORE_PASSWORD
  if [ -n "${ANDROID_KEY_PASSWORD:-}" ]; then KEYPASS_VAR=ANDROID_KEY_PASSWORD; fi
  "$BT/apksigner" sign --ks "$KS" --ks-key-alias "$ANDROID_KEY_ALIAS" \
    --ks-pass env:ANDROID_KEYSTORE_PASSWORD \
    --key-pass "env:$KEYPASS_VAR" \
    --out "$OUT_DIR/app.apk" "$OUT_DIR/aligned.apk"
  rm -f "$OUT_DIR/aligned.apk" "$KS"
  "$BT/apksigner" verify --print-certs "$OUT_DIR/app.apk" | grep -i 'SHA-256 digest' | head -1
else
  echo "Assinatura: chave de DEPURAÇÃO fixa (sem secrets da keystore de produção)."
  # Cada runner criava uma debug.keystore NOVA → cada APK tinha assinatura
  # diferente e o Android recusava instalar por cima ("App não instalada").
  mkdir -p ~/.android
  cp "$(dirname "$0")/../apps/mobile-shell/keystore/debug.keystore" ~/.android/debug.keystore
  (cd "$ANDROID_DIR" && ./gradlew assembleDebug --no-daemon)
  cp "$(ls "$ANDROID_DIR"/app/build/outputs/apk/debug/*.apk | head -1)" "$OUT_DIR/app.apk"
fi
