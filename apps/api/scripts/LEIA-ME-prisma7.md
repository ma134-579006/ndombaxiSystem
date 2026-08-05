# Validar o Prisma 7 sem tocar na produção

A suíte da API (201/201) corre toda com *mocks* — não toca numa base de dados.
Depois da passagem do Prisma 5 para o 7, isso não chega: o que mudou foi
exatamente a camada que fala com a base. Esta receita exercita-a contra um
PostgreSQL **a sério**, usando os binários portáteis que já vão dentro do
instalador Windows.

## Levantar um PostgreSQL de teste

```bash
PG="apps/desktop/resources/pgsql/bin"
DADOS="/tmp/pgdata-prova"        # qualquer pasta descartável
printf 'prova7' > /tmp/pgpass.txt

"$PG/initdb.exe" -D "$DADOS" -U postgres --pwfile=/tmp/pgpass.txt --locale=C --encoding=UTF8
"$PG/pg_ctl.exe" -D "$DADOS" -l /tmp/pg.log -o "-p 55470 -c listen_addresses=127.0.0.1" start
```

> Se `apps/desktop/resources/pgsql` não existir, corra primeiro
> `pnpm --filter @nexus/desktop prepare:server` (ver `prepare-server.mjs`).

## Aplicar o esquema e provar

```bash
cd apps/api
DATABASE_URL="postgresql://postgres:prova7@127.0.0.1:55470/postgres" npx prisma db push
DATABASE_URL="postgresql://postgres:prova7@127.0.0.1:55470/postgres" node scripts/prova-prisma7-postgres.mjs
```

Esperado: **10/10**. Cobre o cliente gerado (CREATE/READ/UPDATE/DELETE), a chave
única imposta pela base, a `$transaction` interativa (é ela que emite faturas),
`$queryRaw` com `Prisma.sql` — e o que mais importa neste projeto: o
**provisionamento de uma empresa** (78 tabelas a partir de
`tenant_template.sql` + `tenant_migrations.sql`) e o `search_path` que isola
cada empresa.

## Parar e limpar

```bash
"$PG/pg_ctl.exe" -D "$DADOS" stop
rm -rf "$DADOS"
```

## ⚠️ Nunca contra produção

O `DATABASE_URL` desta receita aponta sempre para `127.0.0.1`. O `prisma db
push` altera o esquema — apontá-lo ao Aiven seria mexer na base de todas as
lojas.
