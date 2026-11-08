# Paridade funcional Vendus × LPS Vendas (auditoria geral, 2026-11-07)

Vendus: observado na conta real (ver `VENDUS-PAGES.md`, `COMPETITIVE-ANALYSIS-VENDUS.md`). LPS Vendas: procura no código (`apps/api`, `apps/web`, `apps/pos`) — presença no código não prova que funciona; cada item "EXISTE" fica UNVERIFIED até ter teste.

## A. Falta no LPS Vendas → ADICIONAR (por prioridade)
| # | Funcionalidade (Vendus) | Prova da ausência | Notas |
|---|---|---|---|
| A1 | Várias vendas em paralelo / "Nova Venda" estaciona a atual | POS tinha 1 carrinho por operador; `QueueModal` é a fila offline, não suspensão | **FEITO** (commit 9bd68e7, `pos/parkedSales.ts`, 6 testes) |
| A2 | Ponto de Caixa (situação a meio do turno, sem fechar) | ~~0 ocorrências~~ ERRO da pesquisa: já existe como "Relatório X" (`GET /cashbox/report/x`, `ShiftModal.tsx`) | **JÁ EXISTIA**; botão renomeado "Ponto de caixa (Relatório X)" |
| A3 | Modo Formação (documentos sem validade fiscal) | só em textos de landing/fiscal | Série própria de formação, nunca no SAF-T; exige backend |
| A4 | Documento Manual (integrar faturas emitidas à mão quando o sistema falha) | 0 ocorrências | Requisito AGT a confirmar em fonte oficial |
| A5 | Grupos de Preço por cliente | 0 ocorrências | Produto com preço por grupo |
| A6 | Talões de Desconto e Campanhas | só 3 ficheiros genéricos | `promotions/` existe; falta talão com código |
| A7 | Avenças (faturação recorrente) | 1 ocorrência | — |
| A8 | Modelos de talão configuráveis | 0 ocorrências | — |
| A9 | Enviar SAF-T por e-mail | 0 ocorrências | `common/mail` existe |
| A10 | Depósito/adiantamento do cliente no POS | a verificar (`deposit` aparece noutros contextos) | — |
| A11 | Assistente Trocas/Devoluções/Anulações passo a passo no POS | NC existe no backend | Fluxo guiado no POS |
| A12 | Relatórios por hora e por dia da semana em gráfico de barras | ocorrências genéricas | — |

## B. Existe nos dois → VERIFICAR e corrigir onde falha
Fecho de caixa, entradas/saídas de caixa, conta corrente / faturas por liquidar, rejeitados AGT, séries fiscais, inventário/exportação, unidades, variações, marcas, armazéns, tipos de pagamento, motivos de NC, perfis/permissões, migração/importação, relatório mensal, mapa de impostos, faturas e encomendas de fornecedor, análise e movimentos de stock, retenção na fonte, lotes e validades, guias de transporte, orçamento/pró-forma, gaveta, balança/visor, bloquear ecrã, autoconsumo.
Bugs já confirmados nesta área: B-01..B-11 (`BUGS-AND-DEFECTS.md`).

## C. Só no LPS Vendas (vantagens a preservar)
Venda offline com série por posto e idempotência; loja online própria; restauração com cozinha; hotel, clínica, farmácia, RH/salários, câmaras, assistente IA.

## Ordem de execução
1. A1 (vendas em paralelo/suspensas) — maior impacto no balcão.
2. A2 Ponto de Caixa.
3. Redesign página a página (layout Vendus, cores e barra lateral LPS) — admin, caixa, super admin, com animações.
4. A5–A9, A11, A12; A3/A4 depois de confirmar requisitos AGT.

## Redesign no padrão do Vendus (2026-11-07) — estado
| Área | Estado | Commits |
|---|---|---|
| Barra de topo (título, subscrição, AGT Ativo/Inativo, +, ?, conta) | FEITO | 9f41f98 |
| Ícones com as metáforas do Vendus (desenho próprio) | FEITO | 9f41f98 |
| Barra lateral esquerda sem scroll (intacta no aspeto) | FEITO | 5c673e5 |
| Título só na barra de topo (sem duplicado nas páginas) | FEITO | 5c673e5 |
| Produtos: listagem com filtros/tabela/Opções e formulário em página | FEITO | 9f41f98 |
| Dashboard: faturação hoje/mensal/anual, gráfico 30 dias, mais vendidos/rentáveis, 6 meses, linha por loja, stocks por loja, categoria/marca, top clientes | FEITO | eb3545b |
| Movimento medido no Vendus (0.3s; 500ms ease-out circular) | FEITO | b95c273 |
| Caixa: topo com menus, separadores de categorias, venda (n/n), tabela, TOTAL, Opções, FINALIZAR, ecrã de finalização | FEITO (sem verificação visual com sessão) | b95c273 |
| Pele global do admin/super admin (cartões, tabelas, botões, campos, KPIs, separadores, modais) | FEITO | 5e2f95a |
| Páginas uma a uma (Documentos, Clientes, Relatórios, Compras, Stock, Configuração) com layout próprio do Vendus | POR FAZER | — |
| Loja online no padrão Vendus GO | POR FAZER | — |
| Setores (restauração, hotelaria, farmácia, saúde, serviços) estudados no Vendus | POR FAZER | — |
| Funcionalidades fiscais (A3 Modo Formação, A4 Documento Manual, séries AGT, rejeitados) | POR FAZER (confirmar requisitos AGT) | — |

Limitação: a verificação visual com sessão iniciada exige o login do utilizador (as credenciais nunca são introduzidas pelo agente).

