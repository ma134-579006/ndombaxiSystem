# -*- coding: utf-8 -*-
"""
CORPUS de treino do bot — o conhecimento TOTAL do Ndombaxi System.

Cada intenção tem: exemplos (frases de treino pt-PT/Angola), resposta
profissional e, quando ajuda, uma IMAGEM instrutiva (gerada em images.py).
O bot NUNCA acede à base de dados — só sabe o que está aqui.
"""

INTENTS: list[dict] = [
    {
        "id": "saudacao",
        "examples": [
            "ola", "bom dia", "boa tarde", "boa noite", "oi", "hey", "tudo bem",
            "ola preciso de ajuda", "alguem ai", "boas",
        ],
        "answer": "Olá! 👋 Bem-vindo ao Ndombaxi System. Posso ensinar-te a criar conta, vender no caixa, gerir stock, processar salários, tirar relatórios e muito mais. O que precisas?",
    },
    {
        "id": "falar_humano",
        "examples": [
            "quero falar com um humano", "chama um atendente", "quero falar com uma pessoa",
            "fala com o administrador", "quero apoio humano", "chama o super admin",
            "quero falar com a equipa", "atendimento humano por favor", "passa para um operador",
            "preciso falar com alguem real", "chama um responsavel", "quero um agente",
        ],
        "answer": "Com certeza! 🔔 Já chamei a nossa equipa — o Super Admin vai responder-te aqui mesmo nesta conversa, em breve. Enquanto esperas, posso ir adiantando alguma dúvida?",
        "escalate": True,
    },
    {
        "id": "criar_conta",
        "examples": [
            "como crio uma conta", "como criar conta para a minha empresa", "quero registar a empresa",
            "como me registo", "abrir conta", "como faco o registo", "criar conta de empresa",
            "como comeco a usar o sistema", "quero aderir", "registar empresa nova",
        ],
        "answer": "Criar a conta da tua empresa é simples:\n1. Vai a https://ndombaxisystem.com e clica em **Criar conta**.\n2. Preenche os dados da empresa (nome, NIF, código único, responsável).\n3. Escolhe o plano e vê o IBAN para a transferência.\n4. Envia o comprovativo (foto/imagem) ali mesmo.\n5. A nossa equipa aprova e recebes acesso — há **teste grátis** para começares já!\nA senha temporária aparece no fim do registo (guarda-a).",
        "image": "criar_conta",
    },
    {
        "id": "precos_planos",
        "examples": [
            "quanto custa", "quais sao os planos", "qual e o preco", "valores do sistema",
            "planos e precos", "quanto pago por mes", "preciso saber os precos", "e caro",
            "tem plano gratis", "quanto e a mensalidade",
        ],
        "answer": "Os planos estão sempre atualizados na página inicial (https://ndombaxisystem.com), em **Kwanzas**, com a duração e os limites de cada um (lojas, utilizadores, produtos). Há **teste grátis sem cartão**. O pagamento é por transferência bancária com envio do comprovativo — a ativação é feita pela nossa equipa. Para condições especiais, posso chamar a equipa comercial — é só pedires.",
    },
    {
        "id": "login_gestor",
        "examples": [
            "como entro no painel", "nao consigo fazer login", "como faco login como gestor",
            "esqueci a senha", "entrar na conta da empresa", "login do administrador",
            "como acedo ao painel de gestao", "senha errada nao entra", "recuperar palavra passe",
        ],
        "answer": "Para entrar no painel do gestor:\n1. Vai a https://ndombaxisystem.com e clica **Entrar**.\n2. Escolhe o perfil **Gestor**.\n3. Indica o **código da empresa**, o teu **email** e a **palavra-passe** (ou usa o botão Google).\nSe esqueceste a senha, o administrador da empresa pode repô-la em **Configurações → equipa**. Se és o administrador e perdeste o acesso, pede aqui para falar com a equipa.",
    },
    {
        "id": "login_caixa",
        "examples": [
            "como entro no caixa", "login do operador de caixa", "como funciona o pin",
            "o operador nao aparece na caixa", "entrar na caixa pin", "abrir o pos",
            "como o funcionario entra na caixa", "caixa pede pin qual e",
        ],
        "answer": "No caixa (https://caixa.ndombaxisystem.com) o operador entra SEM email:\n1. Indica o **código da empresa**.\n2. **Toca no seu nome** na lista de operadores.\n3. Digita o **PIN de 6 dígitos**.\nO PIN é definido pelo gestor em **Funcionários → Dar acesso ao sistema** (ou Editar). Se o nome não aparece, o funcionário ainda não tem PIN definido.",
        "image": "login_caixa",
    },
    {
        "id": "vender_caixa",
        "examples": [
            "como faco uma venda", "como vender no caixa", "como passo produtos no pos",
            "como cobrar um cliente", "fazer venda rapida", "como emitir fatura na caixa",
            "como uso o leitor de codigo de barras", "venda com scanner",
        ],
        "answer": "Vender no caixa é rápido:\n1. **Abre o turno** (botão no topo) com o fundo de caixa.\n2. Toca nos produtos ou usa o **scanner da câmara** 📷 (lê o código de barras).\n3. Confere o carrinho e toca **Finalizar venda**.\n4. Escolhe o método (dinheiro, multibanco, transferência…) e confirma — sai a **fatura certificada AGT** com QR.\nO recibo imprime em térmica 80mm/58mm ou A4. Funciona **offline** — sincroniza quando a internet voltar.",
        "image": "vender_caixa",
    },
    {
        "id": "cancelar_venda",
        "examples": [
            "como cancelo uma venda", "anular fatura", "cliente devolveu o produto",
            "como faco devolucao", "estornar venda", "nota de credito como emitir",
        ],
        "answer": "Para cancelar/devolver: no caixa, abre **Vendas** (histórico), encontra o documento e usa **Cancelar** — o sistema emite a **nota de crédito (NC)** legal, repõe o stock e ajusta o financeiro automaticamente. Tudo fica na auditoria.",
    },
    {
        "id": "entrada_stock",
        "examples": [
            "como dou entrada de stock", "chegou mercadoria como registo", "entrada de produtos",
            "como adiciono stock", "comprei mercadoria onde lanco", "repor stock",
            "como registar compra de mercadoria", "dar entrada no inventario",
        ],
        "answer": "Entrada de stock (painel do gestor → **Inventário → Entrada de stock**):\n1. Escolhe o produto e a loja.\n2. Indica a **quantidade** e o **custo total pago** — o sistema calcula o custo unitário e o **lucro automático**.\n3. (Opcional) lote + validade para controlo FEFO, e stock mínimo para alertas.\n4. Confirma — o preço/custo do produto atualizam e fica tudo na auditoria.",
        "image": "entrada_stock",
    },
    {
        "id": "contagem_inventario",
        "examples": [
            "como faco contagem de inventario", "conferir stock fisico", "inventario anual",
            "contagem ciclica", "como conto o stock", "ajustar stock real",
        ],
        "answer": "Contagem de inventário (Inventário → **Nova contagem**):\n1. Escolhe a loja — o sistema cria a folha com o stock do sistema.\n2. Conta fisicamente e preenche cada produto (podes **pesquisar por nome/código** ou usar o **scanner da câmara**).\n3. As divergências ficam destacadas; **Fechar contagem** aplica os ajustes.\n4. Imprime o relatório de perdas (a custo) em A4 profissional.",
    },
    {
        "id": "validade_lotes",
        "examples": [
            "como controlo validades", "produtos a expirar", "lotes com data de validade",
            "fefo como funciona", "alerta de produtos vencidos", "baixa por caducidade",
        ],
        "answer": "O controlo de validades é automático: indica o **lote + validade** na Entrada de stock. Em **Inventário → Lotes & validade** vês o que expira em 60 dias e o que já expirou, com botão **Baixa** (por caducidade, auditada). A venda de produtos com lote expirado é bloqueada no caixa.",
    },
    {
        "id": "transferir_stock",
        "examples": [
            "como transfiro stock entre lojas", "mover produtos para outra loja",
            "transferencia de mercadoria", "enviar stock para a filial",
        ],
        "answer": "Em **Inventário → Transferir entre lojas**: escolhe o produto, a loja de origem, a de destino e a quantidade. O total da empresa não muda — só a distribuição — e fica registado na auditoria com guia.",
    },
    {
        "id": "criar_produto",
        "examples": [
            "como crio um produto", "adicionar artigo novo", "cadastrar produto",
            "como ponho o codigo de barras", "criar produto com foto", "novo produto na loja",
        ],
        "answer": "Criar produto (painel → **Produtos → Novo**):\n1. O **código é o código de barras** — usa o scanner 📷 para ler direto da embalagem.\n2. Nome, preço de venda, IVA (14%, 7%, 5%, isento) e foto.\n3. Escolhe as lojas onde existe e o stock inicial.\n4. Liga **Mostrar online** para aparecer na loja da internet.\nO motivo de isenção aparece automaticamente quando o IVA é isento/não sujeito.",
    },
    {
        "id": "loja_online",
        "examples": [
            "como funciona a loja online", "os clientes podem comprar pela internet",
            "ativar loja virtual", "ecommerce do sistema", "vender online", "site da minha loja",
            "como o cliente compra online",
        ],
        "answer": "Cada empresa tem a sua loja online em https://loja.ndombaxisystem.com (com o teu código). Os produtos com **Mostrar online** aparecem com foto e stock em tempo real. O cliente **cria conta**, compra (transferência/referência/Express), acompanha a encomenda e fala contigo pelo chat. Tu geres tudo em **Encomendas** no painel.",
    },
    {
        "id": "folha_salarial",
        "examples": [
            "como processo salarios", "folha salarial como funciona", "calcular inss e irt",
            "pagar funcionarios", "processar folha do mes", "salario liquido como calcula",
        ],
        "answer": "Folha salarial (painel → **Folha Salarial → Processar folha**):\n1. Escolhe mês/ano — o sistema calcula tudo: **INSS 3%** (trabalhador) + **8%** (empresa) e **IRT** por escalões, por funcionário.\n2. Bónus entram como subsídio sujeito; **faltas descontam automaticamente** (1 dia = salário base ÷ 30).\n3. **Marcar paga** lança a despesa SALARIOS no fluxo de caixa e no lucro.\nImprime a folha em A4 profissional com o logotipo da empresa.",
        "image": "folha_salarial",
    },
    {
        "id": "faltas_desconto",
        "examples": [
            "como desconto faltas", "funcionario faltou como registar", "desconto por falta no salario",
            "registar faltas do mes", "faltas injustificadas desconto",
        ],
        "answer": "Em **Funcionários → Editar**, preenche **Faltas no mês (dias)**. O sistema aplica a regra laboral: cada dia desconta o **salário diário (base ÷ 30)** — vês logo a pré-visualização do valor. Ao processar a folha, o desconto entra automaticamente no líquido.",
    },
    {
        "id": "funcionarios_acesso",
        "examples": [
            "como crio funcionarios", "dar acesso ao sistema a um funcionario",
            "adicionar operador de caixa", "criar utilizador para a equipa", "definir pin do funcionario",
            "papeis e permissoes",
        ],
        "answer": "Em **Funcionários**: cria a ficha (nome, função, salário, foto) e usa **Dar acesso ao sistema** para criar o login — escolhe o **papel** (admin, gerente de loja, operador de caixa…) e define o **PIN de 6 dígitos** para a caixa. Cada papel tem permissões diferentes (RBAC de 7 níveis).",
    },
    {
        "id": "relatorios",
        "examples": [
            "que relatorios tem", "relatorio de vendas", "ver vendas por produto",
            "relatorio de iva", "exportar para excel", "relatorio por funcionario",
            "mapa de vendas mensal", "relatorios graficos",
        ],
        "answer": "O centro de **Relatórios** tem: por produto, por utilizador, por loja, por categoria, por marca, evolução temporal, **Mapa de IVA**, métodos de pagamento, documentos e fechos de caixa — todos com **gráficos em tempo real** (colunas, rosca, área), filtro de datas/loja, **CSV/Excel** e **impressão A4 profissional** com o logotipo e NIF da empresa.",
        "image": "relatorios",
    },
    {
        "id": "imprimir",
        "examples": [
            "como imprimo recibo", "impressora termica configuracao", "imprimir em a4",
            "recibo de 80mm", "mudar tamanho do papel", "imprimir relatorio",
        ],
        "answer": "Impressões:\n• **Caixa**: recibos em térmica **80mm ou 58mm** (muda no botão de papel do recibo) ou A4.\n• **Painel**: qualquer página/relatório imprime em **A4 estilo profissional** — com logotipo, NIF, título, data e rodapé da empresa — pelo botão 🖨 ou Ctrl+P.",
    },
    {
        "id": "saft_agt",
        "examples": [
            "como tiro o saft", "ficheiro para a agt", "exportar saft mensal",
            "o sistema e certificado agt", "faturas legais agt", "validacao fiscal",
        ],
        "answer": "Sim — a faturação segue as regras da **AGT** (séries, hash encadeado, QR). Para o ficheiro mensal: painel → **Fiscal · SAF-T**, escolhe mês/ano e descarrega o **XML AuditFile** pronto a entregar.",
    },
    {
        "id": "auditoria",
        "examples": [
            "o que fica na auditoria", "ver quem fez o que", "registo de operacoes",
            "auditoria do caixa", "historico de acoes dos funcionarios",
        ],
        "answer": "Em **Caixa & Auditoria** fica TUDO registado com data e **nome do funcionário**: vendas, cancelamentos, entradas e baixas de stock, transferências, turnos, contagens… O registo é **imutável** (cadeia de hash estilo blockchain) — ninguém consegue apagar ou alterar.",
    },
    {
        "id": "subscricao_pagamento",
        "examples": [
            "como pago a subscricao", "enviar comprovativo", "renovar o plano",
            "mudar de plano", "a minha conta expirou", "pagamento por transferencia iban",
        ],
        "answer": "Em **Subscrição & Plano** (painel do gestor): escolhe o plano, transfere para o **IBAN** indicado e **envia o comprovativo** (imagem) ali mesmo — podes também conversar com a nossa equipa nessa página. A ativação acontece após aprovação. Podes trocar de plano a qualquer momento.",
    },
    {
        "id": "multi_loja",
        "examples": [
            "posso ter varias lojas", "como adiciono outra loja", "multi loja como funciona",
            "abrir filial no sistema", "gerir duas lojas",
        ],
        "answer": "Sim! Em **Lojas da empresa** crias as lojas filhas (conforme o teu plano). Cada loja tem o seu stock, os seus operadores e os seus números; os relatórios filtram por loja e o stock transfere-se entre lojas em segundos.",
    },
    {
        "id": "temas_design",
        "examples": [
            "como mudo o tema", "modo escuro", "mudar cores do sistema", "tema claro",
            "aparencia do painel", "dark mode",
        ],
        "answer": "No topo do painel/caixa há o **seletor de temas**: Claro (padrão), **Profissional**, **Apple Dark**, Meia-noite, Néon e mais. O tema fica ligado à TUA conta — em qualquer aparelho entras e está como deixaste.",
    },
    {
        "id": "seguranca",
        "examples": [
            "o sistema e seguro", "tem dois fatores", "seguranca dos dados",
            "quem ve os meus dados", "protecao de dados", "2fa como ativo",
        ],
        "answer": "Segurança a sério: cada empresa tem os dados **isolados** (schema próprio), RBAC de 7 níveis, **2FA opcional**, auditoria imutável, sessões que expiram por inatividade (15 min) — e o teu trabalho é restaurado quando voltas a entrar. O nosso bot (eu! 🤖) **não tem acesso à base de dados**.",
    },
    {
        "id": "offline",
        "examples": [
            "funciona sem internet", "a net caiu posso vender", "modo offline do caixa",
            "internet fraca funciona",
        ],
        "answer": "Sim — o **caixa funciona offline**: continuas a vender e os documentos ficam em fila; quando a internet volta, sincroniza tudo sozinho (vês o estado no topo do caixa). O painel de gestão precisa de internet.",
    },
    {
        "id": "encomendas_chat",
        "examples": [
            "como vejo as encomendas online", "responder ao cliente da loja",
            "chat com clientes", "gerir pedidos da internet",
        ],
        "answer": "Em **Encomendas** (painel) vês cada pedido online com estado (pendente → pago → enviado → entregue), itens e cliente — e tens **chat integrado** para falar com ele. Se a tua equipa estiver offline, a IA responde por ti.",
    },
    {
        "id": "financas",
        "examples": [
            "controlar gastos", "contas a pagar e receber", "fluxo de caixa", "ver lucro",
            "margem de lucro por produto", "comissoes de vendedores", "conciliacao bancaria",
        ],
        "answer": "O módulo financeiro é completo: **Gastos** por categoria, **Contas a Receber/Pagar** com vencimentos, **Fluxo de Caixa** com previsão a 30 dias, **Lucro & Margens** (com curva ABC dos produtos), **Comissões** por vendedor e **Reconciliação bancária** por CSV do extrato.",
    },
    {
        "id": "bot_capacidades",
        "examples": [
            "o que sabes fazer", "quem es tu", "es um robo", "como funcionas",
            "es uma ia", "ajudas em que",
        ],
        "answer": "Sou a IA de suporte do Ndombaxi System 🤖 — fui treinada com o funcionamento completo do sistema (caixa, stock, salários, relatórios, loja online…) e até **desenho guias visuais** para te orientar. Não tenho acesso à base de dados — os teus dados são só teus. Se quiseres um humano, é só pedir!",
    },
    {
        "id": "agradecimento",
        "examples": [
            "obrigado", "obrigada", "muito obrigado", "valeu", "agradecido", "thanks", "top obrigado",
        ],
        "answer": "De nada! 😊 Sempre às ordens. Se precisares de mais alguma coisa — caixa, stock, salários, relatórios — é só perguntar.",
    },
    {
        "id": "despedida",
        "examples": [
            "tchau", "adeus", "ate logo", "ja volto", "vou sair", "bye",
        ],
        "answer": "Até já! 👋 Quando precisares, estou aqui na bolinha azul. Bom trabalho com o Ndombaxi System!",
    },
]
