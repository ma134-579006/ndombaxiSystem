# F6 — Responsividade e compatibilidade (2026-11-27)

## Âmbito e método
- **Gestão** (`qa/responsivo.mjs`): 30 secções × 9 tamanhos (240×320, 320×568, 390×844, 768×1024, 1024×768, 1366×768, 1920×1080, 3840×2160, 7680×4320) no Chromium. Mais Firefox/WebKit em 320/768/1366.
- **Caixa e Loja** (`qa/responsivo-caixa-loja.mjs`, API clássica): Loja (início, associados, produto), Caixa (login e venda com 5 artigos) de 240×320 a 4K, no Chromium e WebKit atuais e nos **motores antigos reais** Chromium 93 e WebKit 14.2 (os mesmos da F4), contra os builds de produção.
- Critério: zero scroll lateral na página e dentro de contentores (barras deslizantes por desenho — abas, categorias, carrosséis — listadas à parte); na Caixa, FINALIZAR dentro do ecrã.

## Defeitos encontrados e corrigidos
| ID | Onde | Defeito | Correção |
|---|---|---|---|
| QA-018 | Gestão › Fluxo de Caixa | Tabelas chave/valor com scroll lateral até 390 px (valores sem quebra ao lado do rótulo) | `.ptable.kv` em ecrã estreito: linha flex com quebra, o valor desce para baixo do rótulo |
| QA-019 | Gestão › Gastos | Atalhos «Hoje/7/30/90 dias» sem quebra: scroll lateral a 240 e 320 px | `flex-wrap` |
| QA-020 | Caixa (4K/8K) | Com o zoom de ecrã grande (`bigScreen.ts`), a altura da Caixa não estava dividida por `--uz`: a interface ficava cortada a ~57% e o TOTAL/FINALIZAR fora do ecrã | `calc(100dvh / var(--uz, 1))` (com reserva em `vh`), como no resto do projeto |
| QA-021 | Caixa (240×320 e ecrãs baixos) | FINALIZAR fora do ecrã | `@media (max-height: 420px)`: o carrinho cede a altura mínima e o navegador de vendas sai |

## Resultados
| Teste | Antes | Depois |
|---|---|---|
| Gestão, Chromium, 30 × 9 | 265/270 | Gastos e Fluxo de Caixa: 0 falhas (16/16 nas secções corrigidas) |
| Gestão, WebKit atual, 30 × 3 | — | 89/90 → a falha (Encomendas 768) era transitória (troca tabela→cartões em JS); 9/9 em 3 repetições |
| Caixa + Loja, Chromium atual | 30/33 (FINALIZAR fora do ecrã a 240×320 e 4K) | **40/40** |
| Caixa + Loja, WebKit atual | — | **40/40** |
| Caixa + Loja, motores antigos reais (Chromium 93, WebKit 14.2) | — | **por repetir**: os motores foram apagados pela limpeza de temporários do Windows antes desta volta |

## Não verificado / limites
- **Firefox**: o Windows desta máquina recusa executar o `firefox.exe` do Playwright (não assinado → «Permission denied», provável política de segurança do sistema). Não foi contornado. Alternativa: Firefox oficial assinado + condução por WebDriver BiDi (exige download e autorização).
- Dispositivos físicos.
