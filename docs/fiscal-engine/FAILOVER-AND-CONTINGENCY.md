# Falhas, suspensão e contingência

## Regra principal

**Não há fallback automático de Vendus para o motor próprio.** Se o Vendus falhar,
expirar ou perder autorização, a emissão pelo Vendus é suspensa. O LPS não passa a
emitir sozinho.

## Comportamento por situação

| Situação | Resultado |
|---|---|
| Vendus lento / indisponível (5xx, timeout) | A venda fica **registada no LPS** (registo comercial VND). O documento fiscal fica na fila (`ESTADO_DESCONHECIDO` ou `ERRO_DE_COMUNICACAO`) e repete com reconciliação. Não é apresentado como factura aceite. A Caixa mostra «Documento fiscal pendente» |
| Chave revogada, subscrição inactiva, conta trocada | Motor efectivo `SUSPENSO`. **Novas vendas recusadas (503)** até novo teste com sucesso (V-18) |
| Validação do fornecedor expirada | `SUSPENSO`. O switch não contorna o bloqueio; só nova evidência repõe (V-19) |
| Suspensão manual pelo Super Admin | `SUSPENSO` com o motivo (V-20a) |
| Pedido de mudança para o motor próprio sem validação | Recusado (V-20b) |

No modo suspenso não se atribuem números fiscais fictícios, não se criam séries locais
de substituição e não se emitem documentos fiscais pelo motor próprio.

## Contingência legal (DP 71/25, art. 18.º)

O regime de contingência (séries C, emissão sem comunicação e envio posterior) **não
está activado para o motor externo**. Num cenário de contingência quem tem séries de
contingência e as comunica é o **Vendus**, não o LPS. O LPS não usa a contingência
como autorização para emitir facturas locais. O estado da contingência do motor próprio
está em `docs/compliance/BLOQUEIOS-AGT.md`.

## Vendas offline da Caixa

Uma venda feita sem rede sobe pela fila offline (`offline: true` com `clientOpId`).
- Motor `VENDUS`: é registada e vai para a fila do Vendus como qualquer outra.
- Motor `SUSPENSO`: a API responde 503 e a venda fica na fila do aparelho até o motor
  voltar. Não é numerada localmente.
O comprovativo provisório da Caixa continua a dizer que não é factura.
