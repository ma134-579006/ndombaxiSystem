# Chaves criptográficas

Há **três categorias distintas**, que nunca se confundem no código.

| | A. Chave do PRODUTOR do software (FE) | B. Credenciais da API (Basic) | C. Chave do CONTRIBUINTE (FE) | D. Chave Modelo 8 (Hash do SAF-T) |
|---|---|---|---|---|
| Para quê | `jwsSoftwareSignature` | Autenticação HTTP de cada pedido | `jwsDocumentSignature` e `jwsSignature` | Campo `Hash` do documento e do SAF-T (encadeado) |
| Quem gera | O produtor, localmente (`POST /super-admin/fiscal/einvoice/software-key`) | A AGT (pedido por e-mail) | A AGT (Portal do Contribuinte) | O produtor (`POST /super-admin/fiscal/agt/signing-key`) |
| Algoritmo | RSA ≥ 2048 (2048/3072/4096), RS256 | — | RSA ≥ 2048, RS256 | RSA-1024, SHA-1, PKCS#1 v1.5, base64 de 172 caracteres (ASSUMED, ver matriz R-KEY-04) |
| O que vai à AGT | Só a **pública** (PEM `BEGIN PUBLIC KEY`), no registo do software no Portal do Parceiro | — | Nada (a AGT já a tem) | Só a **pública** (`public.txt`, PEM), com a Declaração Modelo 8 |
| Onde fica | `integrations` (AGT_FE): privada cifrada (AES-256-GCM, `secret-box.ts`), pública em claro | Cifrada no mesmo segredo | `einvoice_companies.taxpayerKeyEnc`, cifrada | `integrations` (chave da plataforma), cifrada |
| Rotação | `signatureVersion` incrementa a cada nova chave; registar a nova pública no portal | Nova palavra-passe no painel | Carregar novo PEM | `keyVersion` + histórico; auditada (`AGT_SIGNING_KEY_ROTATED`) |

## O que o portal pede

O formulário do portal pede a chave em "PEM" ou "TEXT": escolher **PEM** e colar só a **chave pública**, de `-----BEGIN PUBLIC KEY-----` a `-----END PUBLIC KEY-----`. A privada **nunca** sai do servidor. O export (`GET …/software-key/export`, `GET …/agt/signing-key/export`) só devolve a pública.

## Garantias e evidências

| Garantia | Evidência |
|---|---|
| Assinatura válida com a chave certa | Testes A-9; `signature.spec.ts`; `fe.spec.ts` |
| Assinatura falha com os dados alterados | Testes A-9; `signature.spec.ts`; `fe.spec.ts` |
| Assinatura falha com outra chave | Testes A-9; `signature.spec.ts`; `fe.spec.ts` |
| A chave pública corresponde à privada | O simulador verifica cada JWS com a pública exportada (A-3 → B-3) |
| Nenhum endpoint devolve a privada | A-2, A-4, A-7 (respostas sem `PRIVATE KEY`) |
| Nem a palavra-passe Basic é devolvida | A-4 |
| Logs sem material secreto | I-4 (o log da API não contém `PRIVATE KEY` nem a palavra-passe) |
| Chave do contribuinte < 2048 bits é recusada | A-8 |
| Em produção subscrita à AGT, sem chave Modelo 8 válida, a emissão é recusada (503) | `invoice.service.ts requireSigningKey` |
| Falha de decifra é registada a ERRO | `platform-signing.service.ts` |
| Rotação e configuração ficam no trilho de auditoria da plataforma | `agt-config.controller.ts` |

## Limitações

- Uma única `CONFIG_ENCRYPTION_KEY` cifra todos os segredos (todas as empresas). Recomendação: KMS ou HSM, ou uma chave por inquilino; fica para decisão de infraestrutura.
- `GET /replication/pull?table=fiscal_signing_keys` (COMPANY_ADMIN) devolve a privada **cifrada** da chave por empresa (legado). Não está em claro, mas deve ser excluída.
- Não há revogação no portal a partir do sistema: é um procedimento manual no Portal do Parceiro.
