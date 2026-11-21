# Monitorização da validade e da integração

## Validade da validação AGT do fornecedor

Estado calculado em `providerValidity()` (`fiscal-engine.policy.ts`), nunca guardado
como booleano:

| Estado | Condição |
|---|---|
| **CONFIRMADO** | Produtor, software, nº, versão, data de validade, evidência (PDF carregado **ou** URL https oficial), data e responsável da verificação |
| **PENDENTE** | Falta algum dos dados acima. A data de validade nunca se assume |
| **EXPIRADO** | Hoje (hora de Luanda) já passou da data de validade. No próprio dia ainda vale |

**Renovação:** mudar a data de validade ou o número exige **nova evidência** (outro
ficheiro ou outro URL) e o responsável. A data da verificação fica automaticamente
com o momento do registo (cenários V-19c e V-19d).

**Não há contorno:** o motor efectivo é calculado a cada emissão. Com a validade
expirada a emissão pelo Vendus fica bloqueada mesmo com o switch ligado, e não é
possível voltar a ligá-lo (V-19a e V-19b).

## Alertas

- Limiares configuráveis no Super Admin. Por omissão **30, 15, 7 e 0 dias**.
- O agendador (60 s) regista na auditoria `FISCAL_ENGINE_VALIDITY_ALERT` **uma vez
  por limiar** e por data de validade (o limiar mais próximo já atingido) e escreve no
  log da API.
- O Super Admin vê um aviso no topo do separador ("vence dentro de N dias",
  "vence hoje", "expirada há N dias").

## Monitorização da ligação (a cada 30 min, e «Verificar agora»)

| Classe da missão | Detecção | Efeito |
|---|---|---|
| A. API KEY inválida | HTTP 401 em `GET /account/` → `CHAVE_INVALIDA` | Teste invalidado → emissão suspensa |
| B. Plano/subscrição inactivo | `subscription_active` ≠ yes na caixa, ou 403 com texto de subscrição → `SUBSCRICAO_INACTIVA` | Emissão suspensa |
| C. Validação AGT expirada | `providerValidity` = EXPIRADO | Emissão suspensa |
| D. Falha temporária da API | 5xx, timeout, rede → `INDISPONIVEL`/`TIMEOUT`/`REDE` | A venda fica registada; o documento fica na fila e repete com backoff (30 s → 30 min) |
| E. AGT indisponível | **Não detectável pela API Vendus** (o Vendus comunica à AGT por conta própria) | Documento em `COMUNICACAO_AGT_PENDENTE` |
| F. Configuração fiscal incompleta | Falta caixa, imposto AO, isenção, confirmação FE → indicadores e `CORRECCAO_NECESSARIA` | Activação recusada ou documento parado com o motivo |

Também: conta da chave passou a ser de outro NIF → `NIF_DIFERENTE` → suspensão.

Cada falha grave fica na auditoria (`FISCAL_ENGINE_HEALTH_FAILED`) e em
`fiscal_engine_companies.health`.
