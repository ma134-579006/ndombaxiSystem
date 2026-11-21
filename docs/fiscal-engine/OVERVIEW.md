# Motor fiscal do LPS Vendas — visão geral

> Estado em 21-11-2026. **O LPS Vendas não tem validação própria da AGT.** Este módulo
> permite usar o **Cegid Vendus** como motor fiscal externo. A integração foi testada
> **apenas contra um simulador local**: nenhuma conta Vendus real foi ligada e nenhum
> documento real foi emitido.

## Arquitectura

```
POS / Caixa (apps/pos)          Super Admin (apps/web)          Empresa (apps/web)
   │ venda                         │ switch, validade, ligação      │ estado, documentos, SAF-T
   ▼                               ▼                                ▼
POST /pos/invoices ──► FiscalEngineService.assertCanEmit ──► motor efectivo
   │                                    │
   │  LPS      → InvoiceService.emit (fluxo próprio, como até aqui)
   │  VENDUS   → InvoiceService.emit (registo comercial, série interna VND,
   │              sem série AGT nem assinatura do LPS)
   │              └► enqueueSale → fila fiscal_engine_documents (tx_id)
   │                    └► dispatch → POST /documents/ no Cegid Vendus
   │                          └► GET /documents/{id} + PDF original
   │  SUSPENSO → 503: nenhuma emissão, nenhum número, nenhuma série local
```

| Peça | Ficheiro |
|---|---|
| Regras puras (validade, indicadores, motor efectivo, estado AGT) | `apps/api/src/fiscal-engine/fiscal-engine.policy.ts` |
| Cliente da API Vendus (Bearer, prazos, classificação de erros) | `apps/api/src/fiscal-engine/vendus.client.ts` |
| Corpo de `POST /documents/` (FT/FR/NC) | `apps/api/src/fiscal-engine/vendus-payload.ts` |
| Serviço (configuração, fila, reconciliação, PDF, SAF-T, monitorização, landing) | `apps/api/src/fiscal-engine/fiscal-engine.service.ts` |
| Rotas Super Admin e empresa | `apps/api/src/fiscal-engine/fiscal-engine.controller.ts` |
| Ligação ao POS (emissão, anulação, devolução) | `apps/api/src/pos/pos.controller.ts`, `invoice.service.ts` |
| Super Admin → Fiscal → **Software de terceiros** | `apps/web/src/sections/FiscalEngineAdmin.tsx` |
| Empresa → Fiscal · SAF-T → cartão **Motor fiscal** | `apps/web/src/sections/FiscalEngineCompanyCard.tsx` |
| Caixa: documento original do Vendus | `apps/pos/src/components/ExternalFiscalReceipt.tsx` |
| Landing: identificação do software fiscal | `apps/web/src/pages/Landing.tsx` (`#facturacao-electronica`) |
| Simulador local do Vendus + cenários | `qa/vendus-mock.mjs`, `qa/vendus-motor.mjs` |

## Os três modos

| Modo | Quando | O que acontece |
|---|---|---|
| **A — Cegid Vendus** | Switch ligado, validade do fornecedor confirmada com evidência, ligação da empresa testada (mesmo NIF, Angola, caixa com subscrição), FE configurada no Vendus (confirmada), testes em modo Formação concluídos, activação explícita | O Vendus emite; o LPS guarda o registo comercial e o PDF original |
| **B — Motor próprio LPS** | Só com nº de validação próprio, versão, evidência, testes aprovados e confirmação do Super Admin | Fluxo fiscal próprio do LPS |
| **C — Suspenso** | Qualquer falta do modo activo (validade expirada, chave revogada, subscrição caída, switch desligado, suspensão manual) | Venda recusada (HTTP 503); nada é numerado |

**Não há passagem automática de Vendus para LPS.** Ver [FAILOVER-AND-CONTINGENCY.md](FAILOVER-AND-CONTINGENCY.md).

### Empresas que já usavam o motor próprio (decisão pendente do utilizador)

Antes deste módulo todas as empresas emitiam pelo motor próprio. Para não parar a
produção de um dia para o outro, essas empresas continuam em `LPS` marcadas como
**"Motor próprio sem validação AGT documentada"** (indicador visível no Super Admin).
O Super Admin decide, empresa a empresa, se passa para Vendus ou suspende. Voltar a
`LPS` a partir de outro modo exige a validação própria (Modo B).

## Classificação (não confundir)

| Classificação | Estado | Prova |
|---|---|---|
| MÓDULO IMPLEMENTADO | **Sim** | Código + 35 testes unitários + 56 cenários ponta a ponta |
| API CONECTADA | **Só ao simulador** | Nenhuma API KEY real foi inserida |
| CONTA VALIDADA | **Não** | Depende da API KEY da conta Vendus do contribuinte |
| CONFIGURAÇÃO FISCAL CONFIRMADA | **Não** | Gestão → Factura Electrónica no Vendus (utilizador) |
| EMISSÃO VIA VENDUS TESTADA | **Só no simulador** | `qa/vendus-motor.mjs` 56/56 |
| DOCUMENTO SUBMETIDO À AGT | **Não** | — |
| DOCUMENTO ACEITE PELA AGT | **Não** | A API Vendus não expõe o estado AGT ([AGT-STATUS.md](AGT-STATUS.md)) |
| VALIDADE DA CERTIFICAÇÃO CONFIRMADA | **Parcial** | Listagens AGT oficiais encontradas ([FISCAL-CERTIFICATION.md](FISCAL-CERTIFICATION.md)); falta o Super Admin registá-las com evidência |
| INTEGRAÇÃO PRONTA PARA PRODUÇÃO | **Não** | Faltam os passos externos ([VENDUS-INTEGRATION.md](VENDUS-INTEGRATION.md#o-que-falta-do-teu-lado)) |

## Índice

[LEGAL-STRUCTURE](LEGAL-STRUCTURE.md) · [VENDUS-INTEGRATION](VENDUS-INTEGRATION.md) ·
[API-CONFIGURATION](API-CONFIGURATION.md) · [ACCOUNT-ISOLATION](ACCOUNT-ISOLATION.md) ·
[FISCAL-CERTIFICATION](FISCAL-CERTIFICATION.md) · [VALIDITY-MONITORING](VALIDITY-MONITORING.md) ·
[INVOICE-WORKFLOW](INVOICE-WORKFLOW.md) · [AGT-STATUS](AGT-STATUS.md) ·
[REJECTION-HANDLING](REJECTION-HANDLING.md) · [SAF-T-AO](SAF-T-AO.md) · [SECURITY](SECURITY.md) ·
[FAILOVER-AND-CONTINGENCY](FAILOVER-AND-CONTINGENCY.md) · [TEST-RESULTS](TEST-RESULTS.md) ·
[LANDING-DISCLOSURE](LANDING-DISCLOSURE.md) · [FUTURE-LPS-CERTIFICATION](FUTURE-LPS-CERTIFICATION.md)