## Pendentes (lista viva, 2026-11-07 — pedidos do dono do produto)
Feito desde a última atualização: talão térmico e A4 no formato do Vendus; círculo de processamento único com o logótipo; página AGT da empresa (SAF-T, Comunicação, Configuração: Estado/Séries/Rejeitados) e endpoints da empresa; migração no layout do Vendus; ícone de mensagem fixo; publicação em produção (PR #131, merge f8f49bd).

Por fazer (por ordem):
1. Abas/separadores e janelas iguais às do Vendus em TODO o sistema (admin, super admin, caixa, landing) — estudar no Vendus uma página com abas antes de desenhar.
2. Páginas uma a uma no layout do Vendus: Inventário, Movimentos de stock, Compras, Promoções, Equipa, Clientes, Câmaras, Backup e Restauro, Configurações, Subscrição e Planos, Relatórios.
3. Migração: cartão "Stock" (Referência; Quantidade; Loja; Operação) — exige endpoint novo de atualização de stock por ficheiro.
4. Super admin: página Fiscal (AGT) com o mesmo layout de cartões; Dashboard da plataforma sem "Ao vivo"/"Atualizar".
5. Loja online no padrão Vendus GO.
6. Setores do Vendus (restauração, hotelaria, farmácia, saúde, serviços) — estudar e copiar.
7. Fiscal: A3 Modo Formação, A4 Documento Manual (confirmar requisitos AGT em fonte oficial), restantes A5–A12.
8. Formatos de impressão dos relatórios (PDF) iguais aos do Vendus.
9. Verificação visual de cada página com sessão (o agente não introduz credenciais — o utilizador entra).
10. Segurança: a palavra-passe do super admin foi escrita na conversa — deve ser alterada pelo utilizador.

### Atualização 2026-11-08
Feito (PRs #136–#138): círculo de carregamento sem salto; setores no estilo Vendus (farmácia, restaurante, hotel, clínica, serviços); restaurante com transferir mesa, dividir conta, consulta de mesa, eliminar mesa, fatura física/digital, QR do cardápio, bebidas fora da cozinha; Movimentos de stock e Funcionários no padrão Vendus; loja online com montra por setor; datas locais (Visão geral "Hoje" estava a 0 Kz); "Renovar subscrição" com cores em gestão e caixa; AGT inativo a vermelho. Teste real do restaurante numa conta (2 faturas, relatório certo).

Bloqueios / por fazer:
- **Cloudflare Pages falha todos os builds desde 2026-11-08 08:40** (admin, caixa e loja, também na main e num commit vazio; o build local passa). O frontend novo não está publicado. Precisa de alguém com acesso à conta Cloudflare do projeto para ver os logs (provável limite de builds).
- Loja online por setor ainda não verificada no ecrã: a loja da conta de teste não está publicada.
- Movimentos de stock: "Utilizador" vazio no saldo inicial.
- Bebidas fora da cozinha por nome de categoria; falta configuração explícita de zonas (cozinha/bar) como as impressoras por zona do Vendus.
- Restantes páginas no padrão Vendus: Inventário, Compras, Promoções, Câmaras, Backup, Configurações, Subscrição, Relatórios.

### Atualização 2026-11-08 (tarde)
Testados de ponta a ponta numa conta real (afrotalentt4, modo shadow): **clínica** (profissional, paciente, marcação, consulta, FT 15.000 Kz), **hotel** (quarto, reserva, check-in, extra, FT 53.000 Kz), **serviços** (OS aberta → orçamento → aprovada → em curso → pronta → entregue + fatura 12.000 Kz), **farmácia** (medicamento, entrada com lote e validade, página Validade & Lotes). Corrigidos os defeitos encontrados (PRs #141–#145): abas com conteúdo ao lado do menu, migalha tapada, KPIs, Nova Reserva, datas ISO/"Invalid Date", lista que não atualizava após check-out, profissional em lista, fatura física/digital em restaurante/clínica/hotel/serviços, produto já escolhido em "Adicionar stock", rótulo do preço sem IVA.
Cloudflare: a gestão voltou a publicar depois de dar mais memória ao Node no build (`--max-old-space-size=4096`) e de desligar o cálculo gzip.

Ainda por fazer: zonas cozinha/bar configuráveis; "Utilizador" vazio no saldo inicial; páginas Inventário, Compras, Promoções, Câmaras, Backup, Configurações, Subscrição e Relatórios no padrão Vendus; venda de medicamento na caixa com receita (não testada nesta ronda).

### Atualização 2026-11-08 (noite) — revisão de pendentes
Feito (PRs #147–#149): botões "Atualizar" retirados; menus "Opções" das tabelas por cima de tudo (já não ficam cortados); ecrã de bloqueio da gestão aos 5 min; zonas cozinha/bar por categoria (Restauração → Zonas); utilizador no saldo inicial; barras de deslocamento visíveis em gestão, caixa e loja. Verificado em produção com super admin (3 empresas e lojas).

**Pendentes reais (por ordem):**
1. Páginas no padrão Vendus: Inventário, Compras, Promoções, Câmaras, Backup e Restauro, Configurações, Subscrição e Planos, Relatórios.
2. Super admin: página Fiscal (AGT) em cartões.
3. Migração: cartão "Stock" (exige endpoint de atualização de stock por ficheiro).
4. PDF dos relatórios no formato do Vendus.
5. Caixa: teste da venda de medicamento com receita.
6. Fiscal A3 Modo Formação / A4 Documento Manual — só depois de confirmar requisitos da AGT em fonte oficial.
7. Utilizador: mudar a palavra-passe do super admin.
