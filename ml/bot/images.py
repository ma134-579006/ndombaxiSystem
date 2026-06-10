# -*- coding: utf-8 -*-
"""
GERADOR DE IMAGENS do bot — desenha guias visuais (SVG) com o design do
Ndombaxi System: cabeçalho com gradiente, passos numerados e mini-mockups.
Os SVG são gerados aqui (Python) e embebidos no conhecimento do bot; o chat
mostra-os como imagens nítidas em qualquer ecrã.
"""
from __future__ import annotations

from html import escape

# Paleta do design system
PRIMARY = "#2563eb"
VIOLET = "#7c3aed"
SUCCESS = "#10b981"
TEXT = "#0f1729"
MUTED = "#5a6679"
BORDER = "#e2e6ee"
SURFACE = "#f6f8fc"

W = 560
STEP_H = 64


def _step(i: int, y: int, title: str, sub: str) -> str:
    return f"""
  <g>
    <circle cx="46" cy="{y + 22}" r="17" fill="{PRIMARY}" />
    <text x="46" y="{y + 28}" text-anchor="middle" font-size="16" font-weight="800" fill="#fff">{i}</text>
    <text x="76" y="{y + 18}" font-size="15" font-weight="700" fill="{TEXT}">{escape(title)}</text>
    <text x="76" y="{y + 38}" font-size="12.5" fill="{MUTED}">{escape(sub)}</text>
    {f'<line x1="46" y1="{y + 41}" x2="46" y2="{y + STEP_H + 3}" stroke="{BORDER}" stroke-width="2.5" />' if True else ''}
  </g>"""


def guide_svg(title: str, subtitle: str, steps: list[tuple[str, str]], footer: str = "") -> str:
    body_h = 96 + len(steps) * STEP_H + (34 if footer else 14)
    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {body_h}" width="100%" '
        f'font-family="Segoe UI, DM Sans, Arial, sans-serif">',
        f'<defs><linearGradient id="hd" x1="0" y1="0" x2="1" y2="0">'
        f'<stop offset="0" stop-color="{PRIMARY}"/><stop offset="1" stop-color="{VIOLET}"/></linearGradient></defs>',
        f'<rect x="0.5" y="0.5" width="{W - 1}" height="{body_h - 1}" rx="18" fill="#fff" stroke="{BORDER}"/>',
        f'<path d="M 0.5 18 a 18 18 0 0 1 18 -17.5 h {W - 37} a 18 18 0 0 1 18 17.5 v 46 h -{W - 1} z" fill="url(#hd)"/>',
        f'<text x="26" y="34" font-size="17" font-weight="800" fill="#fff">{escape(title)}</text>',
        f'<text x="26" y="54" font-size="12.5" fill="#dbe6ff">{escape(subtitle)}</text>',
        f'<circle cx="{W - 38}" cy="32" r="14" fill="#ffffff22"/>'
        f'<text x="{W - 38}" y="37" text-anchor="middle" font-size="14" fill="#fff">🤖</text>',
    ]
    y = 86
    last = len(steps) - 1
    for i, (t, s) in enumerate(steps):
        block = _step(i + 1, y, t, s)
        if i == last:  # sem linha de ligação depois do último passo
            block = block.rsplit("<line", 1)[0] + "</g>"
        parts.append(block)
        y += STEP_H
    if footer:
        parts.append(
            f'<rect x="20" y="{y + 2}" width="{W - 40}" height="26" rx="13" fill="{SURFACE}" stroke="{BORDER}"/>'
            f'<text x="{W / 2}" y="{y + 19}" text-anchor="middle" font-size="11.5" fill="{SUCCESS}" font-weight="700">{escape(footer)}</text>'
        )
    parts.append("</svg>")
    return "".join(parts)


GUIDES: dict[str, str] = {
    "criar_conta": guide_svg(
        "Criar a conta da tua empresa",
        "ndombaxisystem.com — leva menos de 5 minutos",
        [
            ("Clica em «Criar conta»", "na página inicial do site"),
            ("Preenche os dados da empresa", "nome, NIF, código único e responsável"),
            ("Escolhe o plano", "vê o IBAN para a transferência"),
            ("Envia o comprovativo", "uma foto do talão chega"),
            ("Aprovação e acesso", "guarda a senha temporária que aparece"),
        ],
        "✓ Há teste grátis — começa hoje, sem cartão",
    ),
    "login_caixa": guide_svg(
        "Entrar no caixa (operador)",
        "caixa.ndombaxisystem.com — sem email, só nome + PIN",
        [
            ("Código da empresa", "ex.: o código que o gestor te deu"),
            ("Toca no teu NOME", "na grelha de operadores"),
            ("Digita o PIN (6 dígitos)", "definido pelo gestor em Funcionários"),
        ],
        "✓ Funciona offline — sincroniza quando a internet voltar",
    ),
    "vender_caixa": guide_svg(
        "Fazer uma venda no caixa",
        "fatura certificada AGT em segundos",
        [
            ("Abre o turno", "com o fundo de caixa inicial"),
            ("Adiciona produtos", "toque, pesquisa ou scanner da câmara 📷"),
            ("«Finalizar venda»", "confere o total com IVA"),
            ("Escolhe o pagamento", "dinheiro, multibanco, transferência…"),
            ("Recibo sai na hora", "térmica 80/58mm ou A4 — com QR AGT"),
        ],
        "✓ Cancelamentos emitem nota de crédito e repõem o stock",
    ),
    "entrada_stock": guide_svg(
        "Dar entrada de stock",
        "Painel → Inventário → Entrada de stock",
        [
            ("Escolhe produto e loja", "ou «todas as lojas» (stock partilhado)"),
            ("Quantidade + custo total", "o sistema calcula custo unitário e lucro"),
            ("Lote e validade (opcional)", "para alertas e controlo FEFO"),
            ("Confirma", "preço atualiza e fica tudo na auditoria"),
        ],
        "✓ Define o stock mínimo para receberes alertas de reposição",
    ),
    "folha_salarial": guide_svg(
        "Processar a folha salarial",
        "INSS + IRT calculados automaticamente",
        [
            ("Folha Salarial → Processar", "escolhe mês e ano"),
            ("Cálculo automático", "INSS 3% + 8% empresa, IRT por escalões"),
            ("Faltas e bónus entram sós", "1 dia de falta = salário base ÷ 30"),
            ("«Marcar paga»", "lança a despesa no fluxo de caixa e lucro"),
        ],
        "✓ Imprime em A4 profissional com o logotipo da empresa",
    ),
    "relatorios": guide_svg(
        "Tirar relatórios",
        "Painel → Relatórios — com gráficos em tempo real",
        [
            ("Escolhe a vista", "produto, utilizador, loja, IVA, evolução…"),
            ("Filtra datas e loja", "o gráfico e a tabela atualizam na hora"),
            ("Exporta ou imprime", "CSV/Excel, e-mail ou A4 com logotipo"),
        ],
        "✓ O Mapa de IVA e o SAF-T ficam prontos para a AGT",
    ),
}
