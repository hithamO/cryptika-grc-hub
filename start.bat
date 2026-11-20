@echo off
setlocal
title Cryptika GRC Hub
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed on this computer.
  echo  Install the LTS version from https://nodejs.org  ^(or run:  winget install OpenJS.NodeJS.LTS^)
  echo  then double-click start.bat again.
  echo.
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo.
  echo  Cryptika GRC Hub needs Node.js 22.13 or newer. Installed version:
  node -v
  echo  Install the current LTS version from https://nodejs.org and start again.
  echo.
  pause
  exit /b 1
)

echo.
echo  Starting Cryptika GRC Hub. The first start loads the control library and takes a few seconds.
echo  Keep this window open while you use the system. Close it to stop the server.
echo.
start "" /min cmd /c "timeout /t 7 /nobreak >nul & start http://localhost:4000"
node --no-warnings server/index.js
echo.
echo  The server has stopped.
pause
