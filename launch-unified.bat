@echo off
chcp 65001 >nul
set CONTENT_INSTANCE_ID=A
set CONTENT_INSTANCE_LABEL=UnifiedCore
set PORT=4331
set TB_REMOTE_DEBUGGING_PORT=9431
set CONTENT_HTTP_PROXY=http://127.0.0.1:7897
set TEAMBUILDING_DASHBOARD_RUNTIME=D:\AICode\运行数据\江湖有旅人\内容生产App\unified-runtime
set TEAMBUILDING_SHARED_MATERIAL_ROOT=D:\AICode\运行数据\江湖有旅人\内容生产App\shared-material
set TB_USER_DATA_ROOT=D:\AICode\运行数据\江湖有旅人\内容生产App\unified-runtime\electron-userdata
set CONTENT_ACCOUNT_IDS=
set CONTENT_ONLY_MODE=0
set TB_MAIN_WINDOW_SANDBOX=0
set TB_DESKTOP_HIDDEN=1

if exist "%TB_USER_DATA_ROOT%\SingletonLock" del /f /q "%TB_USER_DATA_ROOT%\SingletonLock" >nul 2>&1
if exist "%TB_USER_DATA_ROOT%\SingletonSocket" del /f /q "%TB_USER_DATA_ROOT%\SingletonSocket" >nul 2>&1
if exist "%TB_USER_DATA_ROOT%\SingletonCookie" del /f /q "%TB_USER_DATA_ROOT%\SingletonCookie" >nul 2>&1

cd /d "D:\AICode\工具开发\projects\content-production-app\src"
start "" "D:\AICode\工具开发\projects\content-production-app\src\node_modules\electron\dist\electron.exe" --remote-debugging-port=9431 --no-sandbox --force-webrtc-ip-handling-policy=disable_non_proxied_udp --proxy-server=%CONTENT_HTTP_PROXY% "D:\AICode\工具开发\projects\content-production-app\src\desktop\main.js"
exit
