# F1 — Integridade e sincronização offline (2026-11-26)

## Requisito
A sincronização arranca sozinha quando a Internet volta, **sem obrigar a entrar na Caixa**.

## Engenharia reversa (como estava)
- `apps/pos/src/main.tsx` já arrancava o motor (`syncController.start()`) com a app, e o relógio sondava `/health` de 3 em 3 s.
- Mas cada envio (`POST /pos/invoices`, `/sync/push`, fila de escritas) usava **só a sessão viva** do operador (`AuthContext`, tokens em `sessionStorage`).
- App fechada e reaberta → sem sessão → 401 → `emitOne` devolvia `offline` com «Sessão expirada — entre novamente». **A fila ficava parada até alguém entrar na Caixa** (QA-001).
- Com «Lembrar-me», o restauro com o token expirado e sem rede caía em `clearSession()`, o que pedia novo login (QA-002).
- A API roda o refresh token (`TokenService.rotate` revoga o antigo). O cofre offline guardava só os tokens do login e ficava revogado depois da 1.ª renovação (QA-003).

## Correção
- `apps/pos/src/pos/syncAuth.ts` (lógica pura, testada) + `offline/syncIdentity.ts` (armazenamento durável): é a **identidade de sincronização** do aparelho. Guarda o último par de tokens emitido pelo servidor e é atualizada em cada `applyTokens` real (login, renovação, promoção). Fica assim na mesma família de tokens da sessão viva, sem revogações cruzadas.
- `api/client.ts`: os pedidos do motor (`background: true` — emissão da fila, `/sync/push`, fila de escritas) usam a sessão viva quando ela existe. Sem sessão viva utilizável, usam a identidade do aparelho, que renova sozinha (single-flight) e nunca toca na sessão viva. Espera primeiro pelo restauro da sessão (`waitSettled`) para não haver dois refresh com o mesmo token.
- `AuthContext.tsx`: restauro sem rede mantém a sessão; tokens do cofre (login sem rede) não sobrepõem a identidade; cofre atualizado em cada rotação.
- `sync.ts`: 401 sem credencial → resultado `auth` (não marca "sem rede", sem repetir a cada 3 s); quando a sonda confirma a rede, `confirmarRede()` liberta logo o cliente HTTP.
- Segurança: não se guarda PIN nem senha. Se o servidor recusar a identidade (401/403), ela é apagada.

## Testes executados
| Teste | Ambiente | Resultado |
|---|---|---|
| `pnpm --filter @nexus/pos test` (inclui 8 testes novos de `syncAuth`) | Node 22 | 23/23 PASS |
| `tsc --noEmit` + `vite build` da Caixa | local | OK |
| `qa/sync-sem-login.mjs` contra a **main** (5182) | Playwright Chromium (emulado, modo app instalada) + API QA + PostgreSQL QA | **5/9** — S1, S1c, S4a, S4b FAIL (bugs reproduzidos) |
| `qa/sync-sem-login.mjs` contra a **correção** (5181) | idem | **9/9 PASS** — venda sobe em 4,8 s sem login, 1 só fatura, fila vazia, Caixa continua no login; «Lembrar-me» sem rede mantém a sessão e renova-a |

Cenário S1: operador entra com rede → API cai → venda na fila (mesma função `buildPendingSale`/`queueSale` do ecrã de vendas)
→ app fecha → reabre sem rede e sem sessão → rede volta → ninguém entra → fatura na BD com o mesmo `client_op_id`.

## Não verificado
- Dispositivo real (Windows instalado, Android, iPhone). Os testes emulam a app instalada no Chromium.
- Gestão (QA-006) e Android com só a Gestão aberta (QA-007): ficam para a F1b.

---

# F1b — Gestão (2026-11-26)

## Como estava
- `AuthContext` só arrancava `startPrefetchSchedule` (que esvazia a fila de escritas) com `status === 'authed'`. A sessão vive em `sessionStorage`; com a app reaberta e ninguém a entrar, **nada subia** (QA-006).
- O restauro da sessão lembrada sem rede também terminava a sessão (QA-010).

## Correção
- `apps/web/src/offline/syncAuth.ts` (cópia da Caixa) + `offline/syncIdentity.ts` com chave própria `offline:syncIdentity:gestao`. No Android a Gestão e a Caixa partilham a memória, e uma nunca roda os tokens da outra.
- Só se guardam sessões de **empresa** próprias: nunca o Super Admin (PLATFORM) nem o acesso shadow.
- `sendQueuedWrite` usa a identidade do aparelho quando não há sessão viva utilizável.
- `startBackgroundOutbox()` em `main.tsx`: de 3 em 3 s, se não há sessão e há algo na fila, envia-o (sem pré-carregamento). `replayOutbox` é exclusivo, por isso nunca envia a mesma operação duas vezes.

## Testes executados
| Teste | Resultado |
|---|---|
| `qa/sync-gestao-sem-login.mjs` contra a main (5184) | **5/7** — G1, G1c FAIL (bug reproduzido) |
| `qa/sync-gestao-sem-login.mjs` contra a correção (5183) | **7/7 PASS** — cliente criado sem rede sobe em 2,1 s sem login, uma só linha, fila vazia |
| `qa/sync-sem-login.mjs` (Caixa) depois da F1b | 9/9 PASS (sem regressão) |
| `tsc --noEmit` + `vite build` da Gestão | OK |

Não verificado com teste dedicado: exclusão do shadow e do Super Admin (garantida no código por `subjectType === 'TENANT'` e `LS_PREV_ACCESS`). Dispositivo real por testar.
