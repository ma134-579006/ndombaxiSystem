# Paridade funcional Vendus × LPS Vendas (auditoria geral, 2026-11-07)

Vendus: observado na conta real (ver `VENDUS-PAGES.md`, `COMPETITIVE-ANALYSIS-VENDUS.md`). LPS Vendas: procura no código (`apps/api`, `apps/web`, `apps/pos`) — presença no código não prova que funciona; cada item "EXISTE" fica UNVERIFIED até ter teste.

## A. Falta no LPS Vendas → ADICIONAR (por prioridade)
| # | Funcionalidade (Vendus) | Prova da ausência | Notas |
|---|---|---|---|
| A1 | Várias vendas em paralelo / "Nova Venda" estaciona a atual | POS tem 1 carrinho por operador; `QueueModal` é a fila offline, não suspensão | Persistir cada venda (mesma camada `cartPersist`) |
| A2 | Ponto de Caixa (situação a meio do turno, sem fechar) | 0 ocorrências | Backend já tem movimentos de caixa (`cashbox/`) |
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
