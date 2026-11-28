# Caixa em telemóveis, tablets e PCs (2026-11-28)

Pedido do utilizador: «a Caixa ainda continua a quebrar em iPhone e outros dispositivos; deve ajustar-se ao tamanho do ecrã sem quebrar nada». Testar do iPhone 4S ao iPhone 18 Pro Max, do Android 4 ao Android 17, todos os navegadores, todos os tablets e também PCs.

## Como se testou
`qa/caixa-telemoveis.mjs` (Playwright, API de QA local; nada contra produção):
- **38 perfis móveis e tablets** (retrato e paisagem): iPhone 4S/5/SE1, 6–8, Plus, X–18 Pro Max, iPad mini/Air/Pro, Android 4.x a 17, Pixel, Galaxy, Tablets 7"/10".
- **19 perfis de PC**: de 1024×768 a 8K, incluindo portáteis 1366×768 e janelas pequenas.
- Agente do utilizador por geração (Safari iOS, Chrome Android, navegador Samsung, WebView).
- Motores: Chromium atual, WebKit atual, Chromium 93 (Android antigo) e WebKit 14.2 (Safari antigo).

Verificações em cada perfil:
| | Verificação |
|---|---|
| T1 | Sem scroll lateral (página e contentores) |
| T2 | Nada sai do ecrã nem fica cortado (login e venda com 15 artigos) |
| T3 | TOTAL e FINALIZAR inteiros no ecrã |
| T4 | Cada janela abre e cabe no ecrã: Opções, Finalizar, Entrada/Saída, Ponto de Caixa, Faturação |
| T5 | Campos de texto com letra ≥ 16 px (o iOS não faz zoom ao tocar) |

## Problemas encontrados e corrigidos
| Registo | Problema | Correção |
|---|---|---|
| QA-030 | Telemóvel ou tablet deitado (altura ≤ 640 px): a janela Finalizar tinha ~890 px de altura e saía do ecrã; EMITIR DOCUMENTO ficava fora de alcance. | Em ecrãs baixos a janela ocupa o ecrã todo e cada coluna rola por dentro (`vpos.css`). |
| QA-031 | Telemóvel: a grelha de artigos tinha mosaicos de largura fixa e sobrava ou cortava espaço. | `repeat(auto-fill, minmax(96px, 1fr))` e mosaicos de largura automática. |
| QA-032 | Nomes de artigos compridos (sem espaços) saíam do mosaico. | `overflow-wrap: anywhere`. |
| QA-033 | Navegadores antigos: o X das janelas ficava invisível (`color-mix` não suportado); a regra de ecrãs baixos só começava aos 420 px de altura. | Cor de reserva antes do `color-mix`; regra a partir de 500 px. |
| QA-034 | iPhone: campos com letra de 13–15 px (incluindo o PIN do login) faziam a página dar zoom ao tocar. | Ecrãs táteis: 16 px em todos os campos da Caixa e do login. |
| QA-035 | Tablets de 640–900 px: a tabela de vendas tinha scroll lateral. | A tabela passa a cartões até 900 px. |
| QA-036 | iOS 9–11 e o navegador antigo do Android 4 ficavam com o ecrã em branco (o código exige Safari 12 / Chrome 64). | `navegador-antigo.js` (ES5) mostra «Navegador desatualizado» com o que fazer. |

## Falsos alarmes (não são bugs)
- **WebKit 14.2 para Windows (WinCairo):** o `backdrop-filter` esconde o conteúdo das janelas. Acontece só nesta compilação de Windows, não no Safari do iOS.
- **Opções no iPad Pro (WebKit 14):** a medição apanhava a janela a meio da animação.
- **Coordenadas do login:** o zoom CSS (`useFitHeight`) aumenta o `getBoundingClientRect` no WebKit e no Chromium antigo; a página não sai do ecrã.
- **«Janela abre» falhava em paisagem:** o teste não conhecia o botão «✕ Fechar» da janela Finalizar (`.vfin-close`), por isso a janela ficava aberta por cima do menu. O botão existe e está visível; corrigido no teste.

## Resultado final (build com as correções)
| Grupo | Motor | Resultado |
|---|---|---|
| 38 telemóveis e tablets | Chromium atual | 996/999 → as 3 falhas repetidas isoladas: 81/81 (espera curta do teste, não da Caixa) |
| Telemóveis e tablets deitados | Chromium atual | 378/378 |
| 19 PCs (1024×768 a 8K) | Chromium/WebKit atuais | 378/380 → 8K repetido com espera pela animação: 20/20 |
| Telemóveis e tablets | Chromium 93 (Android antigo) | 405/405 |
| Telemóveis e tablets | WebKit 14.2 (Safari antigo) | 594/594 |

Falsos alarmes adicionais encontrados nesta ronda (corrigidos no teste, não na Caixa):
- **Opções em monitores 2560/4K/8K «fora do ecrã»:** o clique do Playwright deslocava a página por causa do zoom CSS. Para um utilizador a página não rola (altura = ecrã, ); clicado sem deslocar, o painel cabe nos três tamanhos.
- **T5 (16 px) em PCs:** o zoom ao focar um campo pequeno é só do iOS; o T5 passou a valer só para ecrãs táteis.
- **8K «janela não abriu»:** sem GPU a janela demorava até 3,5 s a abrir; o teste passou a esperar o fim da animação.

UNVERIFIED: aparelhos físicos (iPhone/Android reais). Os motores emulam o ecrã, o toque e o agente de cada aparelho, mas não o navegador exato de cada versão.
