@echo off
setlocal
cd /d "%~dp0"
node lib/stop.js
if errorlevel 1 pause
