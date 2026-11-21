# Landing: identificação do software fiscal

## Apresentação (pedida pelo utilizador)

Secção `#facturacao-electronica`, antes das Perguntas Frequentes:

```
┌──────────────────────┐ ┌───────────────────────────────────────────────────────┐
│ LPS Vendas           │ │ FACTURAÇÃO ELECTRÓNICA                                │
│ ERP integrado        │ │ Cegid Vendus                                          │
│                      │ │ Motor externo de facturação electrónica utilizado     │
│                      │ │ através de integração API.                            │
│                      │ │ Produtor do software · Nº de validação AGT ·          │
│                      │ │ Certificado de Facturação Electrónica · Versão        │
│                      │ │ Site oficial Cegid Vendus                             │
└──────────────────────┘ └───────────────────────────────────────────────────────┘
O LPS Vendas é a plataforma de gestão empresarial. A emissão fiscal é executada pelo
software externo identificado, quando a integração se encontra activa e devidamente
configurada.
```

Em PT, EN, FR e ES. O produtor e os números vêm do registo do Super Admin (listagem AGT
com evidência), nunca de texto fixo. Ligação: https://www.vendus.co.ao/ (nome em texto,
sem logótipo, porque não há autorização de marca).

## Comportamento dinâmico (`GET /public/landing → fiscalEngine`)

| Situação | Landing |
|---|---|
| Vendus activo (switch ligado, validade CONFIRMADA, ≥ 1 empresa com motor efectivo Vendus) | Mostra a secção e o selo do topo diz «Facturação electrónica · Cegid Vendus» |
| Configurado mas não activo, validade pendente ou expirada, empresa suspensa | Secção escondida (V-LAND2) |
| LPS com validação própria confirmada (Modo B) | «Software Validado Nº …/AGT» com o emblema, separado do Vendus |
| Sem nada disto | Selo neutro «Faturação e SAF-T (AO)», **sem emblema da AGT** |

## Retirado (afirmações não comprovadas)

- Selo «Faturação certificada AGT» com o emblema da AGT no topo da landing.
- FAQ «A faturação é aceite pela AGT? — Sim…». Passou a «Quem emite o documento
  fiscal?», com a resposta factual.
- No registo de conta: «Faturação certificada AGT» passou a «Faturação e SAF-T (AO)».
- O nº de validação configurado em Fiscal → SAF-T só aparece na landing quando coincide
  com a validação **própria** confirmada do LPS.

Verificado no browser de 240 px a 1280 px: sem scroll lateral e sem elementos fora da
secção.
