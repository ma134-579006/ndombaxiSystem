# Provar que o servidor local arranca

Os binários do PostgreSQL **não estão no repositório** (≈120 MB depois de
podados). Para correr a prova:

1. Descarregar os binários portáteis (Windows x64):
   `https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip`
2. Extrair **apenas** `pgsql/bin`, `pgsql/lib` e `pgsql/share` para uma pasta
   qualquer — o resto (`doc/`, `include/`, pgAdmin) é a maior parte do peso e
   não serve num posto de venda. 323 MB de zip → **120 MB** só com o preciso.
3. Compilar e correr:

```bash
pnpm --filter @nexus/local-server build
NDOMBAXI_PG_ROOT=/caminho/para/a/pasta node apps/local-server/scripts/prova-arranque.cjs
```

`NDOMBAXI_PG_ROOT` é a pasta que **contém** `pgsql/bin`.
`NDOMBAXI_PG_TEST_DIR` (opcional) escolhe onde fica o cluster de teste.

O script cria o cluster do zero, verifica as garantias de que a camada fiscal
depende (ordenação `C`, base fechada à rede, índices únicos parciais), confirma
que o 2.º arranque não recria nem perde dados, gera uma cópia de segurança e
**encerra o cluster no fim** — não deixa um PostgreSQL a correr na máquina.

## Porque é que isto existe

Todo o `apps/local-server` compilava mas nunca tinha corrido, o que é o mesmo
que não saber se funciona. A primeira execução real encontrou **duas avarias que
teriam impedido a aplicação de abrir** em qualquer instalação nova — ambas no
`start()`, ambas invisíveis à compilação e aos tipos. Ver o comentário nessa
função.
