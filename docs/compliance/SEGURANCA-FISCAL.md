# Segurança e integridade fiscal

A protecção está na camada de negócio **e** na base de dados. Não depende de esconder botões.

## Base de dados (por empresa)

| Ameaça | Protecção | Teste |
|---|---|---|
| Alterar total, data, número, NIF ou nome do cliente de um documento emitido | Regra `fiscal_no_update_invoices` (sem efeito) | FI-1 |
| Alterar linhas | Regra `fiscal_no_update_invoice_items` | FI-9 |
| Apagar documentos | Regras de DELETE (sem efeito) | FI-2 |
| Estado inventado; anular sem ciclo ANNULLED; repor um anulado (A→N) | Gatilho `fiscal_guard_invoice_update` (erro) | FI-3, FI-4, FI-6 |
| TRUNCATE de facturas, linhas ou auditoria | Gatilho `fiscal_guard_truncate` (erro) | FI-7, FI-8, FI-12 |
| Apagar ou alterar a auditoria | Gatilho `fiscal_guard_audit` (só aceita a re-selagem da cadeia) | FI-10, FI-11 |
| Reutilizar (tipo, série, ano, sequência) | `invoices_series_seq_unique` | FI-13 |
| Eliminar uma empresa com documentos | `TenantsService.remove` recusa (409); só se suspende | Código |

## Aplicação

| Ameaça | Protecção | Teste |
|---|---|---|
| Caixa forja facturas pela replicação | `fiscal-replication.guard.ts`: série de posto, número, totais, datas, sequência, estado | E-9, `fiscal-replication.guard.spec.ts` |
| Acrescentar linhas a uma factura emitida | Linhas só para facturas de posto e sem ultrapassar o total | E-10 |
| `offline:true` para saltar controlos | Exige `clientOpId` (fila da Caixa) | E-7, E-8 |
| Escolher a série de outro posto ou a WEB | Ignorada | E-5, E-6 |
| Data da operação absurda | `safeOperationDate` | `operation-date.spec.ts` |
| Totais manipulados pelo cliente | Recalculados no servidor (DTO sem preços livres) | Pré-existente |
| NIF do cliente inválido | Recusado na emissão | E-3, E-4 |
| Emitente com NIF provisório | Recusado | E-14 |
| Emitir sem assinatura em produção | Recusado (503) | Código |
| Submeter o mesmo documento várias vezes | Reserva `SKIP LOCKED` + E09 reconciliado | H-1…H-3 |
| Aceder à configuração do produtor | Só SUPER_ADMIN | A-5 |
| Rotação de chave e configuração AGT sem rasto | Trilho de auditoria da plataforma | Código |

## Riscos remanescentes

- O utilizador da BD da aplicação é dono das tabelas. Em teoria pode fazer `DROP TRIGGER`. Recomendação: role sem ownership para a aplicação.
- Postos locais: a assinatura e o relógio do posto não são verificáveis na nuvem.
- Um caixa vê facturas de outras lojas da mesma empresa (B5) e um supervisor pode devolver 100% por devoluções parciais (B2). São regras de negócio a decidir.
- Recibos (`receivable_payments`): sem imutabilidade nem UNIQUE no número.
- Uma única chave de cifra para todos os segredos (ver CHAVES-CRIPTOGRAFICAS).
