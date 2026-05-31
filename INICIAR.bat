@echo off
chcp 65001 >nul
title Ndombaxi System
cd /d "%~dp0"
echo ============================================================
echo    NDOMBAXI SYSTEM  -  arranque automatico (um clique)
echo    por Manuel Mbala Tomas Ndombaxi
echo ============================================================
echo.

where docker >nul 2>nul
if errorlevel 1 (
  echo [X] Docker nao encontrado.
  echo     Instale o Docker Desktop ^(uma so vez^):
  echo     https://www.docker.com/products/docker-desktop/
  start "" https://www.docker.com/products/docker-desktop/
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [X] pnpm nao encontrado. Instale o Node.js e depois: npm i -g pnpm
  start "" https://nodejs.org/
  pause
  exit /b 1
)

echo [1/6] A subir a base de dados ^(Postgres + Redis^)...
docker compose -f infra/docker/docker-compose.yml up -d postgres redis
if errorlevel 1 (
  echo [X] Falha ao subir o Docker. O Docker Desktop esta aberto?
  pause
  exit /b 1
)

echo [2/6] A aguardar a base de dados ficar pronta...
:waitdb
docker exec nexus_postgres pg_isready -U nexus -d nexus_erp >nul 2>nul
if errorlevel 1 ( timeout /t 2 >nul & goto waitdb )

echo [3/6] A instalar dependencias...
call pnpm install || (echo [X] Falha no pnpm install & pause & exit /b 1)

echo [4/6] A preparar o esquema da base de dados...
call pnpm db:push || (echo [X] Falha no db:push & pause & exit /b 1)

echo [5/6] A semear dados iniciais ^(Super Admin + planos^)...
call pnpm db:seed

echo [6/6] A iniciar a API e as aplicacoes...
start "Ndombaxi API"   cmd /k "pnpm api:dev"
start "Ndombaxi Caixa" cmd /k "pnpm --filter @nexus/pos dev"
start "Ndombaxi Loja"  cmd /k "pnpm --filter @nexus/store dev"
start "Ndombaxi Admin" cmd /k "pnpm --filter @nexus/web dev"

echo.
echo  PRONTO! As aplicacoes vao abrir em alguns segundos:
echo    API / Servidor : http://localhost:3000
echo    Caixa (POS)    : http://localhost:5173
echo    Loja online    : http://localhost:5174
echo    Painel Admin   : http://localhost:5175
echo.
echo  Super Admin:  admin@ndombaxi.ao  /  Ndombaxi!Admin2026
echo.
echo  (Para dados de demonstracao numa loja, corra:  pnpm demo)
echo.
timeout /t 10 >nul
start "" http://localhost:5175
exit /b 0
