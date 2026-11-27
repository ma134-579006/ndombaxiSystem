# F7 — Loja dos associados (2026-11-27)

## Âmbito
- Loja dos associados da loja online (`/<loja>/associados`): adesão (NONE → PENDING → APPROVED/REJECTED, revogar), catálogo, anúncios, mercado, painel do associado (código, comissões, saldo), contas de saque e saques.
- LPS Kwanza (marketplace de associados): afiliação, preço próprio, comissões, saques. Já estava coberto por testes anteriores e foi repetido.
- Tudo contra a API e a base de QA locais (nunca produção).

## Testes
| Teste | O que cobre | Resultado |
|---|---|---|
| `qa/associados-real.mjs` (existente) | 6 associados Kwanza + 3 da loja online, vendas pela ligação, pagas/canceladas, saques acima do saldo e em simultâneo, painel da empresa | **21/21** (com a correção) |
| `qa/associados-afiliar.mjs` (existente) | afiliação a vários produtos, preço próprio entre 0 % e o máximo, remover afiliação | **15/15** |
| `qa/associados-loja-extra.mjs` (novo) | X1 acesso negado (sem sessão, NONE, PENDING, REJECTED, revogado); X2 máquina de estados; X3/X3b contas em simultâneo; X4 isolamento entre associados; X5 valores inválidos; X6 revogar e reaprovar (comissão e saldo); X7 saques seguidos; X8 isolamento entre empresas | antes 9/12 → **12/12** |

## Defeitos
| ID | P | Defeito | Correção |
|---|---|---|---|
| QA-026 | P2 | Limite de 3 contas de saque ultrapassado com pedidos em simultâneo (Loja e Kwanza) | lock transacional por associado antes de contar |
| QA-027 | P3 | 400 em vez de 403 para quem não é associado aprovado | `ForbiddenException` |
| QA-028 | P3 | Erro ao pedir adesão sem aviso | mensagem de erro no ecrã de adesão |

## Observações (sem alteração; comportamento atual documentado)
- O catálogo da área de associados (`/members/catalog`) é o mesmo catálogo público da loja: não há preços nem produtos exclusivos de associados. Nenhum requisito o pede (NÃO ESPECIFICADO).
- Um associado revogado perde o acesso ao painel, mas as comissões e o saldo ficam guardados e voltam intactos se for reaprovado (X6). A ligação dele deixa de dar comissão enquanto estiver revogado.
- O saque usa `pg_try_advisory_xact_lock`: um 2.º pedido em simultâneo é recusado com «Já há um pedido de saque a ser processado», não fica à espera.
