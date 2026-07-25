# Ndombaxi System — Apps Android e iOS (Capacitor)

Aplicações móveis Offline-First que embrulham **os mesmos frontends do site** —
Gestão (`apps/web`) e Caixa (`apps/pos`). Não há interface própria: é a razão
pela qual a app móvel nunca diverge do site.

> **Regra permanente:** qualquer alteração ao website tem de ser refletida aqui
> (e na versão Windows). Ver a memória `feedback_apps_sync_with_website.md`.

A **Loja Online não é empacotada** — é a montra do cliente final e vive no
navegador. As apps instaláveis são ferramentas de trabalho: gerir e vender.

## Como está montado

| Peça | Escolha | Porquê |
|---|---|---|
| Interface | `apps/web` + `apps/pos` compilados com base relativa em `www/` | Sincronização estrutural com o site |
| WebView segura | `androidScheme/iosScheme: 'https'` | Dá contexto seguro → `crypto.subtle` (cifra e PIN offline) |
| Base local | `@capacitor-community/sqlite` (WAL + FULL) | A venda está em disco antes de a escrita retornar |
| Segredo do aparelho | `@capacitor/preferences` (Keychain/Keystore) | Equivalente móvel do DPAPI do Windows |
| Motor offline | `@nexus/offline-core` (o mesmo do desktop) | Uma só lógica para as 3 plataformas |

`src/boot.ts` liga tudo: o frontend chama `bootOfflineEngine()` e recebe um
`SyncEngine` já a correr sobre o SQLite nativo.

## Limites reais (não são opinião)

- **Android**: mínimo **Android 6** (API 23). O pedido de Android 4 é impossível
  — nenhum motor web moderno corre nessas versões. Cobre Android 6 → 16.
- **iOS**: mínimo **iOS 13** (Capacitor 6). E **o `.ipa` só se compila em macOS
  com Xcode** — é uma regra da Apple, não do projeto.

## Compilar

Pré-requisitos que **faltam nesta máquina** (ver `ESTADO-ANDROID-IOS` no Ambiente
de Trabalho): **JDK 17** (o Java instalado é o 26, que o Gradle rejeita) e o
**Android SDK**. Para iOS, um Mac com Xcode ou um serviço de build na nuvem.

```bash
# 1. Instalar dependências (na raiz do monorepo)
pnpm install

# 2. Preparar a pasta www (compila Gestão + Caixa com base relativa)
pnpm --filter @nexus/mobile-shell prepare:web

# 3. Adicionar as plataformas nativas (uma vez)
pnpm --filter @nexus/mobile-shell add:android
pnpm --filter @nexus/mobile-shell add:ios      # só num Mac

# 4. Sincronizar o www para os projetos nativos
pnpm --filter @nexus/mobile-shell sync

# 5. Abrir no IDE nativo para gerar APK/AAB (Android Studio) ou .ipa (Xcode)
pnpm --filter @nexus/mobile-shell open:android
pnpm --filter @nexus/mobile-shell open:ios     # só num Mac
```

O APK/AAB assinado sai do Android Studio; o `.ipa`, do Xcode (ou da nuvem:
Codemagic, Ionic Appflow, GitHub Actions com runner macOS).

## Atualizações

A app carrega os frontends embutidos, que já sabem verificar a versão no
servidor. Tal como no Windows, a atualização encaminha SEMPRE para a **página
oficial de downloads** do site — nunca para um link direto de armazenamento. O
link é gerido no Super Admin → Gestão de Downloads.
