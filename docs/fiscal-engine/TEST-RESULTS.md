# Resultados dos testes (21-11-2026)

> Todos os testes da integração correram contra o **simulador local**
> (`qa/vendus-mock.mjs`, que segue a especificação OpenAPI oficial) e a base de QA
> local (127.0.0.1:55433). **Não houve chamadas à API real do Vendus nem documentos
> reais.** O modo Formação/Testes do Vendus e o simulador **não** são validação da AGT.

## Resumo

| Suite | Resultado |
|---|---|
| `apps/api` jest, todas as suites (inclui `fiscal-engine.spec.ts` com 35 testes) | **364/364** |
| `qa/vendus-motor.mjs`: cenários ponta a ponta do motor Vendus | **56/56** |
| `qa/fiscal-emissao.mjs`: regressão da emissão LPS | 14/14 |
| `qa/fiscal-imutabilidade.mjs`: regressão da imutabilidade na BD | 14/14 |
| `qa/agt-fe-simulacao.mjs`: regressão da FE própria | 30/30 |
| `apps/api` `tsc --noEmit` | sem erros |
| `apps/pos` `tsc --noEmit` | sem erros |
| `apps/web` `vite build` | passa (os erros de `tsc` no web já existiam na `main` e nenhum vem dos ficheiros novos) |
| Verificação visual (browser): Super Admin → Software de terceiros | 0 elementos fora dos cartões em 240, 375, 1280 e 7680 px |
| Verificação visual: landing `#facturacao-electronica` | sem scroll lateral em 240 e 1280 px |
| Verificação visual: empresa → Fiscal · SAF-T → Motor fiscal | 0 elementos fora do cartão; conteúdo confirmado |

## Testes 1–20 da missão → cenários

| # | Teste | Cenário(s) | Resultado |
|---|---|---|---|
| 1 | Abrir o Super Admin e ver a opção | V-01 + browser | ✅ |
| 2 | Guardar configurações | V-02a…g | ✅ |
| 3 | API KEY de testes | V-03 | ✅ guardada cifrada, só máscara |
| 4 | Autenticação | V-04 | ✅ chave errada → credenciais inválidas |
| 5 | Consultar a conta | V-05, V-06b | ✅ |
| 6 | Validar NIF e país | V-05, V-06a, V-06b | ✅ |
| 7 | Lojas e caixas | V-07 | ✅ |
| 8 | Caixa API | V-08a, V-08b | ✅ subscrição inactiva detectada |
| 9 | Consultar clientes | V-09 | ✅ |
| 10 | Sincronizar clientes | V-09, V-10 | ✅ sem duplicados (também com o vínculo perdido) |
| 11 | Sincronizar produtos | V-11 | ✅ sem duplicados, só impostos AO |
| 12 | Documento em modo testes | V-12 | ✅ `mode: tests` |
| 13 | Consultar o documento | V-13, V-E5 | ✅ |
| 14 | Descarregar o PDF | V-14, V-E4 | ✅ original, sem alterações |
| 15 | Duplicação / `tx_id` | V-15a, V-15b | ✅ um só documento |
| 16 | Timeout | V-16a…d | ✅ reconciliação sem segundo POST |
| 17 | Rejeição simulada | V-17 | ✅ `CORRECCAO_NECESSARIA` com motivo |
| 18 | Credenciais inválidas → suspensão | V-18, V-18b | ✅ 503 sem fallback; reposição |
| 19 | Validade expirada | V-19a…d | ✅ bloqueio sem contorno; renovação só com evidência |
| 20 | Nenhum motor válido | V-20a, V-20b | ✅ sem números fictícios |

Também: V-E1…E3 (emissão no POS, registo VND, estado pendente AGT), V-NC1…3 (notas de
crédito), V-SAFT/V-SAFT2, V-LAND1/2 (landing dinâmica), V-P1…P4 (permissões, chave fora
de URL, auditoria e logs, alterações auditadas).

## Testes unitários (`fiscal-engine.spec.ts`)

Validade (confirmada, pendente sem data ou evidência, último dia, expiração), alertas
30/15/7/0, motor efectivo (expirado, chave, subscrição, NIF, switch, legado, suspensão),
indicadores, estado AGT nunca deduzido de HTTP/PDF/hash/QR, corpo do documento (FR/FT,
consumidor final, imposto sem correspondência, isenção, quantidade fraccionária, NC),
cliente HTTP (Bearer sem chave no URL, versão no caminho, classificação 401/403/422/429/5xx,
timeout, PDF inválido, versão não publicada).

## Teste real controlado (produção, Loja da Mulher, 21–22/11/2026)

Feito com autorização explícita do utilizador para cada documento.

| Passo | LPS | Vendus | Resultado |
|---|---|---|---|
| Testes em modo Formação | 3 documentos de teste | FR T02P2026/1, /2, /3 (sem validade fiscal) | ✅ PDF devolvido (#232) |
| Venda real (1 × 100% Algodão, 1.000 Kz, Numerário) | FT VND2026/0001 | **FR 02P2026/1** | ✅ depois de #234 (NIF do contribuinte no envio) e #235 (IVA 0% → ISE) |
| Venda feita pelo operador | FT VND2026/0002 | FR 02P2026/2 (1.850 Kz) | ✅ |
| Anulação total na caixa (gerente/admin) | NC VND2026/0001 | **NC 02P2026/1**, «Referente ao documento FR 02P2026/1» | ✅ mesmo valor, motivo e referência externa; venda «Anulada» no LPS |
| PDF original | guardado sem alterações (≈96 KB) | — | ✅ |
| Comunicação à AGT | «Comunicação AGT pendente» | «Pendente comunicação — certificado FE não carregado» | ⚠️ depende do contribuinte corrigir o certificado no Vendus |

Também verificado: selo «Vendus · Facturação certificada» na barra do painel e da caixa (#233);
uma única emissão por venda (reenvio com reconciliação por `external_reference`).

## Como repetir

```
# API de QA com o simulador
VENDUS_BASE_URL=http://127.0.0.1:3997/ws VENDUS_TIMEOUT_MS=3000 FISCAL_ENGINE_SCHEDULER=off  (no env de QA)
bash qa/restart-api.sh
node qa/vendus-motor.mjs
```
