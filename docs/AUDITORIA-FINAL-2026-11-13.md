# Auditoria empresarial total — relatório final (2026-11-13)

Continua a auditoria de 2026-11-09 (`docs/AUDITORIA-QA-2026-11-09.md`). Todos os testes desta fase correram **só em localhost**: API local (porta 3901) e PostgreSQL 16 portátil (`127.0.0.1:55433`, base `nexus_qa`), com dados sintéticos de domínio `.qa.test`. Em produção só houve pedidos de leitura leves e uma verificação de que um checkout sem GPS é recusado (400), sem criar encomendas. Não houve teste de carga, de stress nem destrutivo em produção, nem documentos fiscais fictícios.

## 1. Resumo executivo

**Resultado: APROVADO COM RISCOS RESIDUAIS** (secção 7).

Esta fase encontrou **12 defeitos comprovados** e corrigiu-os todos, cada um com um teste que o confirma. Estão em produção nos PRs #195 a #200.

| ID | Sev. | Módulo | Problema | PR |
|---|---|---|---|---|
| K-01 | Crítica | LPS Kwanza | A compra do cliente saía para a loja online da empresa e a venda perdia a ligação ao associado (o associado não via a encomenda nem a comissão) | #198 |
| K-02 | Alta | LPS Kwanza | Ligação do associado sem publicação → "Produto indisponível" para o cliente sem conta | #198 |
| K-03 | Alta | LPS Kwanza | `/kwanza` em ciclo de redirecionamento 308 no Cloudflare | #195 |
| K-04 | Média | LPS Kwanza | Produto sem stock podia ser publicado | #196 |
| K-05 | Média | LPS Kwanza / loja | Produto publicado ficava invisível (cache do catálogo e `show_online` por ligar) | #197 |
| F-01 | Alta | Fiscal | Arredondamento em vírgula flutuante: 12 × 11 828,65 com 12,5 % de desconto dava 124 200,82 em vez de 124 200,83 (linhas e devoluções) | #199 |
| C-01 | Alta | Caixa | Venda em numerário sem turno aberto não entrava em nenhuma caixa (fecho não batia) | #200 |
| C-02 | Alta | Caixa | Sangria maior do que o dinheiro na gaveta era aceite | #199 |
| P-01 | Alta | Compras | Receção da compra não criava a conta a pagar ao fornecedor | #200 |
| D-01 | Média | Clientes | O mesmo NIF em dois clientes; NIF "abc" e nome só com espaços aceites | #199 / #200 |
| D-02 | Média | POS | Limites ausentes: quantidade, valor de movimento de caixa, data da operação (2099 e 1900 aceites) | #199 |
| D-03 | Baixa | POS | Eliminar produto ou cliente inexistente não dava 404 | #199 |

## 2. Cobertura

**Ambiente:** 5 empresas de setores diferentes, criadas por `qa/seed-cinco.mjs`: supermercado, grossista, eletrónica, serviços e loja de roupa. Cada uma tem 6 utilizadores (gerente, supervisor, 2 caixas, atendente, regional), 600 produtos, clientes e fornecedores. Há ainda a empresa de distribuição do LPS Kwanza, com associados e publicações.

| Suíte | Verificações | Resultado |
|---|---|---|
| `qa/auditoria.mjs`: financeiro, extremos, caixa, stock e concorrência, fiscal, isolamento entre empresas, validação de entradas, compras | 99 | **99/99** (antes 96/99) |
| `qa/loja.mjs`: loja online (catálogo, carrinho, GPS obrigatório, cupões, encomendas) | 30 | 30/30 |
| `qa/kwanza-compra.mjs`: compra toda no LPS Kwanza, associado em tempo real, saldo e saque, "Minhas compras" | 23 | 23/23 |
| `qa/kwanza-confianca.mjs`: avaliações, gostos, reclamações, devoluções, congelamento de saldo | 31 | 31/31 |
| `qa/kwanza-lote.mjs`: configuração em lote, publicação só com stock | 19 | 19/19 |
| API (jest) | 295 | 295/295 |
| `@nexus/agt-xml` (cálculo fiscal) | 55 | 55/55 |
| `qa/carga-cinco.mjs`: carga com as 5 empresas | 4 níveis | secção 4 |
| Revisão de ecrãs (secção 5) | 35 secções da gestão, 11 páginas da loja e do LPS Kwanza, caixa × 3 larguras | sem defeitos |

