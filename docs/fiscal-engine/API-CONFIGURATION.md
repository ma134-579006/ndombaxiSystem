# Configuração

## Global (Super Admin → Fiscal (AGT) → Software de terceiros)

Tabela `nexus_public.fiscal_engine_settings` (uma linha, `id = 'default'`).

| Campo | Regra |
|---|---|
| Switch «Usar motor fiscal externo — Cegid Vendus» (`vendusEnabled`) | Só liga com a validade do fornecedor **CONFIRMADA**. Desligar suspende todas as empresas em Vendus |
| API Base URL (`vendusBaseUrl`) | `https://www.vendus.co.ao/ws`. Só se aceitam endereços `*.vendus.co.ao/ws` |
| Versão da API (`vendusApiVersion`) | `1.0`, `1.1` (por omissão) ou `1.2` |
| Dados da validação do fornecedor | Ver [VALIDITY-MONITORING.md](VALIDITY-MONITORING.md) |
| Validação própria do LPS | Ver [FUTURE-LPS-CERTIFICATION.md](FUTURE-LPS-CERTIFICATION.md) |

`VENDUS_BASE_URL` e `VENDUS_TIMEOUT_MS` (variáveis de ambiente) só têm efeito **fora
de produção** e servem apenas para o simulador local. Em produção são ignoradas.

## Por empresa

Tabela `nexus_public.fiscal_engine_companies` (uma linha por empresa).

| Campo da missão | Onde |
|---|---|
| Fornecedor / País | Fixos: Cegid Vendus / Angola |
| API KEY | `apiKeyEnc` (AES-256-GCM), só a máscara `apiKeyMask` é devolvida |
| Identificador da conta, NIF, morada | `accountId`, `accountFiscalId`, `accountCountry`, `accountAddress`, lidos de `GET /account/` e nunca escritos à mão |
| Identificador da loja / caixa | `storeId`, `registerId` (+ `registerTitle`, `registerType`, `registerSubscription`, `registerExpires`) |
| Estado da Facturação Electrónica | `feConfirmedAt` / `feConfirmedBy`: confirmação do administrador, porque a API não expõe este estado |
| Número de validação / versão / validade | Globais (o fornecedor é o mesmo para todas as empresas) |
| Data de confirmação da configuração | `activatedAt` / `activatedBy` |
| Formas de pagamento | `paymentMap` `{CASH: "<id>", …}`, escolhido da lista da conta |
| Impostos | `taxMap`, calculado no teste de ligação (só Angola, mesma taxa) |
| Monitorização | `health` `{code, at, message}` |

## Tabelas por empresa (schema do tenant)

| Tabela | Conteúdo |
|---|---|
| `invoices.fiscal_engine` | `LPS` ou `VENDUS`: que software emitiu o documento (nunca muda) |
| `fiscal_engine_documents` | Um registo por operação fiscal: `tx_id` único, `external_reference` único, estado, pedido, resposta, detalhe, PDF original (`bytea` + SHA-256) |
| `fiscal_engine_events` | Histórico de estados de cada documento |
| `fiscal_engine_links` | Correspondência de IDs LPS ↔ Vendus (clientes, produtos), sem duplicados |
| `fiscal_engine_saft` | SAF-T obtido do Vendus, com a validação XSD e o SHA-256 |

As migrações são idempotentes (`tenant_migrations.sql`, `CREATE … IF NOT EXISTS`) e
correm no arranque. As tabelas públicas entram pelo `schema.prisma`.

## Rotas

Super Admin (`/super-admin/fiscal-engine`, só `SUPER_ADMIN`): `GET /`,
`PATCH /settings`, `PATCH /lps-validation`, `POST /evidence`, `GET /evidence/:id`,
`GET /company/:id`, `PUT|DELETE /company/:id/api-key`, `POST /company/:id/test`,
`PATCH /company/:id`, `POST /company/:id/tests`, `POST /company/:id/activate`,
`POST /company/:id/suspend`, `POST /company/:id/use-lps`, `POST /company/:id/health`.

Empresa (`/fiscal-engine`):

| Rota | Papel mínimo |
|---|---|
| `GET /status` | gerente de loja |
| `GET /documents`, `GET /documents/:id` | gerente de loja |
| `GET /invoice/:invoiceId`, `GET /documents/:id/pdf` | caixa |
| `POST /documents/:id/retry`, `POST /sync/clients`, `POST /sync/products`, `GET\|POST /saft`, `GET /saft/:id/xml` | administrador da empresa |
