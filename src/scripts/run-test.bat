@echo off
chcp 65001 >nul
cd /d "D:\AICode\工具开发\projects\content-production-app\src"
"node_modules\electron\dist\electron.exe" --no-sandbox "scripts\test-cookie-import.js"
