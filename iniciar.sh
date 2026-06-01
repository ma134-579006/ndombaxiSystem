#!/usr/bin/env bash
# Ndombaxi System — arranque automático (um clique) · Manuel Mbala Tomás Ndombaxi
cd "$(dirname "$0")"

echo "============================================================"
echo "   NDOMBAXI SYSTEM — arranque automático"
echo "============================================================"

command -v pnpm >/dev/null 2>&1 || {
  echo "[X] pnpm não encontrado. Instale o Node.js 20+ (https://nodejs.org/) e: npm i -g pnpm"
  exit 1
}

# Toda a lógica (detetar BD na nuvem OU Docker local, instalar, esquema, seed
# e arrancar as apps) vive no arranque inteligente multiplataforma.
exec node scripts/start.mjs
