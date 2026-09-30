# Migração de domínio: ndombaxisystem.com → lpsvendas.com

**PRODUÇÃO = `ndombaxisystem.com`** (inalterado). `lpsvendas.com` ainda NÃO está registado (RDAP 404, DNS NXDOMAIN em 2026-09-30).
Nada aqui altera DNS, Cloudflare, Google OAuth, SMTP, SAF-T nem identificadores técnicos. Sem redirects.

## O que o código já suporta (preparado, inactivo)
| Ponto | Hoje (defeito) | Para activar o novo domínio |
|---|---|---|
| Web: URLs da Loja/Caixa/site (`apps/web/src/config.ts`) | `ndombaxisystem.com` | `VITE_PUBLIC_DOMAIN=lpsvendas.com` no build do Cloudflare Pages (`VITE_STORE_URL`/`VITE_CAIXA_URL` ainda prevalecem) |
| API: links de recuperação/activação (`auth.service.ts`) | `ndombaxisystem.com` | `PUBLIC_DOMAIN=lpsvendas.com` no Render (`PUBLIC_WEB_URL`/`PUBLIC_CAIXA_URL` prevalecem) |
| API: CORS (`main.ts`) | só `ndombaxisystem.com` (+ `.pages.dev` etc.) | `CORS_EXTRA_HOSTS=lpsvendas.com` no Render (aceita apex e subdomínios `www/caixa/loja/admin`). Não está fixo no código para ninguém poder registar o domínio e obter CORS com credenciais antes de nós |
| Textos, SEO, cabeçalhos estáticos, updater, provas, docs | `ndombaxisystem.com` | `node scripts/migrar-dominio.mjs --apply` (lista explícita; simulação por defeito) |

## Etapa 2 — só depois de dizeres «Registei lpsvendas.com»
Cada passo externo é apresentado antes com: configuração actual, o que será criado, impacto, risco e rollback.
1. Adicionar `lpsvendas.com` ao Cloudflare (nova zona; a de `ndombaxisystem.com` fica intacta).
2. DNS + Cloudflare Pages: apex, `www`, `caixa`, `loja`, `admin` (só acrescentar).
3. HTTPS válido em todos.
4. Google OAuth: **acrescentar** origens/redirects (não remover os antigos; `com.ndombaxi.system` intacto).
5. SMTP: SPF, DKIM, DMARC e remetente do novo domínio (manter o antigo até confirmar).
6. Render: `PUBLIC_DOMAIN`, `CORS_EXTRA_HOSTS`; Pages: `VITE_PUBLIC_DOMAIN`.
7. Testes: início, login, registo, recuperação, activação, OAuth, Caixa, Loja, Admin, API, PWA, e-mails, CORS, HTTPS, assets, favicon, canonical, sitemap, robots.
8. `node scripts/migrar-dominio.mjs --apply`, PR, deploy → domínio oficial passa a `lpsvendas.com`.
9. **Só no fim:** 301 `ndombaxisystem.com → lpsvendas.com` (e `www`), preservando o caminho, sem remover o domínio antigo.

## Riscos a tratar antes do 301
- **Dados locais por origem:** IndexedDB do Caixa no browser, carrinho da Loja, tema e sessão ficam presos ao domínio antigo. Vendas offline por sincronizar podem perder-se → sincronizar todos os postos antes do 301. As apps instaladas não são afectadas (`ndombaxi://`, API `ndombaxi-api-3nmz.onrender.com`).
- **Versões antigas do desktop** abrem `/baixar` do domínio antigo → o 301 tem de preservar o caminho.
- **`_headers`** (CORS de estáticos) é fixo por ficheiro → coberto pelo script.

## Rollback
Antes do passo 8, nada em produção mudou (só variáveis novas, sem efeito sem o domínio). Depois: remover as variáveis (`PUBLIC_DOMAIN`, `CORS_EXTRA_HOSTS`, `VITE_PUBLIC_DOMAIN`) e reverter o PR do passo 8; o domínio antigo nunca deixou de funcionar. Sem 301 activo o rollback é imediato.
