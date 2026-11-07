# Matriz de funcionalidades — Vendus vs Ndombaxi (v1, 2026-11-07)

Vendus: "Anunciado" = página pública; "N/E" = não encontrado. Ndombaxi: estado segundo leitura de código (sem testes executados nesta auditoria).

| Funcionalidade | Vendus | Ndombaxi | Evidência Ndombaxi |
|---|---|---|---|
| Venda offline | N/E ("100% online") | BUG | `apps/pos/src/offline/*`; ver B-01..B-03 |
| Carrinho persistente | N/E | BUG | `PosPage.tsx:235`, `:591` |
| Múltiplas vendas simultâneas | Anunciado | MISSING | um carrinho por operador |
| Suspensão / recuperação de venda | N/E | MISSING | |
| Pagamentos múltiplos | Anunciado | UNVERIFIED | `PaymentModal.tsx`, `payments/` |
| Pagamento parcial / a prazo | Parcial (saldo, prazo) | PARTIALLY VERIFIED | `receivables/` |
| Leitor de código de barras | Anunciado | PARTIALLY VERIFIED | `scanResolve` em `PosPage.tsx:708` |
| Atalhos de teclado | N/E | UNVERIFIED | `keyboard/KeyboardProvider.tsx` |
| Impressão ESC/POS | Anunciado | PARTIALLY VERIFIED | `escpos.ts`, `print.ts` |
| Fatura / recibo / NC | Anunciado | PARTIALLY VERIFIED | `invoice.service.ts` |
| NC parcial | Anunciado | PARTIALLY VERIFIED | `invoice.service.ts:977` (limite ao vendido) |
| SAF-T AO | Anunciado (envio automático) | PARTIALLY VERIFIED | `saft.service.ts` |
| Assinatura RSA (AGT) | Anunciado | PARTIALLY VERIFIED | `fiscal-signing.service.ts`, `platform-signing.service.ts` |
| Fecho de caixa por utilizador | Anunciado | PARTIALLY VERIFIED | `cashbox/`, `cashbox.math.spec` |
| Stock multi-armazém | Anunciado | UNVERIFIED | `erp/`, `inventory/` |
| Lotes e validades | Anunciado | PARTIALLY VERIFIED | `invoice.service.ts:905` (expiry_date) |
| Compras e fornecedores | Anunciado | UNVERIFIED | `payables/`, `erp/` |
| Conta corrente clientes | Anunciado | UNVERIFIED | `receivables/` |
| Mesas / cozinha | Anunciado | UNVERIFIED | `restaurant/` |
| Delivery | N/E | UNVERIFIED | `ecommerce/` |
| Multi-loja / multi-POS | Anunciado (pago à parte) | PARTIALLY VERIFIED | limites de plano (handoff) |
| Loja online própria | Integrações | UNVERIFIED | `apps/store`, `ecommerce/` |
| Hotel / clínica / farmácia | N/E | UNVERIFIED | `hotel/`, `clinic/`, `pharmacy/` |
| API externa | Anunciado | UNVERIFIED | `integrations/` |