## 3. Correções desta fase (causa e validação)

- **K-01/K-02.** Faltava um checkout próprio do LPS Kwanza.
  - **Agora:** `POST /kwanza/checkout` cria a encomenda na empresa com o preço do associado e atribui a comissão. A encomenda fica registada em `kwanza_orders` com um token do cliente.
  - **Ligação do associado:** abre o produto mesmo sem publicação (`GET /kwanza/listing/...?a=`) e guarda o código durante 30 dias.
  - **Validação:** no navegador, a encomenda WEB/2026/0020 passou de "Encomenda feita" a "Paga" (saldo 35,35 Kz) e depois a "Em entrega" no painel do associado, sem recarregar. `kwanza-compra` passa 23/23.
- **F-01.** O produto quantidade × preço × (1 − desconto) era feito em `number`.
  - **Agora:** `mulRound2` faz o produto decimal exato em BigInt, com arredondamento meio-para-cima. É usado nas linhas e nas devoluções.
  - **Validação:** regressão em `money.spec.ts`, e o teste FIN-1 compara 150 vendas aleatórias com o cálculo exato.
- **C-01.** A venda só gravava o movimento se houvesse turno ("best-effort").
  - **Agora:** com rede, `POST /pos/invoices` exige o turno aberto e dá 409 "Caixa fechada: abra o turno antes de vender." É a mesma regra que o POS já mostra no botão "ABRIR CAIXA".
  - **Exceções:** ficam isentos a fila offline (`offline=true`), o servidor local do posto e o reenvio idempotente (devolve a fatura original).
  - **Validação:** 3 testes novos em `pos.controller.spec.ts` e CX-0.
- **C-02.** `addMovement` recusa uma saída (CASH_OUT) acima do numerário esperado na gaveta, exceto operações offline. Validação: CX-5.
- **P-01.** A receção cria a conta a pagar pelo total da encomenda, com vencimento a 30 dias e referência = nº da encomenda (nunca duas vezes). Validação: CO-5.
- **D-01.** `CreateCustomerDto` faz trim e valida o formato do NIF. Um NIF vazio conta como não indicado. O mesmo NIF não pode estar em dois clientes ativos (exceto 999999999); a verificação é feita na aplicação porque bases antigas podem ter repetidos. Validação: IN-C e IN-4.

## 4. Carga (`qa/carga-cinco.mjs`, local)

Os 10 caixas das 5 empresas trabalham ao mesmo tempo, cada um com o seu posto e a sua série fiscal. Cada utilizador virtual repete pesquisa de produtos, clientes, 2 vendas com chave de idempotência e o histórico do dia. O nível de 100 utilizadores virtuais equivale a 10 pedidos em paralelo por posto. Medido numa máquina de 4 núcleos que corre a API, o Postgres e o gerador ao mesmo tempo.

| Utilizadores virtuais | Pedidos/s | Vendas/s | Erros | p50 | p95 | p99 |
|---|---|---|---|---|---|---|
| 10 | 36 | 14,6 | 0 % | 133 ms | 638 ms | 890 ms |
| 25 | 24 | 9,8 | 0 % | 566 ms | 3,4 s | 4,4 s |
| 50 | 36 | 15,2 | 0 % | 937 ms | 3,5 s | 4,1 s |
| 100 | 36 | 16,0 | 0 % | 2,4 s | 5,1 s | 5,7 s |

**Coerência no fim:** 1 822 vendas, todas gravadas. Nenhum número fiscal repetido, nem nas respostas nem na base. **0 deadlocks.**

