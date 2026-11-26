# F3 — Janelas sem botão X / cancelamento de venda em telemóvel (2026-11-26)

## Engenharia reversa
- **Opções da venda** (`PosPage.tsx`, `.vopts`): painel desenhado dentro da caixa do carrinho (`position: absolute; inset: 0`). Em telemóvel, a caixa do carrinho tem ~100 px de altura, por isso só se viam «Cliente» e «Nova Venda». **«Cancelar Venda» ficava cortado** e o painel não tinha título nem X: só fechava voltando a tocar em «Opções» (QA-008).
- `modalClose.ts` (X automático) só atua em `.modal-bg > .modal` com `onClick` no fundo. As janelas da Caixa usam `VWindow` (⊗ + Esc), `PaymentModal` (✕ + «✕ Fechar») e `CancelItemsModal` (✕ no cabeçalho, z-index 200 acima da `VWindow` de Documentos).
- Gestão: a `Modal` (`components/ui.tsx`) tem sempre `vf-x`; as outras 3 `.modal-bg` têm `onClick` no fundo (X automático). Nenhum CSS esconde o `vf-x`.

## Correção
- Ecrã pequeno (`max-width: 900px` ou `max-height: 600px`): as Opções abrem na janela da Caixa (`VWindow`, com ⊗ e Esc), com todas as opções visíveis. Ecrã largo: o painel no carrinho ganha título «Opções» e botão ⊗ (44×44).
- A confirmação de «Cancelar Venda» (segundo toque) mantém-se e fica visível.
- Compatível com Safari < 14 (`addListener` quando não há `addEventListener` no `MediaQueryList`).

## Testes executados
`qa/modais-x.mjs`: abre cada janela e verifica que há um fecho **visível, dentro do ecrã e sem nada por cima**, e que fechar funciona. Janelas: Opções, Opções › Cliente, Finalizar venda, Entrada/Saída, Ponto de Caixa, Autoconsumo, Faturação, Faturação › Cancelar artigos (anular venda; abre e fecha, nada é anulado). Perfis emulados: Android (Chromium 412×915), iPhone (WebKit 390×844), iPad (WebKit 820×1180), Desktop (Chromium 1366×768).

| Alvo | Resultado |
|---|---|
| main (5182) | **28/32** — «Opções da venda» sem fecho visível em Android, iPhone, iPad e Desktop |
| correção (5181) | **32/32 PASS** |

## Não verificado
- Dispositivo real (iPhone/Android físicos).
- Gestão: verificada só no código (todas as janelas com X), sem varredura em execução.
