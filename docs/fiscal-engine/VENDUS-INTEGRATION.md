# Integração Cegid Vendus

## Fontes usadas

| Fonte | O que confirma |
|---|---|
| https://www.vendus.co.ao/ws/ (Redoc) e a especificação `https://www.vendus.co.ao/ws/v1.1/api.jsonapi` (também `v1.0`, `v1.2`) | Endpoints, campos, autenticação, códigos HTTP. Consultadas a 21-11-2026 |
| https://www.vendus.co.ao/ajuda/implementar-api-vendus/ | A API KEY identifica o utilizador; obtém-se em **APPS → API**. Diz que a API "encontra-se na versão 1.1" |
| https://www.vendus.co.ao/ajuda/configuracao-fatura-eletronica-agt/ (16-01-2026) | Procedimento da Factura Electrónica (Cegid ID, certificados, séries, rejeitados) |
| SDK PHP oficial (github.com/vendus/vendus-sdk-php) | Exemplos de factura e nota de crédito |

O ficheiro `Texto colado.txt` referido na missão **não foi encontrado** na máquina.
Usou-se só a documentação oficial publicada.

## Versão da API

- Publicadas: **1.0, 1.1, 1.2**. Por omissão: **1.1** ("Current default version is: 1.1").
- **Usada: 1.1** (configurável no Super Admin para 1.0/1.2). A 1.2 tem mais recursos,
  mas o objecto `agt` do documento é igual nas duas.
- A versão vai no caminho: `https://www.vendus.co.ao/ws/v1.1/<recurso>/`.

## Endpoints usados

| Uso | Endpoint |
|---|---|
| Teste de ligação / monitorização | `GET /account/`, `GET /registers/`, `GET /registers/{id}/`, `GET /stores/` |
| Correspondência fiscal | `GET /taxes/`, `GET /taxes/exemptions/`, `GET /documents/paymentmethods/`, `GET /products/units/` |
| Clientes | `GET /clients/` (por `external_reference` e `fiscal_id`), `POST /clients/`, `PATCH /clients/{id}/` |
| Produtos | `GET /products/` (por `reference`), `POST /products/`, `PATCH /products/{id}/` |
| Emissão | `POST /documents/` (FT, FR, NC) |
| Reconciliação e consulta | `GET /documents/?external_reference=…&mode=…`, `GET /documents/{id}/` |
| PDF original | `GET /documents/{id}.pdf` ("just add .pdf extension to the document's id") |
| SAF-T | `GET /taxauthority/saft/?year=&month=` → `{year, month, xml(base64)}` |

## Correspondência de dados

| LPS | Vendus |
|---|---|
| Venda paga (`CASH`, `CARD`…) | `type: "FR"` (Factura-Recibo) |
| Venda a crédito | `type: "FT"` |
| `FS` do LPS | `FR` (FS não existe na FE da AGT) |
| Linha | `items[]`: `reference` = código do produto, `title`, `qty` (inteiro), `gross_price` = preço unitário **com** IVA, `tax_id`, `discount_percentage`, `tax_exemption` |
| Cliente com NIF válido | `client`: `fiscal_id`, `name`, `address`, `email`, `phone`, `country: "AO"`, `external_reference` = id LPS |
| Consumidor final | sem `client` (a especificação proíbe `999999990`) |
| Anulação / devolução | `type: "NC"`, `notes` = motivo, `items[].reference_document {document_number, document_row}` + `id` e `qty` |
| Formas de pagamento | `payments[] {id, amount}` só quando o Super Admin mapeou todas as formas usadas |

**Impostos:** só se aceita um `tax_id` da conta que seja de **Angola** (`country: "AO"`)
e com a **mesma taxa** do código LPS (NOR 14 %, INT 7 %, RED 5 %, ISE/OUT 0 %). O "NOR
23 % PT" da mesma conta é ignorado. Isenções: só códigos que existam em
`GET /taxes/exemptions/` da conta.

## Limitações encontradas na especificação

| Limitação | Efeito no LPS |
|---|---|
| `qty` é `integer` | Vendas com quantidades fraccionárias (kg) ficam em **CORRECCAO_NECESSARIA**, não se arredondam. A confirmar com a Cegid |
| `agt` só tem `document_number` e `qrcode_image` | O estado AGT não é legível pela API ([AGT-STATUS.md](AGT-STATUS.md)) |
| Semântica de `tx_id` repetido não documentada | Nunca se depende dela: antes de reenviar procura-se sempre por `external_reference` |
| Corpo de erro não documentado | Leitura tolerante (`errors[]`, `message`) com `errors_full: "yes"` |
| Lista de isenções da especificação é portuguesa (M01…M99) | Só se usam os códigos devolvidos pela conta de Angola |

## O que falta do teu lado

1. **Conta Vendus de cada empresa contribuinte** (o NIF da conta tem de ser o NIF da
   empresa no LPS).
2. No Backoffice Vendus da empresa: **Gestão → Factura Electrónica** → «Iniciar
   Processo» → criar o **Cegid ID** com o e-mail do administrador da conta →
   «Carregar Certificado» → no Cegid ID carregar a chave pública e a privada obtidas no
   **Portal do Contribuinte da AGT** (https://quiosqueagt.minfin.gov.ao/) → voltar ao
   Backoffice → «Carreguei Certificado». **As chaves nunca passam pelo LPS.**
3. No Backoffice Vendus: **APPS → API** → activar um utilizador técnico com permissão
   de emissão → copiar a **API KEY**.
4. No LPS: **Super Admin → Fiscal (AGT) → Software de terceiros** → escolher a empresa
   → colar a chave no campo **API KEY** → «Guardar API KEY» → «Testar ligação» →
   escolher a **Caixa Vendus** (de preferência a caixa do tipo API) e as formas de
   pagamento → «Guardar caixa e pagamentos» → marcar «Factura Electrónica configurada
   no Backoffice Vendus» → «Testar emissão (modo Formação)» → «Activar motor Vendus».
   **Nunca envies a chave pelo chat.**
5. **Validação do fornecedor:** no mesmo separador, preencher os dados da listagem AGT,
   carregar o PDF da listagem como comprovativo e indicar o responsável. Os dados
   oficiais encontrados estão em [FISCAL-CERTIFICATION.md](FISCAL-CERTIFICATION.md).
6. **Teste real controlado** (só depois de tudo acima): uma única venda real no POS da
   empresa, com a tua autorização explícita. Confirmar no Backoffice Vendus o estado
   AGT desse documento e guardar a evidência.
7. **Cegid:** pedir por escrito (a) o modelo de integração autorizado para um ERP que
   serve várias empresas, (b) a semântica de `tx_id`, (c) se `qty` aceita decimais,
   (d) uma forma suportada de ler o estado AGT pela API, (e) autorização de marca.
