# F4 — Carrinho da Caixa em tablets e navegadores antigos (2026-11-26)

## Engenharia reversa
- A Caixa ocupa a janela sem scroll: `.pos { height: 100dvh }` e `.app-bg:has(.pos) { height: 100dvh }`. O carrinho rola por dentro (`.vtable-b`). A única reserva era para o iOS antigo (`-webkit-touch-callout`).
- **Motores sem `dvh` nem `:has()`** (Chrome/WebView Android < 105–108, Safari < 15.4): a altura era descartada, a página crescia e o **TOTAL, as Opções e o FINALIZAR ficavam fora do ecrã** (QA-013).
- **Sem `color-mix()`** (Safari < 16.2, Chrome < 111): 45 declarações em `vpos.css` sem reserva (`qa/css-legacy.mjs`). Os fundos das janelas da Caixa (`.vw-bg`), das Opções, do Finalizar e do TOTAL ficavam transparentes, com texto branco sobre fundo claro (QA-014).
- Botão ✕ de cada linha do carrinho: 22×22 px, pequeno para toque em tablet (QA-015).

## Correção
- `.pos` e `.cart.vcart`: `vh` antes de `dvh`. `.app-bg.app-bg-pos` (classe no `PosPage`) substitui `:has()`.
- Bloco `@supports not (background: color-mix(...))` com cores sólidas para `.vw-bg`, `.vopts`, `.vtotal`, `.vfin-*`, `.vproc-bg`, `.vs-band`, `.vw-bar`, `.vw-sum`, `.cv-row.mine .cv-bub`.
- ✕ das linhas com alvo de 40×40 px (mesmo aspeto); cabeçalho e linhas com o mesmo espaço à direita.

## Testes executados
`qa/carrinho-tablets.mjs` com 7 artigos no carrinho, em 8 tamanhos: iPad 768×1024 e 1024×768, iPad Air 820×1180 e 1180×820 (WebKit), tablet Android 800×1280 e 1280×800, tablet 7" 600×960 e 960×600 (Chromium). Verifica: sem scroll lateral; TOTAL/Opções/FINALIZAR no ecrã; 1.ª linha visível sem corte; alvos ≥ 32 px; a lista rola.
`LEGACY=1` simula um motor antigo: o CSS é intercetado e `color-mix()`, `dvh/svh`, `:has()` e container queries são invalidados (o motor descarta-os como um Chrome < 105 ou um Safari < 15.4).

| Alvo | Moderno | Motor antigo simulado |
|---|---|---|
| main (antes) | 32/40 — C4 (✕ 22 px) em todos | **24/40** — C2 (TOTAL/FINALIZAR fora do ecrã) + C4 em todos |
| correção | 40/40 | 40/40 |

`qa/modais-x.mjs` repetido depois da F4 (sem regressão nas janelas): ver o PR.

## Não verificado
- Navegadores antigos REAIS (Safari 12–15 em iPad, WebView Android antiga). A simulação cobre só as regras CSS; o JS sai em ES2019 no build (`vite.config.ts`).
- Fundos `color-mix()` em `theme.css` fora da Caixa (cartões, chat): sem impacto de leitura, exceto a bolha do chat, já corrigida.

## Teste em motores antigos REAIS (pedido do utilizador)
Motores oficiais do CDN do Playwright (Microsoft): **Chromium 93.0.4530** (rev. 888113, Blink, como as WebViews Android antigas) e **WebKit 14.2** (rev. 1492, o motor do Safari 14, em Windows/WinCairo), conduzidos pelo `playwright-core@1.12.3`. Confirmado em execução: nenhum dos dois suporta `dvh`, `:has()` ou `color-mix()`. Os testes correm contra o **build de produção** da Caixa (JS em ES2019), servido localmente com proxy para a API de QA. Script: `qa/navegadores-antigos.mjs`.

| Alvo | Resultado |
|---|---|
| main (build de fce1981) | **1/13** — TOTAL/Opções/FINALIZAR fora do ecrã nos 4 tablets nos dois motores (no WebKit a página crescia +8000 px), janelas com fundo transparente (`rgba(0,0,0,0)`), erro de JS por tratar no WebKit |
| correção (build final) | **14/14 PASS** — carrinho cabe, TOTAL com fundo, lista rola, ✕ 40 px, Opções com ⊗ e «Cancelar Venda» visível no telemóvel, Finalizar fecha, sem erros de JS |

Achado extra (QA-016): `rememberOffline` (credencial para entrar sem rede) é chamado com `void` no login, mas a falha do PBKDF2 não era apanhada. O WebKit 14.2 para Windows não suporta PBKDF2 e isso dava `NotSupportedError` por tratar. Corrigido na Caixa e na Gestão (melhor esforço de verdade; `verifyOffline` devolve «indisponível»). O Safari 14 verdadeiro suporta PBKDF2, por isso no iPad real este erro não deve acontecer.

Limites: o WebKit 14.2 corre em Windows (não é um iPad físico) e a renderização de fontes do WinCairo difere da do Safari. Dispositivos físicos continuam por testar pelo utilizador.
