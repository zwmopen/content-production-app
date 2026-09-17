@echo off
chcp 65001 >nul
echo 正在拉取自主无限生产守护进程...
powershell -ExecutionPolicy Bypass -File "D:\AICode\工具开发\projects\content-production-app\start-infinite-production.ps1"
pause
