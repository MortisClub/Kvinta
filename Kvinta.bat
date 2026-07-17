@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Первый запуск: устанавливаю зависимости...
  call npm install
)
start "" /b cmd /c "npx electron ."
