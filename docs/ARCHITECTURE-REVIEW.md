# Revisão de arquitetura (v1, 2026-11-07)

## Preservar
- API central NestJS + Prisma, schema por tenant (`runInTenant`).
- Série fiscal por posto e hash encadeado (`docs/ARQUITETURA-OFFLINE-FIRST.md`): é a decisão certa para emitir offline sem conflitos.
- Idempotência por `X-Client-Op-Id` com reserva antes de executar (`common/idempotency.interceptor.ts`).
- Emissão transacional com `FOR UPDATE` (série e produtos) em `pos/invoice.service.ts`.
- Pacote `offline-core` (adapters IndexedDB/SQLite/memória, backoff, conflitos) — já tem testes (`engine.test.ts`).

## Corrigir
- **Carrinho do POS**: hoje vive em `useState` + `localStorage` dentro de `PosPage.tsx` (66 KB). Passar para um módulo próprio (`apps/pos/src/pos/cartStore.ts`) sobre o kv/IndexedDB já existente, com: id de carrinho, operador, caixa, `updatedAt`, `rev`, linhas com preço/desconto, cliente, pagamento; fusão local×servidor por `updatedAt`/`rev`, nunca substituição cega; remoção por stock só com aviso e com cópia recuperável.
- Separar estados: carrinho local → venda em preparação → operação pendente (outbox) → documento emitido → documento validado.
- Idempotência: incluir método+URL+utilizador na verificação do `op_id`.

## Riscos
- `PosPage.tsx` concentra demasiada lógica (66 KB): difícil testar. Extrair lógica pura para módulos testáveis.
- Poucos testes nas apps cliente; a camada offline é a mais crítica e a menos testada.
