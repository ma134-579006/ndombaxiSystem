# Matriz de requisitos AGT — LPS Vendas

Consulta das fontes: **21-11-2026**. Classificação: **VERIFIED** (lido em fonte oficial e com evidência técnica), **UNVERIFIED** (fonte oficial não lida ou só secundária), **ASSUMED** (hipótese provisória), **REJECTED** (interpretação errada ou desactualizada).

## Fontes

| Sigla | Documento | Onde |
|---|---|---|
| DP71 | Decreto Presidencial n.º 71/25, de 20 de Março (Regime Jurídico das Facturas), DR I Série n.º 52 | lex.ao (transcrição do DR) |
| DE683 | Decreto Executivo n.º 683/25, de 22 de Agosto (estrutura de dados, modelo de FE, especificações), DR I Série n.º 159, págs. 19164–19227 | ucm.minfin.gov.ao (PDF digitalizado; lidas págs. 1–4) |
| DP312 | Decreto Presidencial n.º 312/18 (SAF-T e validação de sistemas) — só os n.os 1 e 5 do art. 2.º foram derrogados pelo DP71 | lex.ao |
| DOC2 | Documentação técnica da Facturação Electrónica, versão 2 | https://portaldoparceiro.minfin.gov.ao/doc-agt/doc-agt/2/index.html |
| DS120 | DS-120 Especificação Técnica FE v1.0.1 (01-10-2025, act. 06-11-2025) | Portal do Parceiro, `portal/assets/docs/` |
| PEF | Guia "Passo a Passo PEF – Facturação Electrónica – Portal do Parceiro" | Portal do Parceiro |
| XSD | SAFTAO1.01_01.xsd, namespace `urn:OECD:StandardAuditFile-Tax:AO_1.01_01` | cópia assoft-portugal ("Official XSD from the Government of Angola"); URL oficial da AGT **não encontrado** |
| DE74P | Proposta do Decreto Executivo 74/19 (regras de validação) | ucm.minfin.gov.ao — é a PROPOSTA, não o texto publicado |

## Requisitos

