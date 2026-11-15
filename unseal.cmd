@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

REM Unseal app.asar: kill the host, move app.asar aside, relaunch.
REM Usage: just double-click. The host WILL be force-closed.

set "INSTALL=D:\软件\DeepSeek Harness"
set "EXE=%INSTALL%\DeepSeek Harness.exe"
set "RES=%INSTALL%\resources"
set "ASAR=%RES%\app.asar"
set "BAK=%RES%\app.asar.bak-unsealed"

echo ============================================================
echo  Unseal app.asar for dsh-purge (rc.3)
echo ============================================================
echo.

if not exist "%EXE%" (
  echo [ERROR] exe not found: %EXE%
  exit /b 2
)
if not exist "%RES%\app\lib\main.js" (
  echo [ERROR] resources\app\lib\main.js missing - host cannot start unpacked.
  echo         Aborting. Do NOT delete app.asar.
  exit /b 4
)

if not exist "%ASAR%" (
  echo [OK] app.asar already absent - nothing to move.
  goto :relaunch
)

echo [1/3] killing DeepSeek Harness...
taskkill /F /IM "DeepSeek Harness.exe" /T >nul 2>&1
timeout /t 3 /nobreak >nul
tasklist /FI "IMAGENAME eq DeepSeek Harness.exe" 2>nul | find /I "DeepSeek Harness.exe" >nul
if not errorlevel 1 (
  echo       warning: some processes survived, retrying once
  taskkill /F /IM "DeepSeek Harness.exe" /T >nul 2>&1
  timeout /t 3 /nobreak >nul
)

echo [2/3] moving app.asar aside...
if exist "%BAK%" del /F /Q "%BAK%" >nul 2>&1
move /Y "%ASAR%" "%BAK%" >nul 2>&1
if exist "%ASAR%" (
  echo [ERROR] move still failed - file locked. Quit the host fully first:
  echo         tray icon - Quit, then run this again.
  exit /b 3
)
echo       ok: app.asar -^> app.asar.bak-unsealed

echo [3/3] relaunching...
start "" "%EXE%"
echo.
echo DONE.
echo   Next: Settings - Purge - Apply, then restart once more so patches load.
echo   Undo: quit the host, move app.asar.bak-unsealed back to app.asar.
echo ============================================================
exit /b 0

:relaunch
echo Relaunching...
start "" "%EXE%"
exit /b 0
