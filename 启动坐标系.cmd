@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 24 或更高版本。
  pause
  exit /b 1
)
if not exist node_modules\vite\bin\vite.js (
  echo 正在安装依赖...
  call npm.cmd install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo 启动后请打开 http://127.0.0.1:4174
node scripts\dev.mjs
pause
