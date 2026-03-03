@echo off
REM Target Checkout Helper — Local Installer (Windows)
REM Extracts the extension and opens Chrome to the install page.

setlocal enabledelayedexpansion

echo.
echo   Target Checkout Helper - Installer
echo   -----------------------------------
echo.

set "SCRIPT_DIR=%~dp0"
set "EXT_ZIP=%SCRIPT_DIR%dist\target-checkout-helper.zip"
set "EXT_DIR=%SCRIPT_DIR%target-checkout-helper"

if exist "%EXT_DIR%\" (
    echo   [OK] Extension folder found at:
    echo        %EXT_DIR%
) else (
    if not exist "%EXT_ZIP%" (
        echo   [ERROR] Cannot find %EXT_ZIP%
        echo   Make sure you are running this from the repo root.
        pause
        exit /b 1
    )
    echo   Extracting extension...
    powershell -command "Expand-Archive -Force '%EXT_ZIP%' '%SCRIPT_DIR%'"
    echo   [OK] Extracted to %EXT_DIR%
)

echo.
echo   Next steps:
echo.
echo   1. Chrome will open to the Extensions page.
echo   2. Turn ON "Developer mode" (top-right toggle).
echo   3. Click "Load unpacked" and select:
echo.
echo      %EXT_DIR%
echo.
echo   4. Pin the extension, open the popup, and configure.
echo.

set /p OPEN_CHROME="  Open Chrome now? [Y/n] "
if /i "%OPEN_CHROME%"=="n" (
    echo   Skipped. Open chrome://extensions when ready.
    goto :done
)

REM Try common Chrome install locations
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
) else if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
)

if defined CHROME (
    start "" "%CHROME%" "chrome://extensions"
    echo   [OK] Chrome opened.
) else (
    echo   Could not find Chrome. Open chrome://extensions manually.
    start "" "chrome://extensions" 2>nul
)

:done
echo.

if exist "%SCRIPT_DIR%INSTALL.html" (
    echo   Tip: Open INSTALL.html for a visual step-by-step guide.
    echo.
)

echo   Done! Enjoy fast checkouts.
echo.
pause
