#!/usr/bin/env bash
# Ndombaxi System — arranque automático (um clique) · Manuel Mbala Tomás Ndombaxi
set -e
cd "$(dirname "$0")"

echo "============================================================"
echo "   NDOMBAXI SYSTEM — arranque automático"
echo "============================================================"

command -v docker >/dev/null 2>&1 || {
  echo "[X] Docker não encontrado. Instale o Docker Desktop: https://www.docker.com/products/docker-desktop/"
  exit 1
}
command -v pnpm >/dev/null 2>&1 || {
  echo "[X] pnpm não encontrado. Instale o Node.js (https://nodejs.org/) e: npm i -g pnpm"
  exit 1
}

echo "[1/6] A subir a base de dados (Postgres + Redis)..."
docker compose -f infra/docker/docker-compose.yml up -d postgres redis

echo "[2/6] A aguardar a base de dados..."
until docker exec nexus_postgres pg_isready -U nexus -d nexus_erp >/dev/null 2>&1; do sleep 2; done

echo "[3/6] A instalar dependências..."
pnpm install

echo "[4/6] A preparar o esquema da base de dados..."
pnpm db:push

echo "[5/6] A semear dados iniciais..."
pnpm db:seed

echo "[6/6] A iniciar API + aplicações..."
echo "   API:   http://localhost:3000"
echo "   Caixa: http://localhost:5173   Loja: http://localhost:5174   Admin: http://localhost:5175"
echo "   Super Admin: admin@ndombaxi.ao / Ndombaxi!Admin2026"
echo "   (dados de demonstração: pnpm demo)"

pnpm api:dev &
pnpm --filter @nexus/pos dev &
pnpm --filter @nexus/store dev &
pnpm --filter @nexus/web dev &
wait
