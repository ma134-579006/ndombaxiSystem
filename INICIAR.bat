@echo off
chcp 65001 >nul
title Ndombaxi System
cd /d "%~dp0"
echo ============================================================
echo    NDOMBAXI SYSTEM  -  arranque automatico (um clique)
echo    por Manuel Mbala Tomas Ndombaxi
echo ============================================================
echo.

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [X] pnpm nao encontrado. Instale o Node.js 20+ e depois: npm i -g pnpm
  start "" https://nodejs.org/
  pause
  exit /b 1
)

REM Toda a logica (detetar BD na nuvem OU Docker local, instalar, esquema,
REM seed e arrancar as apps) vive no arranque inteligente multiplataforma.
node scripts\start.mjs
set EXITCODE=%errorlevel%

if not "%EXITCODE%"=="0" (
  echo.
  pause
)
exit /b %EXITCODE%
