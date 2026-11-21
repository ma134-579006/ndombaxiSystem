# Rejeições e correcções

## No LPS (empresa → Fiscal · SAF-T → Motor fiscal)

- Lista de documentos com filtros: Todos, Pendentes AGT, Correcção, Erros,
  Desconhecidos. Cada documento mostra o número fiscal, a referência interna, a data,
  o estado, o motivo (`last_error`), a divergência de totais e o botão «PDF original».
- **Recusa pelo Vendus** (422/400 no `POST /documents/`): `CORRECCAO_NECESSARIA` com a
  mensagem devolvida (`errors_full: "yes"`). O administrador corrige a configuração ou
  os dados e usa **Reenviar**. O reenvio passa sempre pela reconciliação
  (`external_reference`) antes de qualquer novo `POST`.
- **Rejeição pela AGT:** não chega ao LPS pela API ([AGT-STATUS.md](AGT-STATUS.md)).
  Consulta-se no Backoffice Vendus, onde há a opção «Criar documento de correção». Esse
  documento é criado no Vendus e não pelo LPS. Quando a Cegid disponibilizar a leitura
  pela API, a lista passa a mostrá-la.

## Regras

- Uma venda com documento rejeitado ou por emitir **não é apagada nem alterada**
  (tabela `invoices` imutável, regras e triggers fiscais).
- Anular uma venda cujo documento Vendus ainda não existe é **recusado**: nunca há uma
  NC local para um documento que o Vendus não emitiu.
- As NC referenciam o documento e a linha de origem (`reference_document`).
- A correcção AGT (`agt_corrected_invoice_id`, campo da especificação) **não está
  ligada**: falta a semântica oficial e a leitura das rejeições.
