@echo off
chcp 65001 >nul
echo 正在启动双浏览器（A+C）自主无限生产守护进程...
powershell -ExecutionPolicy Bypass -File "D:\AICode\工具开发\projects\content-production-app\start-dual-browser-production.ps1"
pause
