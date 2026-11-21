# Certificação do fornecedor (Cegid Vendus)

> Evidência consultada a 21-11-2026. **Não foi gravada na base de dados**: o Super Admin
> regista-a em Fiscal (AGT) → Software de terceiros → Validação AGT do fornecedor,
> carregando o PDF da listagem como comprovativo. Até lá o estado fica **PENDENTE** e
> o motor externo não liga.

## 1. Programa validado (regime anterior, DP 312/18)

- Fonte: listagem da AGT "programas validados até a data 21-02-2025" (27 páginas),
  https://www.ucm.minfin.gov.ao/cs/groups/public/documents/document/aw40/njuy/~edisp/minfin4652428.pdf
- Linha 106: **142/AGT/2019 · PRIMAVERA- BUSINESS SOFTWARE SOLUTIONS, LDA · Vendus ·
  versão 1 · Válido 16/12/2026**.
- Histórico: na listagem de 2019 (http://www.ucm.minfin.gov.ao/cs/groups/public/documents/document/zmlu/odc4/~edisp/minfin878630.pdf)
  o mesmo número aparecia em nome de outro titular (VENDUS 1.0). O registo passou
  depois para a Primavera.
- Não foi encontrada listagem deste tipo mais recente.

## 2. Software certificado para a Facturação Electrónica (DP 71/25)

- Fonte: "Lista de Softwares Certificados" da AGT (metadados de 04-11-2026; vai até FE/424/AGT/2026),
  https://www.ucm.minfin.gov.ao/cs/groups/public/documents/document/aw43/mte2/~edisp/minfin7116197.pdf
- Linha: **NIF 5401153236 · PRIMAVERA- BUSINESS SOFTWARE SOLUTIONS, LDA · VENDUS ·
  FE/105/AGT/2025 · versão 1.0**.
- A lista de Dezembro de 2025 (https://www.ucm.minfin.gov.ao/cs/groups/public/documents/document/aw41/mtq5/~edisp/minfin5149551.pdf)
  ainda não tinha o Vendus. Entrou depois.

## 3. Prorrogação

Não foi encontrada comunicação da Cegid/Primavera sobre prorrogação dos certificados
em Angola que mencione o Vendus. **Não se assume** que a validade de 16/12/2026 foi
prorrogada. Se a Cegid enviar documentação, carrega-se como nova evidência.

## 4. Divergências a esclarecer

- Os termos do site vendus.co.ao dizem que a empresa responsável pelo software é a
  «Nexperience Lda». As listagens da AGT indicam a PRIMAVERA. Para a identificação
  pública conta a listagem da AGT.
- O site do Vendus mostra «Software Validado Nº 142/AGT», sem ano nem validade.
- **Data de validade do certificado FE/105/AGT/2025:** a lista não a indica. A única
  data oficial encontrada é a de 16/12/2026, que é do nº 142/AGT/2019.

## 5. O que fica no sistema

| Campo | Valor a registar (pelo Super Admin, com evidência) |
|---|---|
| Produtor | PRIMAVERA- BUSINESS SOFTWARE SOLUTIONS, LDA |
| Software | Vendus |
| Número de validação | 142/AGT/2019 |
| Certificado de Facturação Electrónica | FE/105/AGT/2025 |
| Versão | 1 (programa validado) / 1.0 (FE) |
| Validade | 16/12/2026 (do nº 142/AGT/2019) |
| Fonte oficial | URL da listagem + PDF carregado |

**Atenção:** com 16/12/2026 a validade termina **25 dias** depois desta verificação.
Os alertas de 30/15/7/0 dias disparam já, e a partir de 17/12/2026 a emissão pelo
Vendus **bloqueia** até haver evidência de renovação.
