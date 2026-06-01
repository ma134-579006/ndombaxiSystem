# 🚀 Pôr o Ndombaxi System ONLINE 24/7 — grátis

Guia passo-a-passo, **sem terminal complicado**. No fim tens links que
funcionam em qualquer telemóvel/PC, sem ligar o teu computador.

## O que vais ter (tudo no plano grátis)

| Peça | Onde | Custo | 24/7? |
|---|---|---|---|
| Base de dados | **Aiven** (já tens ✅) | grátis | ✅ sempre |
| Servidor / API | **Render** | grátis | ⚠️ adormece após ~15 min (acorda em ~40s) |
| Caixa, Loja, Admin | **Cloudflare Pages** | grátis | ✅ sempre |

> 💡 **A verdade sobre o "adormecer":** a API grátis do Render desliga quando ninguém a usa. O primeiro acesso a seguir demora ~40s a acordar; depois fica rápida. **Não perde dados.** Para nunca adormecer são ~5 USD/mês (Render "Starter"). Para começar, o grátis chega.

---

## PASSO 1 — Pôr o código no GitHub (uma vez)

1. Cria conta em https://github.com (se não tens).
2. Cria um repositório **privado** vazio (ex.: `ndombaxi-system`). **Não** marques "Add README".
3. No teu PC, na pasta do projeto, corre (troca `TEU-USER`):
   ```cmd
   git remote add origin https://github.com/TEU-USER/ndombaxi-system.git
   git push -u origin master
   ```
   > Se pedir login, usa o teu utilizador GitHub + um **token** (github.com → Settings → Developer settings → Personal access tokens).

✅ Confirmação: vês os teus ficheiros no GitHub.

---

## PASSO 2 — Publicar a API no Render

1. Conta em https://render.com → **"Get Started"** (entra com o GitHub).
2. **New +** → **Blueprint** → escolhe o repositório `ndombaxi-system`.
   O Render lê o `render.yaml` e propõe o serviço **ndombaxi-api**.
3. Preenche as variáveis que ele pede (as "sync: false"):
   - **DATABASE_URL** → o teu Service URI do **Aiven** (o mesmo que está em `apps/api/.env`, começa por `postgres://avnadmin:...`).
   - **SUPER_ADMIN_PASSWORD** → uma password forte (ex.: a tua, ou nova).
   - **CORS_ORIGINS** → deixa **vazio por agora**; voltamos aqui no Passo 4.
4. **Apply / Create**. Espera ~3-5 min (1.ª build).

✅ Confirmação: abre `https://ndombaxi-api.onrender.com/health` → vês `{"status":"ok",...}`.
   **Copia este URL** (o teu pode ter um sufixo diferente) — é o teu **API_URL**.

---

## PASSO 3 — Publicar as 3 apps no Cloudflare Pages

Conta em https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → escolhe o repo.

Vais criar **3 projetos** (repete os passos, mudando só 2 campos):

| Projeto | Build command | Output directory |
|---|---|---|
| **ndombaxi-admin** | `npx pnpm i && npx pnpm --filter @nexus/web build` | `apps/web/dist` |
| **ndombaxi-loja** | `npx pnpm i && npx pnpm --filter @nexus/store build` | `apps/store/dist` |
| **ndombaxi-caixa** | `npx pnpm i && npx pnpm --filter @nexus/pos build` | `apps/pos/dist` |

Em **cada** projeto, antes de "Save and Deploy", abre **Environment variables** e adiciona:
- **VITE_API_URL** = o URL da API do Passo 2 (ex.: `https://ndombaxi-api.onrender.com`)

> Nota: também precisas de `corepack`/pnpm. Se o build falhar a achar o pnpm, em **Settings → Build → Build system version** escolhe a v2, e no comando usa `npx pnpm@9 ...`.

✅ Confirmação: cada um dá-te um link tipo `https://ndombaxi-admin.pages.dev`.

---

## PASSO 4 — Ligar as pontas (CORS)

1. Junta os 3 links `.pages.dev` separados por vírgula, ex.:
   `https://ndombaxi-admin.pages.dev,https://ndombaxi-loja.pages.dev,https://ndombaxi-caixa.pages.dev`
2. Render → o teu serviço `ndombaxi-api` → **Environment** → edita **CORS_ORIGINS** com essa lista → **Save** (a API reinicia sozinha).

> Mesmo que te esqueças, a API já aceita automaticamente qualquer domínio `*.pages.dev` e `*.vercel.app` — mas preencher é mais seguro.

---

## ✅ PRONTO — os teus links 24/7

| App | Link | Quem usa |
|---|---|---|
| **Painel Admin** | `https://ndombaxi-admin.pages.dev` | Super Admin + Gestor |
| **Loja online** | `https://ndombaxi-loja.pages.dev/?loja=novashop` | Clientes |
| **Caixa (POS)** | `https://ndombaxi-caixa.pages.dev` | Operadores |

Super Admin: `admin@ndombaxi.ao` / a password que definiste no Render.

---

## 🔄 Atualizar depois de mudares código

Só fazes `git push` → o Render e o Cloudflare **reconstroem sozinhos** (deploy automático). Não há mais nada a fazer.

## 🆘 Problemas comuns
- **API demora no 1.º acesso** → normal (Render free a acordar). Espera ~40s.
- **"Network error" nas apps** → confere o `VITE_API_URL` (Passo 3) e o `/health` da API.
- **Build falha no Cloudflare** → usa `npx pnpm@9` nos comandos e Build system v2.
