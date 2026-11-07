# Bugs e defeitos (v1, 2026-11-07)

Encontrados por leitura de código. Estado: **por confirmar com teste** salvo indicação.

| ID | Gravidade | Onde | Defeito | Cenário de falha |
|---|---|---|---|---|
| B-01 | Crítica | `apps/pos/src/pages/PosPage.tsx:651-687` | A hidratação do rascunho do servidor faz `setCart(lines)` sem comparar com o carrinho local (sem versão nem data). | Rede cai; o funcionário lança 50 artigos (só ficam no localStorage); a rede volta e a página recarrega; o rascunho antigo do servidor (p. ex. 1 artigo) substitui os 50 e o efeito de persistência grava por cima. Perda silenciosa. |
| B-02 | Alta | `PosPage.tsx:621-645` | A reconciliação com o stock remove linhas em silêncio (produto ausente do catálogo atual ou stock ≤ 0) e a remoção é persistida. | Catálogo em cache diferente, produto desativado ou stock desatualizado: artigos somem do carrinho sem aviso. |
| B-03 | Alta (a confirmar) | `PosPage.tsx:235-239` + `591-597` | O estado inicial lê o localStorage uma só vez; se `user` ainda não existir no 1.º render, o carrinho começa vazio e o efeito de persistência apaga a chave. | Depende de o POS montar antes de o utilizador estar decidido. |
| B-04 | Média | `PosPage.tsx:697` | O rascunho do servidor só leva `productId` e `quantity`: perde descontos manuais, preço praticado e método de pagamento. | Mudar de aparelho a meio da venda. |
| B-05 | Média | `PosPage.tsx:591-597` | Falha de escrita no localStorage (quota) é ignorada sem aviso. | Armazenamento cheio: o funcionário julga que o carrinho está seguro. |
| B-06 | Baixa | `apps/api/src/common/idempotency.interceptor.ts:84-101` | A chave de idempotência não está ligada ao URL nem ao utilizador: reutilizar o mesmo `X-Client-Op-Id` noutro endpoint devolve a resposta guardada do primeiro. | Bug de cliente que reutiliza UUID. |
| B-07 | Baixa | `idempotency.interceptor.ts:125-139` | Se gravar o resultado falhar, a reserva fica `pending` e os reenvios recebem 503 durante 2 min. | BD instável no fim da operação. |
| B-08 | Média | POS | Não existe multi-carrinho nem venda suspensa persistente. | Cliente esquece a carteira: o funcionário tem de limpar a venda ou bloquear a fila. |

Bugs que o Vendus não tem por construção: o Vendus anuncia-se "100% online" (sem modo offline), por isso B-01/B-02 não se comparam diretamente; são defeitos da camada offline do Ndombaxi que tem de ser fiável.
