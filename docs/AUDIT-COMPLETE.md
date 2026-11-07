# Auditoria completa — Ndombaxi System (v1, 2026-11-07)

Base: `main` @ a52447a, branch `audit/ndombaxi-completa`. **Esta v1 resulta de leitura de código e de inventário; ainda não há testes executados nesta auditoria.** Tudo o que não foi exercitado está marcado UNVERIFIED. Sem alegações de certificação.

## 1. Estrutura
Monorepo pnpm. Apps: `api` (NestJS + Prisma, PostgreSQL por schema de tenant), `web` (admin/landing/login), `pos` (caixa), `store` (loja online), `desktop` (Electron), `mobile`/`mobile-shell`/`store-shell` (Capacitor), `local-server`. Pacotes: `agt-xml`, `offline-core`, `replication`, `update-core`, `shop-link`, `types`, `tokens`, `ui`.

## 2. Módulos da API (ficheiros .ts por pasta)
pos 13, auth 18, ecommerce 17, ai 16, common 18, hr 14, payments 11, erp 10, migration 10, fiscal 8, cashbox 8, staff 8, tenancy 7, sync 7, restaurant 4, hotel 4, clinic 5, pharmacy 3, inventory 4, payables 4, receivables 4, einvoice 3, reports 3, promotions 6, replication 5, backup 5, devices 5, cameras 6, subscription 5, super-admin 5, entre outros (57 pastas). Testes `.spec.ts`: 32 na API, 8 em pacotes. Não foram encontrados testes nas apps `pos`/`web` por este inventário (a confirmar).

## 3. Mecanismos já existentes (lidos no código)
- Idempotência HTTP genérica: `common/idempotency.interceptor.ts` (cabeçalho `X-Client-Op-Id`, livro `sync_operations`, reserva antes de executar, resposta guardada no reenvio). Sem teste dedicado encontrado.
- Emissão fiscal transacional: `pos/invoice.service.ts` (`runInTenant`, `FOR UPDATE` na série e nos produtos, hash encadeado por série, NC limitada ao vendido, anulação por NC).
- Segurança de base: `helmet`, `ThrottlerGuard` global, CORS configurado, JWT por Bearer (sem cookies de sessão).
- Offline no POS: cache de catálogo/clientes/promoções (kv local), outbox, sync, turno local, carrinho em `localStorage`.
- Série fiscal por posto (`docs/ARQUITETURA-OFFLINE-FIRST.md`): conflitos evitados por construção.

## 4. Classificação por área (estado nesta v1)
| Área | Estado | Nota |
|---|---|---|
| POS — carrinho local | BUG | persiste em localStorage, mas ver BUGS B-01..B-03 |
| POS — emissão e pagamento | PARTIALLY VERIFIED | transações e idempotência no código; sem teste de falha de rede |
| Faturação / NC / anulação | PARTIALLY VERIFIED | lógica no código; `invoice-items-fk.spec` cobre só parte |
| Assinatura AGT (Modelo 8) | PARTIALLY VERIFIED | implementada segundo o handoff; comunicação da chave à AGT é manual e pendente |
| SAF-T | PARTIALLY VERIFIED | `saft.service.ts` existe; reconciliação com documentos UNVERIFIED |
| Stock/ERP/compras/contas correntes | UNVERIFIED | módulos existem; só `stock.service.spec` |
| RBAC | PARTIALLY VERIFIED | `roles.spec`, `staff.roles.spec`; IDOR e isolamento entre caixas UNVERIFIED |
| Backup / replicação | PARTIALLY VERIFIED | specs de replicação; restauro UNVERIFIED |
| Multi-carrinho / vendas suspensas | MISSING | só um carrinho por operador |
| Atalhos de teclado | UNVERIFIED | |

## 5. Limites desta auditoria
- Código ainda não executado nesta auditoria.
- REA: as ferramentas web exigem um endpoint CDP (Chrome com depuração remota), não disponível; análise do site vivo e dos instaladores pendente. Ghidra operacional; JADX/IDA não configurados nesta shell.
- Produção não tocada.
