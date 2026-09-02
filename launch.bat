@echo off
set CONTENT_INSTANCE_ID=B
set PORT=4332
set TB_REMOTE_DEBUGGING_PORT=9432
set CONTENT_HTTP_PROXY=http://127.0.0.1:7897
set CONTENT_ACCOUNT_IDS=account-2
set CONTENT_ONLY_MODE=1
set TB_MAIN_WINDOW_SANDBOX=0

cd /d "%~dp0src"
start "" "node_modules\electron\dist\electron.exe" --no-sandbox desktop\main.js
exit
