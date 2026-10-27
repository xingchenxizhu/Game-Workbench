@echo off
setlocal
cd /d "%~dp0"
title AI Game Workbench
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  echo Install Node.js 22.18 or newer, then reopen this window.
  pause
  exit /b 1
)
if not exist "node_modules\react\package.json" (
  echo [ERROR] Dependencies missing.
  echo Run: npm install
  pause
  exit /b 1
)
if not exist "lib\standalone.js" (
  echo [ERROR] Build output missing.
  echo Run: npm run build
  pause
  exit /b 1
)
netstat -ano | findstr ":4173" | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo Port 4173 is busy. Trying to stop the old service...
  call "%~dp0stop-old-service.cmd"
  timeout /t 2 >nul
)
echo Starting AI Game Workbench...
echo The browser will open when the server is ready.
echo Close this window to stop the server.
echo.
node lib\launch.js
if errorlevel 1 pause
