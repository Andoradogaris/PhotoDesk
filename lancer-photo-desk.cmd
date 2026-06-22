@echo off
setlocal
cd /d "%~dp0"
set "LOG=%TEMP%\photo-desk-launch.log"
call npm.cmd run desktop > "%LOG%" 2>&1
if errorlevel 1 (
  start "" notepad.exe "%LOG%"
  exit /b 1
)
