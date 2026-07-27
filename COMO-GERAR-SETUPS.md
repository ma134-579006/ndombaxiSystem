# Como gerar os setups (Windows · Android · iOS) e colocá-los na pasta "Ndombaxi System"

> Regra: **sempre que o site/apps são atualizados**, regenerar estes 3 setups e
> colocá-los na pasta **"Ndombaxi System"**. Não basta publicar o site.

Os frontends já ficam **staged** automaticamente pelos scripts abaixo (empacotam o
MESMO `apps/web`=Gestão e `apps/pos`=Caixa que estão no site — sem UI recriada).
O que falta é apenas o **empacotamento nativo**, que precisa das ferramentas de cada
plataforma.

---

## 1. Windows (`.exe`)

**Pré-requisitos (uma vez):**
- Node 20+ e pnpm 9+.
- **Visual Studio Build Tools 2022** com o workload **"Desktop development with C++"**
  (necessário para compilar o `better-sqlite3`). Sem isto o build falha em `node-gyp`.

**Comandos (na raiz do repo):**
```bash
pnpm install                       # compila o better-sqlite3 nativo (precisa do VC++)
pnpm --filter @nexus/desktop run dist:win
```
**Saída:** `apps/desktop/release/NdombaxiSystem-Setup-<versão>-<arch>.exe`

> Antes de gerar: subir a **versão** em `apps/desktop/package.json` — é a mudança de
> versão que faz a app detetar a atualização e mostrar o ecrã de update.

---

## 2. Android (`.apk` / `.aab`)

**Pré-requisitos (uma vez):**
- **Android Studio** + SDK (define `ANDROID_HOME`), JDK 17.
- Projeto Android criado: `pnpm --filter @nexus/mobile-shell run add:android` (só a 1.ª vez).

**Comandos:**
```bash
pnpm --filter @nexus/mobile-shell run sync   # prepara o www + cap sync
pnpm --filter @nexus/mobile-shell run open:android
```
No Android Studio: **Build → Generate Signed Bundle/APK** (com a keystore da app).
**Saída:** `apps/mobile-shell/android/app/build/outputs/...`

---

## 3. iOS (`.ipa`)

**Só é possível num Mac com Xcode.** Não sai de Windows.
```bash
pnpm --filter @nexus/mobile-shell run add:ios     # 1.ª vez
pnpm --filter @nexus/mobile-shell run sync
pnpm --filter @nexus/mobile-shell run open:ios
```
No Xcode: **Product → Archive → Distribute App**.

---

## 4. Colocar na pasta "Ndombaxi System"

Copiar os 3 artefactos (`.exe`, `.apk`, `.ipa`) para a pasta **"Ndombaxi System"**
(caminho a definir — ex.: `C:\Users\Manuel\...\Ndombaxi System\setups\`).

Depois, no site: **Super Admin → Gestão de Downloads** → colar os links (Drive/Mega)
para a app detetar a versão nova. O link de armazenamento nunca aparece ao cliente:
a app leva-o à página oficial de downloads do site.
