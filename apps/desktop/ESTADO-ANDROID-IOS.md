# Android e iOS — estado real e o que falta

Documento honesto sobre as duas plataformas que **ainda não estão construídas**,
para que ninguém parta do princípio errado.

## Decisão de arquitetura

**Capacitor** sobre os frontends Vite existentes (`apps/web` e `apps/pos`) — o
mesmo que a versão Windows faz com o Electron. Não é React Native.

Porquê: o requisito é "nada diferente do website". Com Capacitor, a app **é**
literalmente o mesmo código React do site; a igualdade é estrutural. Com React
Native seria preciso reescrever todo o ERP e as duas interfaces divergiriam ao
primeiro mês. O `apps/mobile` (Expo) que já existe no repositório tem uma UI
própria e, por isso, não serve para este objetivo.

O motor `@nexus/offline-core` já está pronto para ambas: o `SqliteAdapter` fala
com uma "ponte" injetada, que no Windows é o `better-sqlite3` e no telemóvel será
o `@capacitor-community/sqlite`. Não há motor a duplicar.

## Limites que não são negociáveis

### Android
O pedido era Android 4. **Não é possível.** Nenhum motor web moderno corre em
Android 4; o mínimo do Capacitor é **API 23 (Android 6)**. Um WebView de 2013 não
suporta ES2020, `crypto.subtle` nem IndexedDB moderno — a app não arrancaria.

Chão real: **Android 6 até ao Android 16** (a versão mais recente à data).

Para gerar o APK/AAB nesta máquina falta instalar:
- **JDK 17** — o Java instalado é o 26, e o Gradle do Android rejeita-o.
- **Android SDK + build-tools** (~3 GB).

### iOS
**Não se compila em Windows.** O `.ipa` exige macOS com Xcode — é uma limitação
da Apple, não do projeto. Faltam também uma conta Apple Developer (99 USD/ano) e
os certificados de assinatura.

O projeto Capacitor pode ser gerado aqui e compilado depois:
- num Mac com Xcode, ou
- num serviço de build na nuvem (Codemagic, Ionic Appflow, GitHub Actions com
  runner macOS).

Chão real: **iOS 13+** (o Capacitor 6 não suporta iOS 12).

## Passos, quando avançarmos

1. `apps/mobile-shell/` com Capacitor, apontando `webDir` aos frontends compilados.
2. Ponte SQLite com `@capacitor-community/sqlite`, implementando a interface
   `SqlBridge` que já existe em `packages/offline-core/src/storage/sqlite.ts`.
3. Segredo do dispositivo com armazenamento seguro nativo (Keystore no Android,
   Keychain no iOS) — o equivalente ao DPAPI que a versão Windows já usa.
4. Ícones e ecrã de arranque a partir do logótipo oficial.
5. `npx cap add android` / `npx cap add ios`.
6. Android: instalar JDK 17 + SDK e gerar APK/AAB assinados.
7. iOS: gerar o projeto aqui, compilar num Mac ou na nuvem.
