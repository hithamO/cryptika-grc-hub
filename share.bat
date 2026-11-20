@echo off
setlocal
title Cryptika GRC Hub - shared
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Run start.bat first and follow its instructions.
  echo.
  pause
  exit /b 1
)

echo.
echo  Share Cryptika GRC Hub
echo  ----------------------
echo  Nothing is copied or sent: other people open the system that runs on this computer.
echo  It stays reachable only while this window is open.
echo.
echo   [1] Office network  -  for people on the same network or VPN
echo   [2] Secure link     -  a temporary https link that works from anywhere
echo.
echo  Before you share: close the start.bat window if it is open, and make sure every
echo  person has an account with a password of their own. First-run passwords do not
echo  work for anyone who is not sitting at this computer.
echo.
choice /c 12 /n /m "  Type 1 or 2: "
if errorlevel 2 goto link

:lan
set HOST=0.0.0.0
echo.
echo  Give people one of these addresses:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=*" %%b in ("%%a") do echo     http://%%b:4000
echo.
echo  If Windows asks, allow Node.js on private networks. Close this window to stop sharing.
echo.
node --no-warnings server/index.js
goto end

:link
if not exist tools\cloudflared.exe (
  echo.
  echo  Downloading the Cloudflare tunnel client ^(one time, about 60 MB^)...
  curl -L --fail --progress-bar -o tools\cloudflared.exe https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
  if errorlevel 1 (
    del tools\cloudflared.exe >nul 2>nul
    echo.
    echo  The download did not finish. Check the internet connection and try again.
    pause
    exit /b 1
  )
)
echo.
echo  Starting the system...
start "Cryptika GRC Hub - server" /min cmd /c "node --no-warnings server/index.js"
timeout /t 6 /nobreak >nul
echo.
echo  Your link appears below in a few seconds. It looks like
echo      https://some-random-words.trycloudflare.com
echo  Send that link to the person, and their sign-in name and password separately.
echo  The link changes every time you run this file. Close this window to stop sharing.
echo.
tools\cloudflared.exe tunnel --no-autoupdate --url http://127.0.0.1:4000
taskkill /fi "WINDOWTITLE eq Cryptika GRC Hub - server*" /t /f >nul 2>nul

:end
echo.
echo  Sharing has stopped.
pause
