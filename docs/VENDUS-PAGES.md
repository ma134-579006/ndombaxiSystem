# Inventário de páginas do Vendus (referência de layout, 2026-11-07)

Lido na conta real do utilizador (só GET, só estrutura: títulos, botões, filtros, campos e cabeçalhos de tabela; sem dados de linhas). Capturas em `docs/vendus-ref/`. Serve de referência de LAYOUT para o redesign das páginas do LPS Vendas; cores e barra lateral do LPS Vendas mantêm-se. Nenhum código ou recurso do Vendus é copiado.

## Padrão comum
- Barra superior branca: título da página à esquerda; à direita estado da subscrição, estado AGT (ícone + "Ativo"), botão "+" (criar rápido), "?" (ajuda), avatar com nome e e-mail.
- Breadcrumb "Secção / Listagem" à esquerda; à direita botão principal azul (com seta para mais ações) e botão contornado "Mais".
- Cartão de filtros: pesquisa + selects (lojas, categorias, marcas) + intervalos Min/até/Max + estado; linha de checkboxes de colunas visíveis; "Limpar" e "Pesquisar".
- Tabela em cartão: "Mostrar [20] registos", cabeçalhos ordenáveis, valores com "S/IVA" por baixo, stock por loja em badge (vermelho 0, azul >0), botão "Opções ▾" por linha.
- Formulários: cartões em secções; rótulo à direita em negrito com "?" de ajuda, campo à esquerda; duas colunas em pares curtos; "Gravar" no fim.
- Documentos: lista em cartões (avatar circular com tipo "FT", número, cliente, valor e data à direita), bloco "Rascunho" amarelo recolhível no topo, painel de filtros à direita (Lojas, Data de Emissão, Estado, Intervalo de Valores, "Aplicar Filtro", "Limpar Filtro").
- Relatórios: filtros Ano / Mês / Intervalo de Datas / Loja + "Aplicar Filtro", "Imprimir", "Download PDF", "Exportar CSV".
- Botões flutuantes no canto inferior direito: grelha de apps e "Ajuda".

