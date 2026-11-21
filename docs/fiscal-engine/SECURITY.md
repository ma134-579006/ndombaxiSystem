# Segurança

## API KEY

- **Nunca pelo chat nem pelo URL.** É introduzida no campo seguro do Super Admin
  (`type=password`, `autocomplete=new-password`).
- **Cifrada em repouso** com AES-256-GCM (`common/crypto/secret-box.ts`), com a chave
  derivada de `CONFIG_ENCRYPTION_KEY`. Só a máscara (`••••••••abcd`) é devolvida
  (V-03, V-P2).
- **Enviada só no cabeçalho** `Authorization: Bearer`. A especificação permite
  `?api_key=`, que **não é usado**: o simulador assinala qualquer chave no URL e o
  cenário V-P3 confirma que nunca aconteceu.
- Não aparece na auditoria nem no log da API (V-P3). A auditoria regista só a máscara.
- **Chave exposta na missão:** o exemplo enviado pelo utilizador tinha uma API KEY num
  URL. Essa chave **não foi usada nem copiada** para o código, a documentação ou o
  `.env.example`. Recomenda-se **revogá-la no Backoffice Vendus** (APPS → API) e gerar
  outra.

## Certificados fiscais do contribuinte

Ficam **no Cegid ID / Vendus**. O LPS não os pede nem os guarda.

## Permissões (verificadas no backend)

| Papel | Pode |
|---|---|
| Super Admin | Tudo do motor: switch, validade, evidências, chaves, testes, activar, suspender, mudar de motor |
| Administrador da empresa | Ver o estado da própria ligação, documentos, PDF, reenviar, sincronizar, SAF-T do Vendus |
| Gerente de loja | Ver o estado e os documentos |
| Caixa | Emitir (pelo motor efectivo), abrir o PDF original da venda |
| Ninguém | Marcar um documento como aceite pela AGT |

## Auditoria (`nexus_public.audit_logs`)

`FISCAL_ENGINE_SETTINGS_UPDATED` (antes e depois), `FISCAL_ENGINE_LPS_VALIDATION_UPDATED`,
`FISCAL_ENGINE_EVIDENCE_UPLOADED` (SHA-256), `FISCAL_ENGINE_API_KEY_SET` / `_REMOVED`,
`FISCAL_ENGINE_CONNECTION_TESTED`, `FISCAL_ENGINE_COMPANY_CONFIGURED`,
`FISCAL_ENGINE_TESTS_RUN`, `FISCAL_ENGINE_ACTIVATED`, `FISCAL_ENGINE_SUSPENDED`,
`FISCAL_ENGINE_SWITCHED_TO_LPS`, `FISCAL_ENGINE_HEALTH_FAILED`,
`FISCAL_ENGINE_VALIDITY_ALERT`.

## Integridade do documento original

O PDF é guardado tal como chegou (`bytea`), com o SHA-256. Antes de o servir, o hash é
recalculado: se não coincidir, devolve 409 em vez de entregar um ficheiro alterado.

## Evidências

Só PDF, PNG ou JPEG até 5 MB, e o conteúdo tem de corresponder ao tipo (assinatura do
ficheiro). Ficam guardadas com SHA-256 e com quem as carregou.
