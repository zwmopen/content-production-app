# Start Instance A with clean environment
$lockFile = "D:\AICode\运行数据\江湖有旅人\内容生产App\instance-A\electron-userdata\SingletonLock"
if (Test-Path $lockFile) {
    Remove-Item -Force $lockFile -ErrorAction SilentlyContinue
}

$env:CONTENT_INSTANCE_ID = "A"
$env:CONTENT_INSTANCE_LABEL = "实例 A · account-1"
$env:PORT = "4331"
$env:TB_REMOTE_DEBUGGING_PORT = "9431"
$env:CONTENT_HTTP_PROXY = "http://127.0.0.1:17897"
$env:TEAMBUILDING_DASHBOARD_RUNTIME = "D:\AICode\运行数据\江湖有旅人\内容生产App\instance-A"
$env:TEAMBUILDING_SHARED_MATERIAL_ROOT = "D:\AICode\运行数据\江湖有旅人\内容生产App\shared-material"
$env:TB_USER_DATA_ROOT = "D:\AICode\运行数据\江湖有旅人\内容生产App\instance-A\electron-userdata"
$env:CONTENT_ACCOUNT_IDS = "account-1"
$env:CONTENT_ONLY_MODE = "1"
$env:TB_MAIN_WINDOW_SANDBOX = "0"
$env:TB_DESKTOP_HIDDEN = "0"

Push-Location "D:\AICode\工具开发\projects\content-production-app\src"
$proc = Start-Process -FilePath ".\node_modules\electron\dist\electron.exe" -ArgumentList "--remote-debugging-port=9431 --no-sandbox --show desktop\main.js" -PassThru
Pop-Location
Write-Host "Instance A launched with PID: $($proc.Id)"
