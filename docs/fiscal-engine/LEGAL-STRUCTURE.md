# Enquadramento legal e papéis

> Não é parecer jurídico. Distingue o que foi **verificado** numa fonte do que fica
> **por confirmar**. Nenhuma isenção de certificação do LPS foi assumida.

## Fonte verificada: DP 71/25, artigo 22.º (4.º parágrafo)

Fonte: https://lex.ao/docs/presidente-da-republica/2025/decreto-presidencial-n-o-71-25-de-20-de-marco/
(consultada a 21-11-2026; o lex.ao não numera os parágrafos, o "n.º 4" vem da ordem).

> «As funcionalidades do sistema de facturação via electrónica, inclusive, emissão e
> recepção, podem ser asseguradas, no todo ou em parte, por terceiros, em nome e por
> conta do contribuinte, sendo, nestes casos, o contribuinte transmitente dos bens ou
> prestador dos serviços responsável pelo cumprimento das normas legais aplicáveis.»

O mesmo artigo diz também que os produtores de software devem informar a AGT, por via
electrónica, a quem venderam o software e quais estão activos.

O PDF oficial do Diário da República é uma imagem digitalizada e não foi possível
transcrevê-lo: https://www.ucm.minfin.gov.ao/cs/groups/public/documents/document/aw40/otu2/~edisp/minfin4956210.pdf

## Papéis

| Interveniente | Papel | Responsabilidade |
|---|---|---|
| **Contribuinte** (empresa cliente do LPS) | Verdadeiro emitente | Responde pelo cumprimento (art. 22.º). A conta Vendus e a API KEY são dele |
| **Cegid Vendus** (produtor: ver [FISCAL-CERTIFICATION](FISCAL-CERTIFICATION.md)) | Motor fiscal externo validado | Séries, assinatura, numeração, hash, QR, comunicação à AGT, SAF-T dos documentos que emite |
| **LPS Vendas** | ERP e interface de gestão | Venda, stock, caixa, clientes, produtos; envia a venda ao Vendus; guarda o PDF original e o estado |
| **AGT** | Autoridade | Valida e fiscaliza |

## Dúvidas que ficam em aberto (pedir esclarecimento)

1. **O LPS, como ERP complementar que recebe, processa e guarda dados fiscais, tem de
   se registar na AGT ou declarar-se como software?** Não encontrei norma que o
   dispense nem que o obrigue. Proposta de pedido formal à AGT em
   [FUTURE-LPS-CERTIFICATION.md](FUTURE-LPS-CERTIFICATION.md#pedido-de-esclarecimento-à-agt).
2. **Numeração dos artigos citados na missão.** A missão atribui ao art. 17.º a
   "utilização de software validado" e ao art. 24.º a "identificação dos
   estabelecimentos, softwares e séries". A auditoria anterior
   (`docs/compliance/MATRIZ-REQUISITOS-AGT.md`) leu o art. 17.º como o bloqueio após 60
   dias sem comunicação e o art. 24.º como os prazos do SAF-T de Inventário e
   Contabilidade. Até haver uma transcrição fiável do Diário da República, os dois
   mapeamentos ficam **POR CONFIRMAR**. O código não depende dessa numeração.
3. **Contrato com a Cegid.** O uso da API pelo LPS em nome de várias empresas, a menção
   «Gerido através do LPS Vendas» e o uso de logótipos precisam de autorização da
   Cegid. Sem ela, o LPS usa só o nome comercial em texto e não altera o documento.
4. **Titular do registo.** A listagem da AGT indica **PRIMAVERA - BUSINESS SOFTWARE
   SOLUTIONS, LDA** como produtora do Vendus. Os termos do site vendus.co.ao falam em
   «Nexperience Lda». Para a landing conta a listagem oficial da AGT.

## O que o LPS não pode fazer (cumprido no código)

- Alterar série, número, NIF do emitente, hash, QR ou identificadores do documento Vendus.
- Gerar um talão próprio com aparência de factura para uma venda emitida pelo Vendus
  (a Caixa mostra só os dados e abre o **PDF original**).
- Apresentar-se como certificado ou usar o nº de validação do Vendus como seu.
- Emitir pelo motor próprio quando o Vendus falha.