| ID | Requisito | Fonte (secção) | Classif. | Componente | Implementação | Teste |
|---|---|---|---|---|---|---|
| R-LEG-01 | DP 292/18 revogado; regime das facturas = DP 71/25 | DP71 art. 40.º | VERIFIED | — | Documentação | — |
| R-LEG-02 | Obrigatoriedade faseada: 12 meses só grandes contribuintes e fornecedores do Estado; depois todos os sujeitos | DP71 art. 37.º | VERIFIED (texto); prorrogações não procuradas | — | Documentação | — |
| R-LEG-03 | DE 683/25 em vigor 30 dias após a publicação (~21-09-2025) | DE683 art. 6.º | VERIFIED | — | — | — |
| R-COM-01 | Transmissão em tempo real à AGT | DP71 art. 17.º | VERIFIED | `einvoice.service.ts` | Fila + agendador de 60 s + envio manual | `qa/agt-fe-simulacao.mjs` B-1…B-6 |
| R-COM-02 | Falha de comunicação > 60 dias bloqueia a emissão | DP71 art. 17.º | VERIFIED | `EinvoiceService.assertCommunicationWithin60Days` | Implementado (tempo exacto) | I-1, I-2, I-3 |
| R-COM-03 | Comunicação bimestral da actividade/valor global das vendas pelo produtor | DP71 art. 17.º | VERIFIED (texto) | — | **NÃO IMPLEMENTADO**: serviço/formato não publicados | — |
| R-EMI-01 | Factura emitida até ao 5.º dia útil após a operação | DP71 art. 8.º | VERIFIED | POS / sync offline | Vendas offline entram com a data do sync e com a data da operação gravada | Parcial (sem alerta ao 5.º dia útil) |
| R-EMI-02 | Hash obrigatório na factura | DP71 art. 10.º n.º1 j) | VERIFIED | `signature.ts`, `invoice.service.ts` | Assinatura Modelo 8 | `qa/agt.mjs` S-1…S-4, `signature.spec.ts` |
| R-EMI-03 | Documento emitido não se altera nem se apaga; correcção por NC/anulação | DP71 (emissão, rectificação, anulação) | VERIFIED | BD (regras + gatilhos), serviço | Gatilhos `fiscal-guards.ts` | `qa/fiscal-imutabilidade.mjs` (14) |
| R-EMI-04 | Operações ≥ 25 000 000 Kz exigem FE ou emissão no Portal | DP71 art. 38.º | VERIFIED | — | **NÃO IMPLEMENTADO** (sem alerta) | — |
| R-FE-01 | Endpoints HML `sifphml…/sigt/fe/v1/<serviço>`, PROD `sifp…/sigt/fe/v1/<serviço>`, todos POST | DOC2 especificados | VERIFIED | `fe.ts FE_BASE_URL` | Implementado | — |
| R-FE-02 | Autenticação Basic; credenciais pedidas a produtores.dfe.dcrr.agt@minfin.gov.ao | DOC2 api.html | VERIFIED | `EinvoiceService.call` | Implementado; palavra-passe cifrada | A-4, B-1 |
| R-FE-03 | JWS RS256 compacto, base64url sem padding, RSA ≥ 2048 | DOC2 estrutura.html | VERIFIED | `jws.ts` | Implementado | `fe.spec.ts`, A-1, A-9 |
| R-FE-04 | Header JWS `typ` | DOC2 (texto JWT, exemplos JOSE) | **CONTRADITÓRIO** | `jws.ts` | Configurável (JWT por omissão) | — (a confirmar em homologação) |
| R-FE-05 | jwsSoftwareSignature = {productId, productVersion, softwareValidationNumber} | DOC2 | VERIFIED (com inconsistência: a página do solicitarSerie diz "todos os campos do softwareInfo") | `fe.ts envelope` | Implementado | Simulador verifica (E08/E39) |
| R-FE-06 | jwsDocumentSignature = documentNo, NIF, tipo, data, customerTaxID, customerCountry, companyName, documentTotals | DOC2 (o exemplo omite documentTotals) | VERIFIED com inconsistência | `fe.ts mapDocumentBody` | Implementado (tabela) | Simulador verifica (E40/E39) |
| R-FE-07 | jwsSignature por serviço (campos listados) | DOC2 | VERIFIED | `fe.ts build*` | Implementado; ordem do solicitarSerie alinhada | Simulador verifica |
| R-FE-08 | Máx. 30 documentos por registarFactura; processamento assíncrono (requestID → obterEstado) | DOC2 | VERIFIED | `EinvoiceService.submit/poll` | Implementado | B-3, B-4 |
| R-FE-09 | resultCode 0/1/2/7/8/9; documentStatus V/I | DOC2 obterEstado | VERIFIED | `poll` | Implementado | B-3, B-6 |
| R-FE-10 | E09 = documento já existe (successRequestID) | DOC2 | VERIFIED | `poll`, `reconcileDuplicate` | Implementado | H-1, H-2, H-3 |
| R-FE-11 | E98/HTTP 429 demasiadas solicitações | DOC2 | VERIFIED | `submit` (reenvio) | Implementado | B-2 |
| R-FE-12 | validationStatus "P" = enviado com > 24 h de atraso sem contingência aprovada | DOC2 consultarFactura | VERIFIED | `poll`/`reconcileDuplicate` | Tratado como aceite, sem distinção visível | — |
| R-FE-13 | Serviços anularFactura, estenderSerie, comunicarInventario, submeterInventario, comunicarServicosEstrangeiro | DOC2 especificados | VERIFIED (existência); **campos não publicados** | — | **BLOQUEADO** (especificação) | — |
| R-SER-01 | Séries geradas pela AGT | DE683 art. 4.º; DOC2 solicitarSerie | VERIFIED | `requestSeries` | Implementado; código nunca inventado | C-1, C-2 |
| R-SER-02 | Pedido: seriesYear (até 15/12 só o ano corrente), documentType, establishmentNumber ("SEDE" em testes), seriesContingencyIndicator N/C | DOC2 | VERIFIED | `buildSolicitarSerie` | Implementado (indicador C suportado na biblioteca, sem fluxo de contingência) | C-2 |
| R-SER-03 | Numeração sem saltos nem reutilização | DP71/DOC2 (documentNo sem zeros) | VERIFIED | `invoice.service.ts` (FOR UPDATE), UNIQUE(tipo, série, ano, seq) | Implementado | D-3, FI-13 |
| R-DOC-01 | Tipos FE: FA, FT, FR, FG, GF, AC, AR, TV, RC, RG, RE, ND, NC, AF, RP, RA, CS, LD; **FS não existe** | DOC2; XSD | VERIFIED | `document-types.ts` | FS interno exporta-se como FR; enviados FT, FR, NC, ND | D-2 |
| R-DOC-02 | RC/GR/ORC não enviados à FE | DOC2 | VERIFIED (RC existe na FE) | — | **NÃO IMPLEMENTADO**: recibos (RC) não são comunicados nem entram no SAF-T | — |
| R-QR-01 | QR: Model 2 v4, M, UTF-8, URL quiosqueagt…/consultar-fe?emissor=NIF&document=Nº (espaços → %20), PNG 350×350 | DOC2 qrcode.html | VERIFIED | `buildFeQrUrl` | Implementado (URL) | `fe.spec.ts` |
| R-CTG-01 | Contingência: emissão offline com menção «emitido em contingência, pendente de autorização», comunicação posterior, aviso imediato à AGT; blocos tipográficos até 45 dias com autorização | DP71 art. 18.º | VERIFIED | — | **NÃO IMPLEMENTADO** (ver REGIME-CONTINGENCIA) | — |
| R-KEY-01 | Chave do software: par RSA gerado pelo produtor, pública (PEM) registada no Portal do Parceiro; várias activas por signatureVersion | DOC2 gestao.html | VERIFIED | `provisionSoftwareKey` | Implementado; privada cifrada | A-1…A-4 |
| R-KEY-02 | Chave do contribuinte emitida pela AGT (Portal do Contribuinte) | DOC2 gestao.html | VERIFIED | `saveCompany` | Implementado (cifrada, ≥ 2048) | A-7, A-8 |
| R-KEY-03 | Assinatura Modelo 8 (texto `InvoiceDate;SystemEntryDate;InvoiceNo;GrossTotal;Hash anterior`, pública em PEM com a Declaração Modelo 8) | DE74P | VERIFIED **como proposta** | `signature.ts` | Implementado | `qa/agt.mjs` |
| R-KEY-04 | RSA-1024 + SHA-1 para o Hash do SAF-T | — | **ASSUMED** (não está no texto lido; o XSD limita Hash a 172 caracteres = RSA-1024 base64) | `signature.ts` | Implementado como estava | — |
| R-SAFT-01 | SAF-T (AO) 1.01_01 válido no XSD | XSD | VERIFIED (XSD de fonte secundária) | `saft-builder.ts`, `xsd-validate.ts` | Implementado + validado com libxml2 | `xsd.spec.ts`, `xsd-negative.spec.ts`, E-11 |
| R-SAFT-02 | ProductCompanyTaxID = NIF da entidade produtora | XSD (documentação do elemento) | VERIFIED | `saft-builder.ts` | **Corrigido** (era o NIF da empresa) | `saft-builder.spec.ts` |
| R-SAFT-03 | SAF-T de Facturação mensal, até ao último dia do mês seguinte | DP312 art. 3.º; comunicado AGT 04-03-2020 | VERIFIED | `GET /pos/saft` | Exportação mensal | — |
| R-SAFT-04 | SAF-T de Contabilidade do exercício anterior até 10 de Abril | DP71 art. 24.º n.º1 e) | VERIFIED | — | **NÃO IMPLEMENTADO** (não há contabilidade no sistema) | — |
| R-SAFT-05 | Inventário a 31/12 até 15 de Fevereiro | DP71 art. 24.º n.º1 d) | VERIFIED | — | **BLOQUEADO** (formato e serviços não publicados) | — |
| R-SAFT-06 | Payments (recibos) no SAF-T | XSD | VERIFIED (estrutura existe) | — | **NÃO IMPLEMENTADO** | — |
| R-REG-01 | Registo do produtor (Quiosque AGT → "Torne-se parceiro") e do software/versões no Portal do Parceiro | PEF | VERIFIED | Processo externo | Dados no Super Admin (produtor, nº de validação, versão) | — |
| R-REG-02 | softwareValidationNumber = nº de certificação do software (ex. "C_134") | DOC2 | VERIFIED | config FE + SAF-T | Configurável; "0" até a AGT atribuir | E-13 |
