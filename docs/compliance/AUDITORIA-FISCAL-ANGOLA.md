# Auditoria fiscal — LPS Vendas (Angola)

Data: 21-11-2026 · Ramo: `fiscal/auditoria-agt` · Base: `main` em `db73bf3`.

> **O LPS Vendas NÃO está certificado, validado nem autorizado pela AGT.** Nenhum documento deste dossier afirma o contrário. Os testes de integração foram feitos contra um **simulador local** do contrato publicado (`qa/agt-fe-mock.mjs`), que não é a AGT. Uma resposta simulada não é uma aprovação.

Documentos deste dossier:
- [MATRIZ-REQUISITOS-AGT.md](MATRIZ-REQUISITOS-AGT.md): cada requisito com fonte, classificação, implementação e teste.
- [CHAVES-CRIPTOGRAFICAS.md](CHAVES-CRIPTOGRAFICAS.md)
- [INTEGRACAO-FACTURACAO-ELETRONICA.md](INTEGRACAO-FACTURACAO-ELETRONICA.md): inclui séries e contingência.
- [SAF-T.md](SAF-T.md): Facturação, Contabilidade e Inventário.
- [SEGURANCA-FISCAL.md](SEGURANCA-FISCAL.md)
- [PLANO-E-RESULTADOS-TESTES.md](PLANO-E-RESULTADOS-TESTES.md)
- [BLOQUEIOS-AGT.md](BLOQUEIOS-AGT.md)
- [GUIA-PREPARACAO-CERTIFICACAO.md](GUIA-PREPARACAO-CERTIFICACAO.md)

## A. Diagnóstico inicial (antes das alterações)

O projecto já tinha uma base fiscal séria:
- assinatura Modelo 8 (RSA, encadeada, campo Hash do SAF-T);
- cliente da Facturação Electrónica (JWS RS256, registarFactura, solicitarSerie, obterEstado, consultarFactura, QR);
- numeração com bloqueio da série (`FOR UPDATE`);
- regras na BD contra DELETE/UPDATE de campos fiscais;
- SAF-T de facturação em streaming.

A auditoria encontrou falhas críticas e altas:

| # | Gravidade | Falha encontrada |
|---|---|---|
| C1 | Crítica | A replicação dos postos inseria `invoices`/`invoice_items` sem validação. Um caixa podia forjar número, data, totais e estado, ou acrescentar linhas a uma factura já emitida. |
| C2 | Crítica | Postos locais: datas pelo relógio da máquina; a data da factura chegava à nuvem com **um dia a menos** (DATE → Date local → JSON UTC). |
| A1 | Alta | `offline:true` vindo do cliente desligava controlos (turno, desconto, stock, série AGT estrita). |
| A2 | Alta | O cliente podia escolher a série de um posto (L…) ou a WEB: dois escritores na mesma cadeia de hash. |
| A3 | Alta | Eliminar uma empresa fazia `DROP SCHEMA … CASCADE`: todos os documentos fiscais desapareciam. |
| A4 | Alta | A imutabilidade dependia só de regras: era possível repor uma factura anulada (A→N), usar estados inventados e fazer TRUNCATE; a auditoria podia ser apagada. |
| A5 | Alta | A 2.ª via, a FE e o SAF-T usavam o nome **atual** da ficha do cliente; editar a ficha mudava documentos emitidos. |
| A6 | Alta | Sem chave Modelo 8 a emissão continuava sem assinatura e a cadeia recomeçava em silêncio. |
| M1–M8 | Média | UNIQUE só em texto; viragem do ano (FT 2026 com data 2027); data da operação offline sem validação (1900/2099); duplicados FE após resposta perdida marcados INVALID; NIF do cliente sem validação; emitente com NIF provisório; rotação de chave e configuração AGT sem auditoria; SAF-T com o NIF da empresa no lugar do NIF do produtor. |
| FE | Média | A recolha para a FE **perdia a 1.ª factura emitida no segundo da activação**: encontrado pela simulação. |
| DOC | — | A validação "contra o XSD oficial" estava afirmada em comentários, mas não havia XSD no repositório nem teste que o validasse. |

