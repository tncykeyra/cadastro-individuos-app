@echo off
setlocal
cd /d "%~dp0"
title Cadastro de Individuos - Teste React

echo ================================================
echo   CADASTRO DE INDIVIDUOS - PREVIA REACT
echo ================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao foi encontrado neste computador.
  echo Instale a versao LTS em https://nodejs.org/
  echo Depois feche e abra este arquivo novamente.
  echo.
  pause
  exit /b 1
)
echo Informe os dados publicos do projeto Supabase.
echo Use somente chave Publishable ou anon. Nunca use service_role.
echo.
set /p "SUPABASE_URL=Project URL: "
set /p "SUPABASE_KEY=Chave publica: "
if "%SUPABASE_URL%"=="" (echo URL nao informada.& pause & exit /b 1)
if "%SUPABASE_KEY%"=="" (echo Chave nao informada.& pause & exit /b 1)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$u=$env:SUPABASE_URL; $k=$env:SUPABASE_KEY; @('VITE_SUPABASE_URL='+$u,'VITE_SUPABASE_ANON_KEY='+$k) | Set-Content -LiteralPath '.env.local' -Encoding ascii"
if errorlevel 1 (echo Nao foi possivel criar .env.local.& pause & exit /b 1)
if not exist node_modules (
  echo Instalando dependencias. Aguarde...
  call npm install
  if errorlevel 1 (echo Falha ao instalar dependencias.& pause & exit /b 1)
)
echo.
echo Iniciando a previa React...
echo Para encerrar, pressione Ctrl+C nesta janela.

call npm run dev
pause