## Páginas
| Página | Ações | Colunas / campos |
|---|---|---|
| Dashboard | — | KPIs Faturação Hoje/Mensal/Anual com variação; gráfico; Mais Vendidos, Mais Rentáveis, Últimos 6 meses; Stock (mínimo, sem stock, negativo) por loja; clientes com dívida; compras |
| Produtos | Adicionar Produto ▾, Mais, Limpar, Pesquisar | Ref, Nome, Preço (S/IVA), Preço Fornecedor, IVA, stock por loja, Opções |
| Adicionar Produto | Gravar, "Continuar a adicionar" | Nome, Referência, Código de Barras, Descrição, Incluir na Fatura, Imagem, Tipo de Variação, Categoria, Marca, Tipo, Unidade, Imposto, Motivo da Isenção, Norma Legal, Preço de Custo, Preço c/IVA s/IVA, Margem/PVP, Controlar Stock, Tipo de Stock, Lotes e Validades, Disponibilidade por loja |
| Análise de Stock | Atualizar Stock, Gerar Relatório | Período de comparação, Lojas/Armazéns, Categorias, Marcas, Estado do stock |
| Movimentos de Stock | Exportar CSV, Limpar, Pesquisar | Produto, Data, Operação, Lojas, Observações, Qtd |
| Marcas / Categorias | Adicionar, Suspender, Editar | Nome, Estado |
| Variações | Adicionar, Template Roupa, Template Calçado | — |
| Personalizações | Adicionar Grupo | — |
| Layouts | Adicionar Layout | — |
| Unidades | Adicionar, predefinir, editar, apagar | Unidade, Casas Decimais |
| Grupos de Preço | Adicionar Grupo, editar | Nome |
| Documentos (Faturação/Transporte/Informativo/Todos/Formação) | Criar Documento ▾, Remover rascunhos, Aplicar Filtro, Gerar ZIP, Descarregar | lista em cartões + filtros à direita |
| Novo Documento | Adicionar Novo Item, Criar Documento | tipo (FT, FT Global, FR, NC, Pró-Forma, Orçamento, Encomenda, Guia Transporte, Guia Remessa), cliente, datas, vencimento, observações, referência externa, caixa; itens: Produto, Desc., IVA, P.Unit., Qtd., Total |
| Avenças | Criar Avença, Pesquisar, Aplicar Filtro | pesquisa por Nome/NIF |
| Faturas por Liquidar | Pesquisar | Factura, Cliente, Data, Vencimento, Valor, Dívida |
| Rejeitados AGT | — | lista de documentos falhados |
| Motivos de NC | Adicionar Motivo, predefinir, editar, apagar | Motivo |
| Talões de Desconto / Campanhas | Adicionar Talão, Campanhas, Criar Campanha | pesquisa por código |
| Clientes | Adicionar Cliente, Exportar, Pesquisar, Opções | Nome, NIF, Código Postal, Telemóvel, Estado |
| Adicionar Cliente | Validar NIF, Guardar | NIF, Nome, País, Gestor de Conta, Vencimento, Morada, Código Postal, Localidade, Telefone, Telemóvel, E-mail, Fatura Eletrónica, Website, Grupo de Preço, Referência Externa, Observações, Faz Retenção |
| Conta Corrente | — | — |
| Fornecedores | Adicionar, Exportar, Pesquisar, Opções | Fornecedor, NIF, Código Postal, Telemóvel |
| Adicionar Fornecedor | Validar NIF, Gravar | NIF, Fornecedor, Morada, CP, Localidade, País, Telefone, Telemóvel, Email, Website, Observações |
| Faturas de Fornecedor | Adicionar Factura, Exportar, Pesquisar, Limpar Filtro | Fornecedor, Nº, Data, Vencimento, Valor, Pago, Em Dívida |
| Encomendas (fornecedor / GO) | Pesquisar, Aplicar Filtro | — |
| Movimentos de Caixa | — | por Caixa |
| Relatórios (produtos, clientes, …) | Aplicar Filtro, Imprimir, PDF, CSV | Ano/Mês/Intervalo/Loja |
| Relatório Mensal | Exportar PDF/CSV | Mês, Vendas c/IVA, Vendas, Custos, Resultado, Nº Vendas, Nº Rectificações |
| Mapa de Impostos (e de Fornecedores) | Aplicar Filtro, Imprimir, PDF, CSV | Imposto, Taxa, Nº Produtos, IVA, Base de Incidência, Total |
| Listagem de Produtos | idem | IVA, PVP, Documento, Data, Produto, Qtd., Região, Código, Taxa, Valor, P.Base, P.Unit., Total, Retenção |
| Tipos de Pagamento (relatório) | idem | Loja/Caixa × método, Quantidade, Total |
| Vendas Diárias | idem | Intervalo, Lojas |
| AGT | Exportar SAF-T, Exportar Inventário, Configurar | histórico: Data, Hora, Utilizador, Ação, Estado |
| AGT Configuração | Consultar séries, Documentos Rejeitados | estado da comunicação, certificado |
| SAF-T AO | Descarregar, Enviar por e-mail | Ano, Mês, Início, Fim |
| Utilizadores | Adicionar, Perfis, Opções | Nome, Email, Perfil, Estado |
| Perfis de Utilizadores | Tabela de Permissões, Adicionar Perfil | — |
| Lojas / Caixas | Adicionar Loja, Adicionar Caixa | Caixa, Data Expiração, Estado |
| Armazéns | Adicionar, apagar, editar | Armazéns, Estado |
| Tipos de Pagamento (config) | Adicionar, suspender, editar | Título, Troco, Tipo, Estado |
| Modelos de talão | Adicionar, predefinir, ver, editar, apagar | Nome, Predefinido |
| Configurações de Impressão | Editar | Caixa, Loja |
| Migração de Dados | Importar (.CSV, .XML) | — |

## Menu Configuração (engrenagem)
Subscrição, Utilizadores, API, Iniciar Ponto de Venda, Movimentos de Caixa, Aspeto (layouts), Vendus Desktop, Loja Online (GO: encomendas, produtos, categorias), Marketplace, Vendus Pay (pagamentos presenciais/online), Armazéns, Lojas e Caixas, Modelos, Tipos de Pagamento, Unidades, Motivos de NC, Grupos de Preços, Perfis de Utilizadores, Autoconsumo, Histórico de Pagamentos, Migração.

## Relatórios (todos lidos)
Produtos, Variações, Clientes, Fornecedores, Marcas, Categorias, Loja, Utilizadores, Diário, Por Hora (barras), Dias da Semana (barras), Mensal, Gestor de Conta, Autoconsumo.

## Não lido
Ecrãs internos do POS que exigem ação (modal de pagamento, fecho de caixa, assistente de devolução) e o "Novo POS" (pos.vendus.co.ao): abri-los numa conta real arriscava criar movimentos.
