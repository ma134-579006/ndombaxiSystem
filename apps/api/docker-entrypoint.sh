#!/bin/sh
# Arranque da API: espera a BD, cria/actualiza o esquema, semeia e inicia.
set -e
cd /repo/apps/api

echo "Ndombaxi API — a preparar a base de dados..."
until pnpm exec prisma db push --skip-generate; do
  echo "Base de dados ainda não pronta; nova tentativa em 3s..."
  sleep 3
done

echo "A semear dados iniciais (idempotente)..."
pnpm prisma:seed || echo "(seed ignorado)"

echo "A iniciar a API em http://0.0.0.0:3000 ..."
exec node dist/main.js
