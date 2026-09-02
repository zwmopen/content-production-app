@echo off
set CONTENT_INSTANCE_ID=A
set PORT=4331
set TB_REMOTE_DEBUGGING_PORT=9431
set CONTENT_HTTP_PROXY=http://127.0.0.1:7897
set CONTENT_ACCOUNT_IDS=account-1
set CONTENT_ONLY_MODE=1
set TB_MAIN_WINDOW_SANDBOX=0

cd /d "%~dp0src"
start "" "node_modules\electron\dist\electron.exe" --no-sandbox desktop\main.js
exit