**Leitura:**
- O débito estabiliza em cerca de 15 vendas/s e, acima disso, a latência sobe sem erros: os pedidos ficam em fila, não falham.
- Uma corrida com 10 ligações em vez de 5 foi **pior** (11 vendas/s, p95 8,9 s). O limite está no processador e no disco desta máquina e na serialização deliberada por série fiscal e pela cadeia do registo de auditoria (`pg_advisory_xact_lock` por empresa), não no pool.
- O pool de 5 ligações (`prisma.service.ts`) fica como está: protege o limite de ligações do Aiven durante os deploys.
- Com o registo de consultas lentas ligado (≥150 ms), só apareceram `COMMIT` (≈1 s, fsync do disco local) e o lock do registo de auditoria.

## 5. Revisão de ecrãs (navegador, localhost)

Detetor automático em cada página: deslocamento horizontal, elementos fora do ecrã que não estão dentro de uma zona com scroll, erros visíveis e consola.

- **Gestão (empresa A):** 35 secções a 360, 768 e 1280 px, com 0 problemas. Incluem Produtos, Movimentos de stock, Compras, Clientes, Documentos, Relatórios, Lucros, Fluxo de caixa, Contas a pagar/receber, Gastos, Funcionários, Folha salarial, Férias, Caixas, Lojas, Configurações, SAF-T, Promoções, Loja online, Encomendas, LPS Kwanza, Subscrição, Backup, Migração, Perfil, Contabilidade e Conciliação.
- **Loja online e LPS Kwanza, sem sessão:** marketplace, pesquisa, produto, carrinho, Minhas compras, reclamações, entrar, registar, recuperar e duas lojas de empresa, nas 3 larguras, com 0 problemas. Os ecrãs de entrada e registo não têm scroll vertical.
- **Caixa (POS):** a 360, 768 e 1280 px não há scroll, e o botão FINALIZAR está sempre visível.
- Produtos com nome `<script>alert(1)…` (dos testes de injeção) aparecem como texto: sem XSS.
- A consola da gestão, da loja e da caixa não tem erros.

## 6. Segurança (resumo desta fase)

- **GPS:** obrigatório no servidor no checkout da loja e do LPS Kwanza (400 sem coordenadas e consentimento). Verificado em produção.
- **Comissões:** um associado não recebe comissão da própria compra (telefone igual ao do comprador).
- **Limites de pedidos:** checkout do Kwanza 20/min e recuperação de compras por telefone + nº 10/min.
- **Isolamento:** a empresa B não lê nem altera dados da A (suíte `iso`, incluindo cabeçalhos de empresa forjados).
- **Validação de entradas:** um corpo de 3 MB é recusado, a paginação absurda não dá 5xx, e as pesquisas com `\0`, SQL e XSS não dão 5xx.

## 7. Riscos residuais e o que não foi testado

1. **Saque automático "na hora"** — não implementado: exige um fornecedor de pagamentos (API bancária ou EMIS) com contrato e credenciais. Hoje o saque é pedido pelo associado e pago pela empresa.
2. **GPS no navegador de teste** — o painel de teste não tem GPS; o fluxo foi validado simulando `navigator.geolocation` só nessa página. Num telemóvel real o pedido de permissão é do sistema.
3. **Capacidade em produção** — a carga foi medida numa máquina local. No Render e no Aiven os números dependem do plano. Recomenda-se repetir `qa/carga-cinco.mjs` num ambiente de staging com a mesma configuração de produção (nunca contra produção).
4. **Fora do alcance:**
   - XSD oficial do SAF-T AO;
   - comunicação real com a AGT, a EMIS e o Multicaixa;
   - impressoras físicas;
   - instaladores e APK num aparelho real (as builds 2.0.1047 geraram-se sem erros no CI).
5. **NIF repetido em bases antigas** — a regra nova só impede novos repetidos; os existentes não foram alterados.

## 8. Como repetir

```bash
# QA local: PG16 em 127.0.0.1:55433 e API em 3901 (qa/restart-api.sh com QA_ENV)
node qa/seed-cinco.mjs          # cria as 5 empresas (estado em qa/.cinco.json, não versionado)
node qa/auditoria.mjs           # 99 verificações
node qa/loja.mjs && node qa/kwanza-compra.mjs && node qa/kwanza-confianca.mjs && node qa/kwanza-lote.mjs
node qa/carga-cinco.mjs 30 10,25,50,100
```
