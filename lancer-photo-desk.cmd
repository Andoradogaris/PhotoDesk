@echo off
setlocal
cd /d "%~dp0"
set "LOG=%TEMP%\photo-desk-launch.log"
set "PACKAGED_APP=%~dp0dist\win-unpacked\Photo Desk.exe"
set "ELECTRON_APP=%~dp0node_modules\electron\dist\electron.exe"

if exist "%PACKAGED_APP%" (
  start "" "%PACKAGED_APP%"
  exit /b 0
)

if exist "%ELECTRON_APP%" if exist "%~dp0out\main\index.js" (
  start "" "%ELECTRON_APP%" "%~dp0"
  exit /b 0
)

> "%LOG%" echo Photo Desk n'est pas encore construit.
>> "%LOG%" echo Executez d'abord les commandes de verification et de construction du projet.
start "" notepad.exe "%LOG%"
exit /b 1
