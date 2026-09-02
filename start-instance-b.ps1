$ErrorActionPreference = "Stop"
$env:CONTENT_INSTANCE_ID = "B"
$env:CONTENT_INSTANCE_LABEL = "实例 B · account-2"
$env:PORT = "4332"
$env:TB_REMOTE_DEBUGGING_PORT = "9432"
$env:CONTENT_HTTP_PROXY = "http://127.0.0.1:7897"
$env:TEAMBUILDING_DASHBOARD_RUNTIME = "D:\AICode\运行数据\江湖有旅人\内容生产App\instance-B"
$env:TEAMBUILDING_SHARED_MATERIAL_ROOT = "D:\AICode\运行数据\江湖有旅人\内容生产App\shared-material"
$env:TB_USER_DATA_ROOT = "D:\AICode\运行数据\江湖有旅人\内容生产App\instance-B\electron-userdata"
$env:CONTENT_ACCOUNT_IDS = "account-2"
$env:CONTENT_ONLY_MODE = "1"
$env:TB_MAIN_WINDOW_SANDBOX = "0"
Set-Location -LiteralPath (Join-Path $PSScriptRoot "src")

# Self-healing: clear stale processes listening on this instance's ports
$oldConns = Get-NetTCPConnection -LocalPort 4332, 9432 -State Listen -ErrorAction SilentlyContinue
foreach ($conn in $oldConns) {
  if ($conn.OwningProcess -gt 0) {
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

# Clear stale singleton lock
$staleLock = Join-Path $env:TB_USER_DATA_ROOT "SingletonLock"
if (Test-Path $staleLock) {
  Remove-Item $staleLock -Force -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force -Path $env:TEAMBUILDING_DASHBOARD_RUNTIME | Out-Null

$electronExe = Join-Path $PSScriptRoot "src\node_modules\electron\dist\electron.exe"
& $electronExe --no-sandbox desktop\main.js
