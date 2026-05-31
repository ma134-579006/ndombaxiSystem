# Ndombaxi System

Plataforma empresarial para Angola — **POS (caixa)**, **ERP**, **e-commerce**, **IA (OpenManus)** e **administração**, com conformidade fiscal **AGT** (facturação, hash, SAF-T, assinatura RSA-2048).

> Desenvolvido por **Manuel Mbala Tomás Ndombaxi**. © Ndombaxi System.

---

## 🚀 Arrancar num clique

**Pré-requisitos** (instalam-se **uma única vez** — não consigo instalá-los por si porque exigem permissões de administrador):

1. **Docker Desktop** → https://www.docker.com/products/docker-desktop/ (corre a base de dados)
2. **Node.js 20+** → https://nodejs.org/ e depois, num terminal: `npm i -g pnpm`

Depois:

| Sistema | Como arrancar |
|---|---|
| **Windows** | Duplo clique em **`INICIAR.bat`** |
| **Mac / Linux** | `./iniciar.sh` |

O script faz **tudo sozinho**: sobe a base de dados (Docker), instala dependências, cria o esquema, semeia os dados iniciais e abre a API + as 3 aplicações web.

### Endereços (depois de arrancar)
| Aplicação | URL |
|---|---|
| API / Servidor | http://localhost:3000 |
| **Caixa (POS)** | http://localhost:5173 |
| **Loja online** | http://localhost:5174 |
| **Painel Admin (Super Admin)** | http://localhost:5175 |

**Super Admin:** `admin@ndombaxi.ao` / `Ndombaxi!Admin2026`

### Dados de demonstração (opcional)
Com tudo a correr, num terminal: **`pnpm demo`** — cria a loja **demo** com produtos. Veja a montra em http://localhost:5174/?loja=demo

---

## 📦 "Todas as dependências dentro do projecto"

- O **`.npmrc`** está configurado para instalar a partir do cache local (offline/rápido).
- Para empacotar **mesmo tudo** (zero instalação no servidor), há uma **imagem Docker** da API que inclui todas as dependências e corre migrações + seed sozinha:
  ```bash
  docker compose -f infra/docker/docker-compose.yml --profile full up -d --build
  ```
  > ⚠️ Esta imagem foi escrita com cuidado mas **ainda não foi testada neste ambiente** (não havia Docker instalado aqui). Na primeira utilização confirme que constrói; se algo falhar, diga-me e ajusto.

---

## 🌐 Pôr online 24/7 — a verdade honesta

**Não existe** um servidor que seja, ao mesmo tempo, *“100% grátis + potente + 24/7”*. Todas as camadas gratuitas têm limites (adormecem, têm quotas, ou expiram). O que **existe mesmo** e funciona bem para começar (grátis):

| Parte | Recomendação grátis | Nota honesta |
|---|---|---|
| **Base de dados (Postgres)** | **Neon** (neon.tech) ou **Supabase** | Não adormece; plano grátis generoso. ✅ melhor opção |
| **API (NestJS)** | **Render** (free) ou **Railway** ou **Fly.io** | Free *adormece* após ~15 min de inação e acorda no 1.º pedido. Para 24/7 sem adormecer ⇒ ~5 USD/mês. |
| **Caixa / Loja / Admin** (são estáticos) | **Cloudflare Pages**, **Vercel** ou **Netlify** | Grátis, rápidos, **24/7 a sério** (são ficheiros estáticos via CDN). ✅ |

**Receita recomendada (toda grátis para arrancar):** Neon (BD) + Render (API) + Cloudflare Pages (as 3 apps web).

Passos resumidos:
1. Crie a BD no Neon → copie o `DATABASE_URL`.
2. Publique a API no Render (a partir deste repositório): defina `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CONFIG_ENCRYPTION_KEY`, `SUPER_ADMIN_EMAIL/PASSWORD`. Há um `render.yaml` neste repo como ponto de partida.
3. Publique cada frontend (`apps/pos`, `apps/store`, `apps/web`) no Cloudflare Pages com `VITE_API_URL` = URL pública da API.

---

## 🔌 "BD local nos apps + sincronizar quando houver internet"

Sejamos claros: **isto ainda NÃO está construído** — não lhe quero dizer que funciona quando não funciona.

Hoje a arquitetura é **cliente ↔ servidor** com uma BD central (Postgres). As apps (caixa, loja, admin, mobile) falam com a API.

Para ter **modo offline com sincronização** é preciso uma camada nova e significativa:
- Persistência local (ex.: **SQLite** no mobile, **IndexedDB** no web);
- Fila de operações feitas offline;
- Sincronização e **resolução de conflitos** quando a rede volta;
- Cuidado especial com a **numeração fiscal** (sequência sem saltos exigida pela AGT) — normalmente atribui-se um intervalo de números por terminal.

É um excelente próximo passo. Se quiser, começo pela **caixa (POS)** — guardar a venda localmente e enviar quando houver rede.

---

## 🔐 Antes de ir para produção
Troque **todos** os segredos (estão marcados como *DEV* em `apps/api/.env`):
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CONFIG_ENCRYPTION_KEY`, `SUPER_ADMIN_PASSWORD`, `DB_PASSWORD`.

---

## 🧩 Estrutura
```
apps/
  api/      API NestJS + Prisma + AGT (multi-tenant)
  pos/      Caixa (POS) web — táctil, teclado no ecrã
  store/    Montra pública (loja online)
  web/      Painel de administração (Super Admin)
  mobile/   App back-office (Expo / React Native)
packages/
  agt-xml/  Motor fiscal AGT (IVA, numeração, hash, SAF-T, assinatura RSA)
  types/    Tipos partilhados
infra/docker/  docker-compose (Postgres, Redis, RabbitMQ, API opcional)
```

### Comandos úteis
| Comando | O quê |
|---|---|
| `pnpm setup` | instala + cria esquema + seed |
| `pnpm db:push` | cria/actualiza o esquema na BD |
| `pnpm db:seed` | Super Admin + planos |
| `pnpm demo` | loja de demonstração com produtos |
| `pnpm api:dev` | corre a API |
| `pnpm web:build` | compila caixa + loja + admin |
| `pnpm infra:up` / `infra:down` | sobe/baixa o Docker |
