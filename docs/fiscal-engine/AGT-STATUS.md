# Estado AGT dos documentos

## Estados internos

`RASCUNHO` · `A_PREPARAR` · `A_ENVIAR` · `CRIADO_NO_VENDUS` · `COMUNICACAO_AGT_PENDENTE` ·
`AGT_ACEITE` · `AGT_REJEITADO` · `ESTADO_DESCONHECIDO` · `ERRO_DE_COMUNICACAO` ·
`CORRECCAO_NECESSARIA`

Cada mudança fica em `fiscal_engine_events` (data, estado, detalhe).

## Bloqueio: a API não expõe o estado AGT

Na especificação 1.1 e 1.2, `GET /documents/{id}` devolve:

```
agt: { document_number: string, qrcode_image: string }   // "AGT Invoice Details"
```

Não existe campo de aceitação, rejeição ou motivo. Por isso, no código
(`agtStateFromDetails`):

- **`AGT_ACEITE` e `AGT_REJEITADO` nunca são preenchidos automaticamente.**
- HTTP 200/201, PDF, `hash`, `qrcode`, `qrcode_data` ou `agt.document_number`
  **não contam** como prova de aceitação (teste unitário dedicado).
- Um documento real emitido fica em **`COMUNICACAO_AGT_PENDENTE`**.
- Um documento em modo Formação/Testes fica em **`CRIADO_NO_VENDUS`**: não tem
  validade fiscal e não é comunicado à AGT.
- **Nenhum utilizador pode marcar a aceitação à mão**: não existe rota para isso.

A consulta oficial é no **Backoffice Vendus** (detalhe do documento, e Gestão → Factura
Electrónica → documentos rejeitados). Não se faz scraping.

**Pedido à Cegid:** uma operação suportada (campo ou endpoint) que devolva o estado AGT
e o motivo de rejeição. Quando existir, mapeia-se em `agtStateFromDetails` e passa a
ser automático.

## Outros campos (não se assume significado angolano)

| Campo | Tratamento |
|---|---|
| `atcud` | É um identificador português. Guardado no detalhe, não usado |
| `tax_authority_id` | A especificação liga-o a documentos de transporte. Guardado, não usado |
| `qrcode_data` | Guardado. O QR mostrado ao cliente é o do PDF original |
| `hash` | Guardado e mostrado, nunca alterado |
