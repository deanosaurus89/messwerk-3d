@echo off
rem MessWerk 3D starten: lokaler Webserver (PowerShell, keine Installation nötig) + Browser
cd /d "%~dp0"
if not exist "dist\index.html" (
  echo dist\ fehlt. Bitte zuerst "npm install" und "npm run build" ausfuehren.
  pause & exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "windows\server.ps1" -Port 8080
