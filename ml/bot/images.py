# -*- coding: utf-8 -*-
"""
GUIAS VISUAIS do bot — SCREENSHOTS REAIS do sistema com marcações exatas
(círculos numerados nos botões/campos certos), capturados das próprias
páginas e publicados em /guides/ no site principal (apps/web/public/guides).

A captura e anotação é feita por scripts/capture-guides.mjs (puppeteer +
overlay de marcações injetado na página antes do screenshot).

O conhecimento do bot guarda apenas o URL relativo; o chat (que vive no
mesmo domínio) mostra a imagem com <img>. Regenerar os screenshots sempre
que o design destas páginas mudar e correr de novo o train.py.
"""
from __future__ import annotations

# intenção → URL relativo do screenshot anotado (servido pelo site principal)
GUIDES: dict[str, str] = {
    "criar_conta": "/guides/criar-conta.png",
    "login_caixa": "/guides/login-caixa.png",
    "vender_caixa": "/guides/vender-caixa.png",
    "entrada_stock": "/guides/entrada-stock.png",
    "folha_salarial": "/guides/folha-salarial.png",
    "relatorios": "/guides/relatorios.png",
    "criar_produto": "/guides/criar-produto.png",
    "loja_online": "/guides/loja-online.png",
}
