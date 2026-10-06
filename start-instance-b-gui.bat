@echo off
set CONTENT_INSTANCE_ID=B
set CONTENT_INSTANCE_LABEL=实例 B · account-2
set PORT=4332
set TB_REMOTE_DEBUGGING_PORT=9432
set CONTENT_HTTP_PROXY=http://127.0.0.1:17897
set TEAMBUILDING_DASHBOARD_RUNTIME=D:\AICode\运行数据\江湖有旅人\内容生产App\instance-B
set TEAMBUILDING_SHARED_MATERIAL_ROOT=D:\AICode\运行数据\江湖有旅人\内容生产App\shared-material
set TB_USER_DATA_ROOT=D:\AICode\运行数据\江湖有旅人\内容生产App\instance-B\electron-userdata
set CONTENT_ACCOUNT_IDS=account-2
set CONTENT_ONLY_MODE=1
set TB_MAIN_WINDOW_SANDBOX=0
set TB_DESKTOP_HIDDEN=0

if exist "%TB_USER_DATA_ROOT%\SingletonLock" del /f /q "%TB_USER_DATA_ROOT%\SingletonLock" 2>nul

cd /d "D:\AICode\工具开发\projects\content-production-app\src"
start "" "D:\AICode\工具开发\projects\content-production-app\src\node_modules\electron\dist\electron.exe" --remote-debugging-port=9432 --no-sandbox --show "D:\AICode\工具开发\projects\content-production-app\src\desktop\main.js"
