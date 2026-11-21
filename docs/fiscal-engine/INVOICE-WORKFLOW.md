# Fluxo de emissão pelo Cegid Vendus

1. O operador conclui a venda no POS (`POST /pos/invoices`).
2. `assertCanEmit` calcula o **motor efectivo** da empresa. Se for `SUSPENSO`: HTTP 503
   com o motivo, nada é gravado e o carrinho fica no POS.
3. Com `VENDUS`: `InvoiceService.emit` grava o **registo comercial** com stock, caixa,
   cliente e linhas, na série interna **VND** (`FT VND2026/0001`). Este registo não usa
   série AGT nem assinatura do LPS (`signature = NULL`), tem `fiscal_engine = 'VENDUS'`
   e fica fora do SAF-T e da FE do LPS.
4. `enqueueSale` cria **um** registo em `fiscal_engine_documents` com:
   - `tx_id = lps-<id da venda>-FT` (único e persistente),
   - `external_reference = LPS-<id da venda>` (único).
   Repetir a operação devolve o mesmo registo (`ON CONFLICT`).
5. `dispatch` reclama o registo de forma atómica (nunca dois envios em paralelo) e
   volta a confirmar o motor. Depois monta o corpo ([VENDUS-INTEGRATION](VENDUS-INTEGRATION.md#correspondência-de-dados)).
   Se houver erro de dados, o documento passa a `CORRECCAO_NECESSARIA` sem envio.
6. `POST /documents/` → `201` → `CRIADO_NO_VENDUS` (id, tipo, número, hash, totais).
7. `GET /documents/{id}/` (detalhe, `agt`, `qrcode_data`) e `GET /documents/{id}.pdf`
   (PDF original, com o SHA-256 guardado) → `COMUNICACAO_AGT_PENDENTE`.
8. A resposta ao POS leva `fiscal: {engine, state, number, pdf}`. A Caixa mostra o
   número do Vendus e os botões «Imprimir original» e «Abrir PDF». **Nunca** desenha
   um talão do LPS para esta venda.
9. Se o Vendus não responder a tempo, a venda continua registada e o documento fica na
   fila. O agendador (60 s) trata dele.

## Duplicação impossível

| Situação | Comportamento |
|---|---|
| Caixa reenvia a mesma venda (`clientOpId`) | Devolve a venda original; continua a haver um só documento (V-15a) |
| Pedido de reenvio de um documento já emitido | 409 (V-15b) |
| **Timeout ou resposta perdida** depois do envio | `ESTADO_DESCONHECIDO`. Antes de qualquer novo `POST` procura-se `GET /documents/?external_reference=`. Se existir é adoptado sem reenvio (V-16a a V-16d) |
| Não é possível confirmar se existe (erro na consulta) | Fica `ESTADO_DESCONHECIDO` e **não** se reenvia |
| 429 / 401 / 403 | `ERRO_DE_COMUNICACAO`, repete mais tarde (não foi processado) |

## Notas de crédito

- **Anulação** (`POST /pos/invoices/:id/cancel`) e **devolução**
  (`POST /pos/invoices/:id/return`) de uma venda emitida pelo Vendus:
  1. exigem o motor Vendus operacional e o documento de origem **já emitido**
     (senão 503/409, sem NC local; V-NC3);
  2. gravam a NC no LPS (série VND);
  3. emitem a NC no Vendus com `reference_document {document_number, document_row}` e o
     `id` da linha original. A devolução parcial leva só as linhas devolvidas
     (V-NC1, V-NC2).

## Mudança de motor

Cada documento fica para sempre associado ao software que o emitiu
(`invoices.fiscal_engine`). Séries de motores diferentes não se misturam: VND para o
Vendus e as séries LPS/AGT para o motor próprio.
