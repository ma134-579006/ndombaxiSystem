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
   - **DATABASE_URL** → o teu Service URI do **Aiven** (o mesmo que está em `apps/api/.env`, começa por `postgres://avnadmin:...`; acrescenta `?sslmode=require` no fim se não tiver).
   - **SUPER_ADMIN_PASSWORD** → uma password forte (será a do super admin).
   - **CORS_ORIGINS** → já vem **pré-preenchido** no `render.yaml`; podes deixar como está.
4. **Apply / Create**. Espera ~3-5 min (1.ª build).

✅ Confirmação: abre `https://ndombaxi-api.onrender.com/health` → vês `{"status":"ok",...}`.
   **Copia este URL** (o teu pode ter um sufixo diferente) — é o teu **API_URL**.

---

## PASSO 3 — Publicar as 3 apps no Cloudflare Pages

Conta em https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → escolhe o repo.

Vais criar **3 projetos** (repete os passos, mudando só 2 campos):

> ⚠️ Usa `--prod=false` no install (o Cloudflare põe `NODE_ENV=production` e sem
> isso salta o `vite`/`typescript` e o build falha — o mesmo que aconteceu no Render).

| Projeto | App | Build command | Output directory |
|---|---|---|---|
| **ndombaxi-admin** ⭐ | web | `npx -y pnpm@9.15.9 install --frozen-lockfile --prod=false && npx -y pnpm@9.15.9 --filter @nexus/web build` | `apps/web/dist` |
| **ndombaxi-loja** | store | `npx -y pnpm@9.15.9 install --frozen-lockfile --prod=false && npx -y pnpm@9.15.9 --filter @nexus/store build` | `apps/store/dist` |
| **ndombaxi-caixa** | pos | `npx -y pnpm@9.15.9 install --frozen-lockfile --prod=false && npx -y pnpm@9.15.9 --filter @nexus/pos build` | `apps/pos/dist` |

- **Root directory:** deixa em branco (raiz do repo — é um monorepo pnpm).
- Em **cada** projeto, em **Environment variables**, adiciona:
  - **VITE_API_URL** = o URL da API do Passo 2 (ex.: `https://ndombaxi-api.onrender.com`)
  - **NODE_VERSION** = `20.18.1`
  - *(só na loja, opcional)* **VITE_STORE_CODE** = código de uma empresa, p/ loja fixa.

> O **ndombaxi-admin** é o principal: é a página inicial (criar conta + planos), o login, o Super Admin e o painel do gestor.

✅ Confirmação: cada um dá-te um link tipo `https://ndombaxi-admin.pages.dev`.

---

## PASSO 4 — Ligar as pontas (CORS)

Normalmente **não precisas de fazer nada**: a API já aceita automaticamente
qualquer domínio `*.pages.dev` e `*.vercel.app`, e o `CORS_ORIGINS` já vem
pré-preenchido com os 3 nomes sugeridos.

> Só se usares **domínio próprio** (ex.: `app.aminhaloja.ao`): Render → serviço
> `ndombaxi-api` → **Environment** → acrescenta esse domínio ao **CORS_ORIGINS** → **Save**.

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
