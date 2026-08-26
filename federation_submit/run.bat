@echo off
REM Double-click launcher (Windows) for the Federation calendar submission.
setlocal
cd /d "%~dp0"

echo === Federation calendar submission ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist node_modules\playwright (
  echo Installing Playwright ^(first run only^)...
  call npm install playwright@1.56.1
  if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
)

echo Making sure Chromium is installed...
call npx playwright install chromium

echo.
echo   1^) Test event #1 only   ^(do this first, confirm it worked^)
echo   2^) Run the full batch   ^(resumes automatically, skips anything already submitted^)
echo.
set /p choice="Choose 1 or 2: "

if "%choice%"=="1" (
  set "START_AT=1"
  set "STOP_AT=1"
)
node submit_events.js

echo.
pause
endlocal
