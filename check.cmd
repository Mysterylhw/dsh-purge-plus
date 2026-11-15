@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM dsh-purge self-check entry. Double-click after a DSH release.
REM   check.cmd          -> drift check only (fast, ~5s)
REM   check.cmd full     -> drift + patches + links + unit tests
REM   check.cmd compat   -> clean-tree compat-check (slow, ~1min)
REM Edit DSH_INSTALL below if your client is elsewhere.

set "DSH_INSTALL=D:\软件\DeepSeek Harness"
set "APP_DIR=%DSH_INSTALL%\resources\app"
set "ASAR=%DSH_INSTALL%\resources\app.asar.bak"

if not exist "%APP_DIR%" (
  echo [ERROR] not found: %APP_DIR%
  echo         Edit DSH_INSTALL in this file.
  exit /b 2
)

set "MODE=%~1"
if "%MODE%"=="" set "MODE=drift"

if /i "%MODE%"=="compat" goto :compat
if /i "%MODE%"=="full" goto :full
goto :drift

:drift
echo [1/1] drift-check
echo ------------------------------------------------------------
node scripts\drift-check.mjs --app "%APP_DIR%"
set "RC=!ERRORLEVEL!"
goto :report

:full
echo [1/4] check-patches
echo ------------------------------------------------------------
node scripts\check-patches.mjs
set "RC1=!ERRORLEVEL!"
echo.
echo [2/4] check-links
echo ------------------------------------------------------------
node scripts\check-links.mjs
set "RC2=!ERRORLEVEL!"
echo.
echo [3/4] gate.mjs
echo ------------------------------------------------------------
node test\gate.mjs
set "RC3=!ERRORLEVEL!"
echo.
echo [4/4] drift-check
echo ------------------------------------------------------------
node scripts\drift-check.mjs --app "%APP_DIR%"
set "RC4=!ERRORLEVEL!"
echo.
echo ============================================================
echo  patches=!RC1!  links=!RC2!  gate=!RC3!  drift=!RC4!
echo  (0 = pass, non-zero = problem)
echo ============================================================
set "RC=!RC1!"
if not "!RC2!"=="0" set "RC=!RC2!"
if not "!RC3!"=="0" set "RC=!RC3!"
if not "!RC4!"=="0" set "RC=!RC4!"
goto :report

:compat
if not exist "%ASAR%" (
  echo [ERROR] not found: %ASAR%
  echo         Need the unpatched package for a clean-tree run.
  exit /b 2
)
echo [1/1] compat-check on clean tree
echo ------------------------------------------------------------
node scripts\compat-check.mjs --asar "%ASAR%" --surface desktop
set "RC=!ERRORLEVEL!"
goto :report

:report
echo.
if not exist "docs" mkdir "docs"

REM ASCII timestamp so the log stays readable regardless of console codepage.
set "TS=unknown"
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value 2^>nul') do (
  if not defined DTLINE set "DTLINE=%%I"
)
if defined DTLINE (
  set "TS=!DTLINE:~0,4!-!DTLINE:~4,2!-!DTLINE:~6,2! !DTLINE:~8,2!:!DTLINE:~10,2!:!DTLINE:~12,2!"
)

>> "docs\drift-log.txt" echo !TS! mode=!MODE! rc=!RC!
echo log appended to docs\drift-log.txt  [!TS!]
if "!RC!"=="0" (
  echo RESULT: PASS
) else (
  echo RESULT: FAIL - see the list above
)
echo.
pause
exit /b !RC!
