@echo off
setlocal ENABLEDELAYEDEXPANSION

REM Registers the IMAP native messaging host for Chrome (current user).
REM 1. npm install in target-checkout-helper\native-host\
REM 2. Copy com.tch.imapbridge.json.example to com.tch.imapbridge.json and edit path + extension ID
REM 3. Run this script from an elevated OR normal prompt (HKCU is fine)

set "ROOT=%~dp0..\target-checkout-helper\native-host"
set "MANIFEST=%ROOT%\com.tch.imapbridge.json"

if not exist "%MANIFEST%" (
  echo ERROR: Missing "%MANIFEST%"
  echo Copy com.tch.imapbridge.json.example to com.tch.imapbridge.json and fill in path + chrome-extension ID.
  exit /b 1
)

set "REGKEY=HKCU\Software\Google\Chrome\NativeMessagingHosts\com.tch.imapbridge"
reg add "%REGKEY%" /ve /t REG_SZ /d "%MANIFEST%" /f
if errorlevel 1 (
  echo Failed to write registry key.
  exit /b 1
)

echo OK — registered NativeMessagingHosts for com.tch.imapbridge
echo Manifest: %MANIFEST%
exit /b 0
