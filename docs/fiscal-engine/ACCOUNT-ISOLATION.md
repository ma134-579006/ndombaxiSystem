# Isolamento de contas

- **Uma API KEY por empresa contribuinte.** A chave identifica o utilizador Vendus que
  emite ("All requests are associated with a specific user and permissions are limited
  to that user's capabilities"). Não existe chave global para várias empresas: um modelo
  diferente só com confirmação formal da Cegid.
- **O NIF da conta tem de ser o da empresa.** O teste de ligação compara
  `GET /account/.fiscal_id` com o NIF da empresa no LPS (normalizado). Se forem
  diferentes: `NIF_DIFERENTE` e a activação é recusada (cenário V-05).
- **A conta tem de ser de Angola.** `country` ≠ `AO` → `PAIS_DIFERENTE` (V-06a).
- **A monitorização repete a verificação.** Se a chave passar a pertencer a outra
  conta, o teste deixa de valer e a emissão fica suspensa até novo teste.
- **Trocar ou remover a chave** obriga a suspender o motor primeiro e invalida o teste
  de ligação e os testes de emissão.
- **Os documentos e o PDF** ficam no schema da própria empresa (tenant). A rota da
  empresa nunca devolve a chave nem a configuração interna (V-P2).
- **Os vínculos de clientes e produtos** são por empresa. O mesmo NIF de cliente noutra
  empresa é outro registo, noutra conta Vendus.
