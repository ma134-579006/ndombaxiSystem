# Registo de bugs — Missão Master QA

Prioridade: **P0** perda de dados/dinheiro ou fiscal · **P1** fluxo crítico bloqueado · **P2** degradação com contorno · **P3** cosmético.
Estado: **VERIFIED** (reproduzido e confirmado por teste executado) · **UNVERIFIED** (visto no código, ainda por reproduzir).
"Emulado" = Playwright/browser no PC; "real" = dispositivo físico.

| ID | P | Fase | Área | Descrição | Estado | Correção / evidência |
|---|---|---|---|---|---|---|
| QA-001 | P1 | F1 | Caixa (apps) | Vendas feitas sem rede só subiam com a sessão viva do operador. Ao fechar e reabrir a app, a fila recebia 401 e ficava parada até alguém voltar a entrar na Caixa. | VERIFIED (emulado) — corrigido | `qa/sync-sem-login.mjs`: main 5/9, correção 9/9 (S1 sobe em 4,8 s) — PR #273 na main |
| QA-002 | P1 | F1 | Caixa (apps) | Com «Lembrar-me», abrir a app sem rede e com o token de acesso expirado terminava a sessão e obrigava a novo login. | VERIFIED (emulado) — corrigido | S4a/S4b: main FAIL, correção PASS |
| QA-003 | P2 | F1 | Caixa (apps) | O cofre offline guardava só os tokens do login. Depois da 1.ª renovação ficavam revogados, e o login sem rede caía (401) quando a rede voltava. | Corrigido (no código, sem teste dedicado) | `vaultTokensRotated` em cada rotação |
| QA-004 | P2 | F1 | Caixa (apps) | Uma 401 sem credencial marcava "sem rede": o relógio repetia o envio a cada 3 s. | Corrigido (no código) | resultado `auth` em `sync.ts`, nova tentativa a cada 30 s ou no login |
| QA-005 | P2 | F1 | Caixa (apps) | Depois de uma falha, o cliente HTTP só voltava a tentar ao fim da sonda de 15 s, mesmo com o motor a confirmar que havia rede (subida em ~18 s). | VERIFIED (emulado) — corrigido | `confirmarRede()`: 18,2 s → 4,8 s |
| QA-006 | P1 | F1b | Gestão (apps) | A fila de alterações feitas sem rede (`startPrefetchSchedule`) só corria com sessão aberta. Com a app reaberta, nada subia até alguém entrar na Gestão. | VERIFIED (emulado) — corrigido | `qa/sync-gestao-sem-login.mjs`: main 5/7, correção 7/7 (sobe em 2,1 s) — PR #274 na main |
| QA-010 | P2 | F1b | Gestão (apps) | Com a sessão lembrada, abrir a app sem rede e com o token expirado terminava a sessão. | Corrigido (no código, mesmo padrão da Caixa) | restauro mantém a sessão em falha de rede/5xx |
| QA-007 | P2 | F1 | Android | Gestão e Caixa partilham a origem, mas a fila de vendas só sobe quando a app Caixa está aberta. | UNVERIFIED (dispositivo real) | limitação documentada (motor nas páginas, não em serviço nativo) |
| QA-008 | P1 | F3 | Caixa | `modalClose.ts` só acrescenta o X às janelas que fecham ao clicar no fundo. As janelas sem `onClick` no fundo (ex.: cancelar venda) ficam sem X. | UNVERIFIED | F3 |
| QA-009 | P1 | F2 | Login/registo (telemóvel) | Com o teclado no ecrã, `useFitHeight` reduzia o cartão inteiro (CSS zoom ~0,64–0,70) para caber acima do teclado, o que deformava o login da Caixa e da Gestão. | VERIFIED (emulado Android/iPhone) — corrigido | `qa/login-teclado.mjs`: main 4/10, correção 10/10. Dispositivo real por confirmar |
| QA-011 | P2 | F2 | Login/registo (browser) | O botão «Entrar com Facebook» aparecia sem App ID publicado (produção: `facebookAppId: null`) e só dava erro ao carregar. | VERIFIED (emulado) — corrigido | F1 em `qa/login-teclado.mjs` |
| QA-012 | P2 | F2 | Apps instaladas | Não há «Entrar com Facebook» nas apps (o SDK JS não funciona em WebView/Electron). É preciso o SDK nativo do Facebook + o key hash Android na app do Facebook. | UNVERIFIED — limitação | depende do App ID/Secret do utilizador; fora desta fase |

## Limitações conhecidas (não são bugs)
- A venda offline sobe com a identidade do **último login real do aparelho** (como antes subia com quem estivesse ligado). O operador que fez a venda não é transmitido separadamente.
- Se o servidor recusar a identidade do aparelho (sessão terminada, funcionário removido, mais de 7 dias sem rede — `JWT_REFRESH_TTL`), a fila espera por um login. É a única situação em que isso acontece.
