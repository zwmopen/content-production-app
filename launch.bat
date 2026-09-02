@echo off
set CONTENT_INSTANCE_ID=C
set PORT=4333
set TB_REMOTE_DEBUGGING_PORT=9433
set CONTENT_HTTP_PROXY=http://127.0.0.1:7897
set CONTENT_ACCOUNT_IDS=account-3
set CONTENT_ONLY_MODE=1
set TB_MAIN_WINDOW_SANDBOX=0

cd /d "%~dp0src"
start "" "node_modules\electron\dist\electron.exe" --no-sandbox desktop\main.js
exit
