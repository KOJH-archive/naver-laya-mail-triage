@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-app.ps1"
if errorlevel 1 (
  echo.
  echo Startup failed. Check the message above, then press any key to close.
  pause >nul
)
