@echo off
rem SHMMOTH Browser - sign and publish the newest draft release (scripts\release-publish.js).
rem Drag release-signing-key.pem onto this file, or double-click it when the key lies next to it.
rem The key stays on this PC: it is only read to sign, never uploaded or shown.
cd /d "%~dp0"
where node >/dev/null 2>/dev/null || (echo Node.js is not installed: https://nodejs.org & pause & exit /b 1)
node scripts\release-publish.js %*
echo.
pause
