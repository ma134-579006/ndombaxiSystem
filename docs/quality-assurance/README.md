# Garantia de qualidade — Missão Master LPS Vendas (iniciada a 2026-11-26)

Auditoria total, engenharia reversa, correção de bugs, responsividade e testes de stress.
Registo de bugs: [BUG-REGISTER.md](BUG-REGISTER.md). Relatórios por fase: `F<n>-*.md`.

## Inventário das aplicações
| Aplicação | Pasta | Tecnologia | Offline |
|---|---|---|---|
| Gestão / Admin / Super Admin | `apps/web` | React + Vite | só nas apps instaladas (memória interna, fila de escritas, pré-carregamento) |
| Caixa / POS | `apps/pos` | React + Vite | fila de vendas e turnos (`offline/sync.ts`) |
| API central | `apps/api` | NestJS + Prisma + PostgreSQL (Aiven) | — |
| Loja online + Loja dos associados (Kwanza) | `apps/store`, `apps/store-shell` | React + Vite / Capacitor | não |
| Windows | `apps/desktop` + `apps/local-server` | Electron + PostgreSQL local | réplica + journal |
| Android / iOS | `apps/mobile-shell` | Capacitor (Gestão + Caixa) + SQLite | `@nexus/offline-core` |
| Gestão móvel | `apps/mobile` | Expo (React Native) | por confirmar se está em uso |

## Ambientes de teste
| Ambiente | Para quê | Regras |
|---|---|---|
| QA local: PostgreSQL 16 em 127.0.0.1:55433 (`nexus_qa`) + API em :3901 (`qa/restart-api.sh`) | fluxos, sincronização, concorrência, carga | dados sintéticos `.qa.test`; `qa/lib.mjs` recusa outro anfitrião |
| Simuladores (`qa/vendus-mock.mjs`, `qa/agt-fe-mock.mjs`) | motor fiscal sem emissão real | — |
| Caixa/Gestão em dev com `VITE_API_URL=<dev>/papi` e `PAPI_TARGET=http://127.0.0.1:3901` | testes de browser (Playwright, browser da app) | o Playwright bloqueia `onrender.com`, `lpsvendas` e `vendus.co` |
| Produção | só leitura e verificação visual | nunca emitir documentos fiscais nem apagar dados; sem testes de carga |

**Emulado vs. real:** todos os testes de dispositivo desta missão são **emulados** (Chromium/WebKit/Firefox
do Playwright, viewports e user-agents, modo "app instalada" via `window.__NDOMBAXI_NATIVE__`). O que exigir
iPhone/Android/tablet físico fica marcado como `UNVERIFIED (dispositivo real)` no registo de bugs.

## Riscos
- Motor fiscal Vendus ativo em produção: uma venda verdadeira emite uma FR real.
- O Render nem sempre publica sozinho depois do merge: confirmar o commit em `/health`.
- Ficheiros com CRLF/LF misturados: preservar o formato de cada ficheiro (`git diff --numstat`).
- O Cloudflare Pages exige o `pnpm-lock.yaml` congelado.

## Fases (ordem do utilizador)
1. Integridade e sincronização offline — [F1](F1-SINCRONIZACAO-OFFLINE.md)
2. Login e registo (Google, Facebook, teclado virtual no telemóvel) — [F2](F2-LOGIN-REGISTO.md)
3. Modais sem botão X (cancelar venda na Caixa em iPhone/Android)
4. Carrinho da Caixa em tablets e navegadores antigos
5. Formulários
6. Responsividade e compatibilidade
7. Loja dos associados
8. Carga e concorrência (ambiente isolado)
9. Ícones e publicidades
10. Segurança
