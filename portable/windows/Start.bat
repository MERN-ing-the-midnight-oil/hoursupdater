@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ============================================================
rem  Teamster Tracker — portable Windows launcher
rem  Keep this window open while you use the app.
rem ============================================================

cd /d "%~dp0"
title Teamster Tracker

echo.
echo ============================================
echo   Teamster Tracker
echo ============================================
echo.
echo Working folder:
echo   %CD%
echo.

set "NODE_EXE=%CD%\runtime\node.exe"
set "APP_DIR=%CD%\app"
set "ENV_FILE=%CD%\.env"
set "URL=http://localhost:3847"

rem Portable package: load .env from this folder (next to Start.bat)
set "ENV_FILE=%ENV_FILE%"

rem --- 1) Bundled Node present? (AV sometimes quarantines node.exe from the zip)
if not exist "%NODE_EXE%" (
  echo *** PROBLEM: Bundled Node was not found ***
  echo.
  echo Expected file:
  echo   %NODE_EXE%
  echo.
  echo This often means antivirus quarantined a file when you unzipped the
  echo package, or the zip was incomplete.
  echo.
  echo What to try:
  echo   1. Look in your antivirus "quarantine" / "protection history" and
  echo      restore node.exe if it was blocked
  echo   2. Re-download / re-unzip the package
  echo   3. See TROUBLESHOOTING.md — "Nothing happens / flash and close"
  echo      and "Windows protected your PC"
  echo.
  goto :fail
)

echo Checking bundled Node...
"%NODE_EXE%" -e "process.exit(0)" >nul 2>nul
if errorlevel 1 (
  echo *** PROBLEM: Bundled Node cannot run ***
  echo.
  echo Found:
  echo   %NODE_EXE%
  echo but Windows would not execute it.
  echo.
  echo This is usually SmartScreen, antivirus, or IT application control —
  echo not a problem with your OneDrive data.
  echo.
  echo See TROUBLESHOOTING.md:
  echo   - "Windows protected your PC" ^(SmartScreen^)
  echo   - "This app has been blocked by your administrator"
  echo.
  goto :fail
)

for /f "delims=" %%V in ('"%NODE_EXE%" -v') do set "NODE_VER=%%V"
echo   OK — Node %NODE_VER%
echo.

if not exist "%APP_DIR%\src\server.js" (
  echo *** PROBLEM: App files are missing ***
  echo.
  echo Expected:
  echo   %APP_DIR%\src\server.js
  echo.
  echo The package may be incomplete. Re-unzip the full Teamster Tracker folder.
  echo.
  goto :fail
)

if not exist "%ENV_FILE%" (
  echo *** PROBLEM: .env file is missing ***
  echo.
  echo Expected:
  echo   %ENV_FILE%
  echo.
  echo Copy .env.example to .env in this folder, then follow SETUP-ONEDRIVE.md
  echo to set DATA_DIR to your OneDrive RouteChangeTracker path.
  echo.
  goto :fail
)

echo Checking OneDrive data folder ^(DATA_DIR^)...
set "PREFLIGHT_LOG=%TEMP%\teamster-tracker-preflight.log"
"%NODE_EXE%" "%APP_DIR%\scripts\portable-preflight.js" > "%PREFLIGHT_LOG%" 2>&1
set "PREFLIGHT_EXIT=!ERRORLEVEL!"
type "%PREFLIGHT_LOG%"
if not "!PREFLIGHT_EXIT!"=="0" (
  echo.
  echo Fix the issue above, then double-click Start.bat again.
  echo Full steps: SETUP-ONEDRIVE.md
  echo More help:  TROUBLESHOOTING.md
  echo.
  goto :fail
)

for /f "usebackq tokens=1,* delims==" %%A in ("%PREFLIGHT_LOG%") do (
  if /i "%%A"=="PREFLIGHT_URL" set "URL=%%B"
)
echo.

echo Starting Teamster Tracker...
echo.
echo When it is ready you should see:
echo   Teamster Tracker listening on !URL!
echo.
echo If your browser does not open by itself, paste this into Edge:
echo.
echo   !URL!
echo.
echo Leave this window open while you use the app.
echo Close this window ^(or press Ctrl+C^) to stop the app.
echo.

rem Open the browser shortly after the server begins listening
start "" cmd /c "timeout /t 2 /nobreak >nul && start !URL!"

"%NODE_EXE%" "%APP_DIR%\src\server.js"
set "EXIT_CODE=!ERRORLEVEL!"

echo.
if not "!EXIT_CODE!"=="0" (
  echo *** Teamster Tracker stopped with an error ^(code !EXIT_CODE!^) ***
  echo.
  echo Read any message above. Common fixes are in TROUBLESHOOTING.md
  echo ^(browser error / can't reach the page, DATA_DIR problems, port in use^).
  echo.
) else (
  echo Teamster Tracker has stopped.
  echo.
)

pause
exit /b !EXIT_CODE!

:fail
echo.
pause
exit /b 1
