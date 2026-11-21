# SAF-T (AO)

## Facturação: implementado e validado (SalesInvoices)

**Esquema**
- Versão 1.01_01, namespace `urn:OECD:StandardAuditFile-Tax:AO_1.01_01`, UTF-8.
- XSD em `packages/agt-xml/xsd/SAFTAO1.01_01.xsd`. Fonte: cópia da assoft-portugal, apresentada como "Official XSD from the Government of Angola". **O URL oficial da AGT para o XSD não foi encontrado (UNVERIFIED).** Substituir pelo ficheiro oficial assim que a AGT o disponibilize.

**Estrutura gerada**
- **Header:** inclui `ProductCompanyTaxID` = NIF do **produtor** (configurado no Super Admin).
- **MasterFiles:** Customer com o nome **da emissão**, Product e TaxTable.
- **SourceDocuments/SalesInvoices:** FT, FR, NC e ND, com Hash/HashControl, References das NC e isenções com `TaxExemptionCode`.

**Validação**
1. **Estrutural:** `validateSaftXsd()`, com libxml2 em WebAssembly (o mesmo motor do `xmllint --schema`).
2. **Semântica:** `validateSaftSemantics()`. Regras:

| Regra | O que verifica |
|---|---|
| S01 | Duplicados |
| S02 | Padrão do número |
| S03 | Buracos na sequência |
| S04 | Data fora de ordem |
| S05 | Data inválida |
| S06 | Data fora do período |
| S07 | NIF |
| S08 | Documento sem linhas |
| S09 | NetTotal |
| S10 | TaxPayable |
| S11 | GrossTotal |
| S12 | IVA da linha |
| S13 | Taxa 0% sem código de isenção |
| S14 | Quantidade |
| S15 | NC sem origem |
| S16 | Origem fora do ficheiro (aviso) |
| S17 | Sem hash |

3. **Relatório:** `GET /pos/saft/validate?year&month` (COMPANY_ADMIN). Devolve:
   - os problemas do XSD (linha e mensagem);
   - os problemas de conteúdo (documento, regra e causa);
   - a configuração em falta (NIF do produtor, nº de validação "0").

**Prazo:** mensal, até ao último dia do mês seguinte (DP 312/18, art. 3.º; comunicado AGT de 04-03-2020). O ficheiro exporta-se por mês, e um ficheiro já produzido não é alterado retroactivamente: é gerado de novo a partir de documentos imutáveis.

**Em falta**
- **Payments:** os recibos (RC) não entram no SAF-T e não têm assinatura.
- **WorkingDocuments e MovementOfGoods:** não exportados (orçamentos e guias não são documentos fiscais no sistema).

**Testes**
- `xsd.spec.ts`: ficheiro FT + FR + NC + isenção válido.
- `xsd-negative.spec.ts`: 7 casos de XSD inválido e 12 de semântica.
- Na API real: E-11/E-12 (`qa/fiscal-emissao.mjs`) e X-1…X-7 (`qa/agt.mjs`).

## Contabilidade: NÃO IMPLEMENTADO

- O sistema tem registos comerciais (vendas, despesas, contas a receber e a pagar, fluxo de caixa). **Não tem contabilidade:** não há plano de contas, diários, lançamentos a débito e crédito nem saldos por conta.
- Gerar um SAF-T de Contabilidade a partir disto seria inventar lançamentos. Não foi feito.
- **Prazo legal:** exercício anterior até 10 de Abril (DP 71/25, art. 24.º, n.º 1, al. e).
- **Opções:** integrar com o software de contabilidade do cliente (exportar as vendas para ele) ou construir um módulo contabilístico (projecto à parte).

## Inventário: BLOQUEADO (especificação)

- **Prazo legal:** existências a 31/12, entregues até 15 de Fevereiro (DP 71/25, art. 24.º, n.º 1, al. d).
- A API da FE lista os serviços `comunicarInventario` e `submeterInventario`, mas **os campos não estão publicados**.
- O XSD do SAF-T (AO) 1.01_01 não tem uma secção de inventário equivalente à de outros países.
- O módulo de stock (existências por loja, movimentos, contagens) tem os dados de base. O ficheiro só se implementa quando o formato oficial for conhecido.
