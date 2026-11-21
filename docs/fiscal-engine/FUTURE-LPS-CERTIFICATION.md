# Validação própria do LPS (Modo B) e mudança de motor

## Activar o motor próprio

Super Admin → Software de terceiros → **Validação própria do LPS Vendas**:

1. Número de validação próprio e versão autorizada.
2. Evidência oficial (PDF/PNG/JPEG, com SHA-256).
3. «Registar testes aprovados».
4. «Confirmar validação». É recusado se faltar algum dos pontos acima, e qualquer
   alteração posterior apaga a confirmação.

Depois, por empresa, «Mudar para motor próprio» com a frase
`MUDAR PARA MOTOR PRÓPRIO` (auditado: `FISCAL_ENGINE_SWITCHED_TO_LPS`). A existência de
código de facturação próprio **não chega**.

## Antes da mudança

- Os documentos emitidos pelo Vendus ficam como estão (`invoices.fiscal_engine =
  'VENDUS'`, PDF original, `fiscal_engine_documents`). Não se renumeram.
- As séries não se misturam: VND (registos Vendus) e as séries do motor próprio.
- As NC de documentos Vendus continuam a ser emitidas pelo Vendus. Por isso o motor
  Vendus tem de estar operacional para anular uma venda antiga.
- Chaves do motor próprio: Modelo 8 (RSA) e JWS da FE. Ver
  `docs/compliance/CHAVES-CRIPTOGRAFICAS.md`.

## Pedido de esclarecimento à AGT

> Assunto: Enquadramento de ERP complementar que integra software de facturação certificado
>
> A [entidade titular do LPS Vendas], NIF […], disponibiliza a plataforma de gestão LPS
> Vendas a contribuintes angolanos. A emissão dos documentos fiscais é feita pelo
> software certificado Cegid Vendus (FE/105/AGT/2025; 142/AGT/2019), através da API do
> fornecedor, em nome e por conta de cada contribuinte (DP 71/25, art. 22.º). O LPS
> Vendas regista a operação comercial, envia os dados da venda ao Vendus e conserva o
> documento original devolvido.
>
> Solicitamos esclarecimento sobre:
> 1. Se o LPS Vendas, enquanto ERP que recebe, processa e conserva dados fiscais sem
>    emitir documentos, está sujeito a registo, validação ou comunicação próprios.
> 2. Que identificação do software deve constar nos documentos e na informação pública
>    (o LPS identifica apenas o Cegid Vendus como software emissor).
> 3. Se o arquivo da cópia do documento original no LPS satisfaz as regras de
>    conservação, ou se só vale o arquivo no software emissor.
> 4. Obrigações do LPS caso venha a requerer validação própria para emissão.

Enviar pelos canais oficiais da AGT (Portal do Parceiro / atendimento). Guardar a
resposta como evidência.