## B. Matriz de conformidade

| Área | Estado inicial | Alteração realizada | Estado final | Evidência |
|---|---|---|---|---|
| Produtor | Sem identificação do produtor | Campos `producerTaxId`/`producerName` no Super Admin; SAF-T usa-os; relatório avisa se faltarem | IMPLEMENTADO, MAS INCOMPLETO: falta o NIF real e o registo no Portal do Parceiro | E-13, `saft-builder.ts` |
| Registo do software | Nº de validação configurável ("0") | — | BLOQUEADO POR DEPENDÊNCIA EXTERNA: o nº é atribuído pela AGT | R-REG-01/02 |
| Chaves RSA | Modelo 8 (1024) + software FE (≥ 2048) + contribuinte | Emissão recusada em produção sem chave; falha de decifra registada; rotação auditada e validada | COMPLETO E VALIDADO EM SIMULAÇÃO; a chave real do contribuinte é emitida pela AGT | A-1…A-9 |
| JWS | RS256, header fixo JWT | `typ` configurável (contradição oficial); ordem do solicitarSerie | IMPLEMENTADO; AGUARDA CONFIRMAÇÃO DA AGT (typ) | `fe.spec.ts`, simulador |
| API AGT | Implementada, nunca testada contra um servidor | Simulador do contrato + 30 cenários; E09; 60 dias; recolha sem perdas | VALIDADO EM SIMULAÇÃO; sem credenciais de homologação | `qa/agt-fe-simulacao.mjs` 30/30 |
| Séries | Pedido à AGT, numeração AGT | UNIQUE(tipo, série, ano, seq) | VALIDADO EM SIMULAÇÃO; contingência (C) sem fluxo | C-1…C-3, D-3, FI-13 |
| Facturação | FT/FR/NC/ND; RC fora | Viragem do ano, NIF, cliente da emissão, offline, série | IMPLEMENTADO, MAS INCOMPLETO: RC não comunicado nem no SAF-T | `qa/fiscal-emissao.mjs` 14/14 |
| SAF-T Facturação | Gerado, nunca validado | XSD + validação semântica + `GET /pos/saft/validate` + NIF do produtor | COMPLETO E VALIDADO (SalesInvoices); Payments em falta | 35 testes XSD/semântica, E-11/E-12 |
| SAF-T Contabilidade | Inexistente | Nada: o sistema não tem contabilidade | NÃO IMPLEMENTADO | SAF-T.md |
| SAF-T Inventário | Inexistente (há stock) | Nada: o formato não foi encontrado | BLOQUEADO POR DEPENDÊNCIA EXTERNA | SAF-T.md |
| Contingência | Fila offline da Caixa; posto local em série L | Validação da data da operação; offline exige clientOpId | NÃO IMPLEMENTADO segundo o art. 18.º (sem menção nem séries C) | REGIME em INTEGRACAO… |
| Segurança | Regras na BD; replicação aberta | Gatilhos; replicação validada; conservação; auditoria | COMPLETO E VALIDADO para os cenários testados | FI-1…FI-14, E-9/E-10 |
| Auditoria | Trilho com hash; alterável | Só acréscimo (gatilho); AGT_* no trilho da plataforma | COMPLETO E VALIDADO | FI-10…FI-12 |

## C. Alterações executadas

Commits no ramo `fiscal/auditoria-agt`:
1. `a330b2a`: replicação validada (`apps/api/src/replication/fiscal-replication.guard.ts` + testes); data DATE do posto (`apps/local-server/src/sql-runner.ts`).
2. `1a822f3`: XSD do SAF-T (`packages/agt-xml/xsd/SAFTAO1.01_01.xsd`), `xsd-validate.ts`, `saft-semantic.ts`, `GET /pos/saft/validate`, NIF do produtor (`schema.prisma` AgtFiscalConfig.producerTaxId/producerName).
3. `a7ead18`: gatilhos fiscais (`apps/api/src/tenancy/fiscal-guards.ts`), bloqueio da eliminação de empresas com documentos, `qa/fiscal-imutabilidade.mjs`.
4. `bef9b50`: viragem do ano, série forjada, offline sem chave, assinatura obrigatória em produção, auditoria AGT, `safeOperationDate`.
5. `0d4635f`: art. 17.º (60 dias), E09, typ JWS, simulador (`qa/agt-fe-mock.mjs`, `qa/agt-fe-simulacao.mjs`), recolha sem perdas.
6. `6db1407`: `invoices.customer_name` (migração + regra fiscal), NIF do cliente, emitente TMP, `qa/fiscal-emissao.mjs`.

