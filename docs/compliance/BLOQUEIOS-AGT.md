# Bloqueios, contradições e trabalho em falta

## Depende da AGT (externo)

| # | Bloqueio | Quem resolve |
|---|---|---|
| X1 | Credenciais Basic de homologação e de produção | Produtor: e-mail a produtores.dfe.dcrr.agt@minfin.gov.ao, com nome e NIF |
| X2 | Registo do produtor (Quiosque AGT → Torne-se parceiro) e dos representantes | Produtor |
| X3 | Registo do software e de cada versão, com a chave pública, no Portal do Parceiro (HML e depois PROD) | Produtor |
| X4 | Nº de validação do software (`softwareValidationNumber`) | Atribuído pela AGT |
| X5 | Chave privada de cada contribuinte (Portal do Contribuinte) e estabelecimentos registados | Cada empresa cliente |
| X6 | Especificação de anularFactura, estenderSerie, comunicarInventario, submeterInventario, comunicarServicosEstrangeiro e da comunicação bimestral (art. 17.º) | AGT (não publicada) |
| X7 | URL oficial do XSD do SAF-T (AO) | AGT |
| X8 | Anexos II e III do DE 683/25 (págs. 53–66): não lidos, porque o PDF digitalizado não tem OCR aqui | Leitura manual |
| X9 | Prorrogações do faseamento do DP 71/25, art. 37.º: não procuradas | Consulta jurídica |

## Contradições na documentação oficial (registadas, não escondidas)

| # | Contradição | Decisão provisória |
|---|---|---|
| K1 | Header JWS: o texto diz `{"alg":"RS256","typ":"JWT"}`, os exemplos dizem `{"typ":"JOSE","alg":"RS256"}` | `typ` configurável no Super Admin; por omissão "JWT" (o texto normativo). Confirmar em homologação. |
| K2 | jwsDocumentSignature: a tabela inclui `documentTotals`, o JWS do exemplo não | Inclui (a tabela). Confirmar. |
| K3 | jwsSoftwareSignature: 3 campos (estrutura) vs. "todos os campos do softwareInfo" (solicitarSerie) | 3 campos. Confirmar. |
| K4 | DE 683/25, Anexo I: `submissionGUID` e schema "1.0"; doc v2: `submissionUUID` e "2.0" | Doc v2 (mais recente, art. 3.º do DE: a AGT publica actualizações). |
| K5 | consultarFactura: a tabela diz `documentNo`, o exemplo diz `invoiceNo` | `documentNo`. |
| K6 | Modelo 8: RSA-1024/SHA-1 não aparecem no texto lido (só na proposta do DE 74/19 e no limite de 172 caracteres do XSD) | Mantido o que estava (ASSUMED). |

## Trabalho técnico em falta (do nosso lado)

| # | Item | Prioridade |
|---|---|---|
| T1 | Recibos (RC): comunicação à FE, assinatura, Payments no SAF-T, imutabilidade e UNIQUE do número | Alta |
| T2 | Contingência do art. 18.º: séries "C", menção «emitido em contingência, pendente de autorização», aviso à AGT; série L dos postos locais com a FE activa | Alta |
| T3 | Assinatura verificável das facturas dos postos locais (chave registada ou re-certificação na nuvem) e janela de datas | Alta |
| T4 | Alerta do 5.º dia útil (art. 8.º) para vendas offline sincronizadas tarde | Média |
| T5 | Alerta para operações ≥ 25 000 000 Kz (art. 38.º) | Média |
| T6 | Role de BD sem ownership das tabelas fiscais; KMS ou chave por inquilino | Média |
| T7 | Excluir `private_key_enc` da descida da replicação | Baixa |
| T8 | SAF-T de Contabilidade (exige um módulo contabilístico) | Decisão de produto |
| T9 | Interface do Super Admin para o NIF e o nome do produtor (a API já aceita `producerTaxId`/`producerName` em `PATCH /super-admin/fiscal/agt`) | Média |
