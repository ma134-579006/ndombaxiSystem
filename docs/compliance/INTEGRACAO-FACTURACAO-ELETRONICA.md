# Facturação Electrónica — integração, séries e contingência

Fonte técnica: documentação v2 do Portal do Parceiro (consultada a 21-11-2026) e DS-120 v1.0.1. Código:
- `packages/agt-xml/src/einvoice/` (funções puras: montar e assinar);
- `apps/api/src/einvoice/einvoice.service.ts` (envio, fila, estados).

## Ambientes e autenticação

| Ambiente | Base |
|---|---|
| Homologação | `https://sifphml.minfin.gov.ao/sigt/fe/v1/<serviço>` |
| Produção | `https://sifp.minfin.gov.ao/sigt/fe/v1/<serviço>` |

- Todos os serviços são `POST`, com JSON e HTTP Basic. O timeout do cliente é de 30 s.
- `AGT_FE_BASE_URL` redirecciona para um simulador **apenas fora de produção** (`NODE_ENV≠production`).

## Fluxo

1. **Séries.** `solicitarSerie` atribui o código da série; o sistema nunca o inventa. É guardado por (ambiente, tipo, ano).
2. **Emissão.** A emissão numera na série AGT: `"<TIPO> <SÉRIE>/<n>"` (FT, FR, NC, ND).
3. **Recolha.** `collect`: todo o documento numa série AGT entra na fila `einvoice_documents` (QUEUED).
4. **Envio.** `submit`:
   - reserva atómica (`SENDING`, `FOR UPDATE SKIP LOCKED`);
   - validação local (E02/E13/E18/E22–E24);
   - `registarFactura` (≤ 30 documentos), que devolve um `requestID`;
   - a submissão fica registada (`submissionUuid`, `requestId`).
5. **Resultado.** `poll` chama `obterEstado`: resultCode 0/1/2 e V/I por documento; 7/8 tenta mais tarde; 9 volta à fila.

## Estados do documento

| Estado | Significado |
|---|---|
| QUEUED | Por enviar |
| SENDING | Reservado para envio. Se ficar parado mais de 10 min (reinício), é retomado. |
| SENT | Aceite estruturalmente, à espera do resultado |
| VALID | A AGT validou (V, ou P = enviado com atraso) |
| INVALID | Rejeição fiscal, com o código da AGT. Corrige-se e reenvia-se (`requeue`). |
| ERROR | Falha técnica (rede, 401, 429, 5xx, resposta malformada). Reenvio a cada 5 min, até 6 tentativas. Depois disso conta como "parado" no estado da empresa. |
| SKIPPED | Documento de um ambiente que mudou (HML ⇄ PROD) |

Um documento guardado localmente **nunca** é dado como aceite pela AGT sem a resposta V/P.

## Duplicados e idempotência

- **Na nossa fila:** a reserva com `SKIP LOCKED` impede que o mesmo documento vá em dois envios simultâneos.
- **Resposta perdida:** se a AGT registou mas respondeu com erro, o reenvio recebe **E09** ("documento já existe").
  - No `obterEstado`, o documento é dado como válido (successRequestID).
  - No `registarFactura`, é reconciliado por `consultarFactura` (V/P → VALID, I → INVALID; sem resposta → nova tentativa).
- Cada reenvio usa um novo `submissionUUID`. A documentação define-o como "único por submissão"; não diz se um reenvio deve repetir o anterior.

## Bloqueio do art. 17.º do DP 71/25

Se o documento mais antigo ainda não validado tiver **mais de 60 dias**, a emissão com a FE activa é recusada (HTTP 403). A mensagem indica há quantos dias está por comunicar.

O estado da empresa (`GET /fiscal/einvoice/status`, `communication`) mostra:
- o documento mais antigo pendente;
- os dias e o tempo exacto;
- os documentos parados.

## Séries

- O pedido leva `seriesYear`, `documentType`, `establishmentNumber` ("SEDE" em testes) e `seriesContingencyIndicator`. A assinatura é sobre {NIF, ano, tipo, estabelecimento, indicador}.
- Até 15 de Dezembro só se pode pedir o ano corrente. O sistema garante as séries do ano seguinte em Dezembro.
- Numeração:
  - sem saltos (`fiscal_series … FOR UPDATE` na mesma transacção da factura);
  - sem reutilização (`UNIQUE(number)` + `UNIQUE(doc_type, series, year, sequence)`);
  - persistente após reinício (está na BD).
- Mudança de ano a meio de uma emissão: recusada, e o posto repete.

## Contingência (DP 71/25, art. 18.º)

O que a lei exige:
- emissão offline no software quando falha a comunicação;
- menção «emitido em contingência, pendente de autorização»;
- aviso imediato à AGT;
- submissão posterior;
- em alternativa, blocos tipográficos autorizados, por um máximo de 45 dias.

A API prevê séries de contingência (indicador "C", período `seriesStartTS`/`seriesEndTS`).

**Estado no LPS Vendas: NÃO IMPLEMENTADO** segundo o art. 18.º. O que existe:
- **Fila offline da Caixa:** a venda fica guardada com um comprovativo provisório, sem número fiscal. O documento fiscal é emitido pela nuvem no sync, com a data do sync e a data real da operação gravada. Exige `clientOpId` (idempotência), e a data da operação é validada.
- **Posto local** (`apps/local-server`): emite em série própria (L…), assinada localmente. Com a FE activa, estes documentos **não estão numa série AGT** e não são comunicáveis. Precisa de séries de contingência ("C") pedidas à AGT e da menção legal.

Não se inventou um regime próprio. O que falta está em [BLOQUEIOS-AGT.md](BLOQUEIOS-AGT.md).

## Simulação

- `qa/agt-fe-mock.mjs` reproduz o contrato documentado e verifica Basic, JWS e campos assinados.
- `qa/agt-fe-simulacao.mjs` cobre 30 cenários: identidade, séries, emissão, 401/500/429/malformado, rejeição E20, resposta perdida → E09, reinício e art. 17.º.