Migrações:
- `tenant_migrations.sql`: `invoices.customer_name` + regra.
- `fiscal-guards.ts`, aplicado no arranque a todas as empresas: gatilhos + índice único.
- `schema.prisma`: duas colunas em `agt_fiscal_config`, aplicadas pelo `prisma db push` do deploy.

## D. Resultados dos testes

Ver [PLANO-E-RESULTADOS-TESTES.md](PLANO-E-RESULTADOS-TESTES.md). Resumo:

| Bateria | Resultado |
|---|---|
| API (jest) | 329/329 |
| `@nexus/agt-xml` (jest) | 76/76 (inclui XSD e semântica) |
| Simulação FE | 30/30 |
| Imutabilidade (SQL directo) | 14/14 |
| Emissão | 14/14 |
| Regressões: auditoria | 99/99 |
| Regressões: assistente | 12/12 |

## E. Problemas ainda existentes

Ver [BLOQUEIOS-AGT.md](BLOQUEIOS-AGT.md):
- **Recibos:** os RC não são comunicados à FE, não têm assinatura e não entram no SAF-T (Payments).
- **Contingência:** sem regime do art. 18.º (menção, séries C, aviso à AGT). O posto local emite em série L, que não é comunicável com a FE activa.
- **Assinatura do posto local:** a assinatura das facturas do posto não é verificável na nuvem (C2, parte da chave).
- **Contabilidade:** não existe SAF-T de Contabilidade, porque não há contabilidade no sistema.
- **Inventário:** formato e serviços não publicados.
- **Comunicação bimestral** (art. 17.º): não implementada.
- **Prazo do 5.º dia útil** (art. 8.º): sem alerta para vendas offline sincronizadas tarde.
- **Operações ≥ 25 M Kz** (art. 38.º): sem alerta.
- **Chave de cifra:** uma única `CONFIG_ENCRYPTION_KEY` para todos os segredos. Recomenda-se KMS ou chave por inquilino.

## F. Dependências da AGT

| O quê | Para quê |
|---|---|
| Credenciais Basic | Pedir a produtores.dfe.dcrr.agt@minfin.gov.ao. |
| Registo do produtor | Quiosque AGT → "Torne-se parceiro". |
| Registo do software e da chave pública | Portal do Parceiro HML e PROD. |
| Nº de validação (softwareValidationNumber) | Atribuído no registo do software. |
| Chave do contribuinte de cada empresa | Emitida no Portal do Contribuinte. |
| Testes em homologação | Confirmar o `typ` do JWS, os campos assinados, o operationType e a resposta do obterEstado. |
| Especificações em falta | anularFactura, estenderSerie, inventário, serviços estrangeiros, comunicação bimestral. |
| Decisão oficial de certificação/validação | Só ela pode alterar o estado "não certificado". |

## G. Estado de preparação

**VALIDADO EM SIMULAÇÃO** para Facturação Electrónica (FT, FR, NC), séries, assinaturas, SAF-T de Facturação (SalesInvoices) e segurança/integridade.

**PREPARAÇÃO INCOMPLETA** no conjunto: recibos, contingência do art. 18.º, SAF-T de Contabilidade e de Inventário, e comunicação bimestral.

Nada foi ainda **TESTADO EM AMBIENTE OFICIAL DE TESTES**: faltam as credenciais.

Estas classificações não equivalem a certificação legal.

## H. Próximas acções

Ver [GUIA-PREPARACAO-CERTIFICACAO.md](GUIA-PREPARACAO-CERTIFICACAO.md).
