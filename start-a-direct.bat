@echo off
set CONTENT_ACCOUNT_IDS=account-1
set CONTENT_HTTP_PROXY=http://127.0.0.1:7897
set CONTENT_INSTANCE_ID=A
set CONTENT_INSTANCE_LABEL=实例 A · account-1
set CONTENT_ONLY_MODE=1
set PORT=4331
set TB_MAIN_WINDOW_SANDBOX=0
set TB_REMOTE_DEBUGGING_PORT=9431
set TB_USER_DATA_ROOT=D:\AICode\运行数据\江湖有旅人\内容生产App\instance-A\electron-userdata
set TEAMBUILDING_DASHBOARD_RUNTIME=D:\AICode\运行数据\江湖有旅人\内容生产App\instance-A
set TEAMBUILDING_SHARED_MATERIAL_ROOT=D:\AICode\运行数据\江湖有旅人\内容生产App\shared-material

if exist "%TB_USER_DATA_ROOT%\SingletonLock" del /f /q "%TB_USER_DATA_ROOT%\SingletonLock" 2>nul

cd /d "D:\AICode\工具开发\projects\content-production-app\src"
"node_modules\electron\dist\electron.exe" --remote-debugging-port=9431 --no-sandbox desktop\main.js > "D:\AICode\运行数据\direct_a.log" 2>&1
