@echo off
rem Double-click to start Aliquot on Windows. Keep this window open while the lab is using the system.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then run this file again.
  pause
  exit /b 1
)
start "" http://localhost:3000
node server.js
pause
