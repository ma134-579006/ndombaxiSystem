# Análise competitiva — Vendus Angola (v1, 2026-11-07)

Fonte: só páginas públicas, sem login: vendus.co.ao (/, /ajuda/, /planos-precos/, /funcionalidades/retalho/, /funcionalidades/restaurantes/, /ajuda/facturacao-electronica-ao/, /ajuda/funcionalidades-2/). Nada de código, contas ou recursos protegidos.

**Aviso:** parte do conteúdo parece herdado do site português (Multibanco, MB Way, IRS/IRC, RGPD). Há contradição na certificação ("Software Validado Nº 142/AGT" vs "certificado com o Nº 2230") e nos preços em Kz (23 999 Kz vs 6 333 Kz). Tratar como UNVERIFIED para Angola.

## Observação funcional na conta real (2026-11-07, só leitura)
Conta do utilizador no Chrome (Loja da Mulher). Nenhuma venda, documento ou registo foi criado; a caixa observada tinha a subscrição expirada (não fatura).

**POS** (`/app/pos/`, existe também "NOVO POS" em pos.vendus.co.ao):
- Escolha de caixa por loja ao entrar (3 caixas em 2 lojas).
- **Várias vendas em paralelo**: "Venda (n/m)" com setas anterior/seguinte; "Nova Venda" estaciona a atual (`#/sales/park/`) — é a suspensão de vendas.
- Métodos de pagamento: Dinheiro, Multibanco, Cartão de Crédito, Conta Corrente, Transferência Bancária, Compensação de Saldos C/C; teclado numérico no ecrã.
- Cliente (Consumidor Final por omissão), **Depósito** (saldo/adiantamento do cliente), desconto global e por linha, escolha do tipo de documento, **Documento Manual** (integração de faturas manuais), Imprimir Pedido, Cancelar Venda, Abrir Gaveta.
- Caixa: Estado/Fechar Caixa, Entrada e Saída de dinheiro manuais, **Ponto de Caixa** (situação dos movimentos), Abrir Gaveta.
- **Modo Formação/Testes**: documentos sem validade fiscal para treinar funcionários.
- Documentos no POS: pesquisa por número/cliente; Faturação; Informativos (orçamento, pró-forma); Transportes; **Trocas, Devoluções ou Anulações** como assistente passo a passo.
- Autoconsumo (registar/consultar), Talões de Desconto, Consultar Stock, Bloquear Ecrã, Trocar de Utilizador, Tempo de Suspensão.
- "Vendus Dispositivos": app Windows local para impressoras, visor de cliente e balanças.
- Pesquisa por nome ou referência; categorias como botões rápidos.

**AGT** (`/app/agt/`): exportação SAF-T mensal com histórico (data, utilizador, estado, incl. erros); exportação de inventário (CSV/XML); **comunicação de séries de faturação à AGT** com certificado e "limite de emissão atual" por série; **lista de documentos rejeitados pela AGT**.

**Backoffice**: Documentos com Rascunhos, Avenças, Formação, Faturas por Liquidar, Rejeitados AGT; Talões de Desconto e Campanhas; Conta Corrente de clientes; relatórios por produto, variação, cliente, fornecedor, marca, categoria, loja, utilizador, diário, por hora, dia da semana, mensal, autoconsumo; contabilidade (listagem de documentos, mapa de impostos, vendas diárias, tipos de pagamento, mapa de impostos de fornecedores); compras (fornecedores, encomendas, faturas).

**Não verificado**: comportamento offline do POS (não se cortou a rede numa conta real).

## O que o Vendus anuncia
- POS: múltiplas vendas em simultâneo; vários tipos de pagamento e troco; leitor de códigos de barras; talão e A4, ESC/POS, Bluetooth, rede, etiquetas, gaveta; POS em ecrã inteiro; folha de fecho de caixa; movimentos por utilizador.
- Documentos: FT, FS, FR, NC (incl. parcial), pró-forma, orçamento, encomenda, consulta de mesa, guias, recibo; original/duplicado/triplicado; trocas e devoluções.
- SAF-T: exportação e envio automático mensal; configuração de fatura eletrónica AGT (detalhes técnicos não lidos).
- Stock por loja e armazém, variações, lotes de validade, custo médio, vendas sem stock configuráveis.
- Compras, fornecedores, conta corrente de clientes e fornecedores, avenças.
- Restauração: salas e mesas, pedidos e monitor de cozinha, terminais de pedidos, menus compostos, divisão de conta, várias impressoras.
- Multi-loja e multi-POS (cada um é subscrição adicional); utilizadores 2/5/ilimitados por plano.
- Relatórios: dashboard, mapa de impostos, vendas diárias, por tipo de pagamento, app Vendus Reports.
- Integrações: API (/ws/), Shopify, WooCommerce, SumUp e outras (várias só fazem sentido em Portugal).

## NÃO ENCONTRADO nas páginas públicas
Modo offline (o site diz "funciona 100% online"), suspensão de vendas explícita, pagamentos parciais explícitos, atalhos de teclado, delivery, séries por posto.

## Oportunidades para o Ndombaxi
1. **Offline real** é o diferencial principal em Angola, mas só vale se for fiável (corrigir B-01/B-02 primeiro).
2. Vendas suspensas e multi-carrinho persistentes (Vendus só anuncia vendas simultâneas).
3. Atalhos de teclado documentados no POS.
4. Verticais que o Ndombaxi já tem no código (hotel, clínica, farmácia, loja online, RH) — UNVERIFIED quanto à maturidade.

## Onde o Vendus parece à frente (a verificar no Ndombaxi)
Envio automático de SAF-T, NC parcial documentada, monitor de cozinha, lotes e validades, conta corrente de fornecedores, mapa de impostos, app de relatórios.
