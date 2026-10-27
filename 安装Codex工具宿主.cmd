@echo off
setlocal
cd /d "%~dp0"
set "SRC=%USERPROFILE%\.codex\plugins\.plugin-appserver\codex-code-mode-host.exe"
set "DST=%USERPROFILE%\.codex\.sandbox-bin\codex-code-mode-host.exe"
echo Installing Codex imagegen tool host...
if not exist "%SRC%" (
  echo [ERROR] Source not found:
  echo   %SRC%
  echo Make sure Codex Desktop is installed.
  pause
  exit /b 1
)
if exist "%DST%" (
  echo Already installed: %DST%
  pause
  exit /b 0
)
copy /Y "%SRC%" "%DST%" >nul
if errorlevel 1 (
  echo.
  echo [ERROR] Copy failed. Run this file as Administrator, or copy manually:
  echo   from %SRC%
  echo   to   %DST%
  pause
  exit /b 1
)
echo Done: %DST%
echo Restart the Workbench (启动工作台.cmd), then try auto generation again.
pause
