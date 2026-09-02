$ErrorActionPreference = "Stop"
$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$toolsDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$dataDir = (Resolve-Path (Join-Path $rootDir "运行数据\江湖有旅人\内容生产App")).Path

$env:CONTENT_INSTANCE_ID = "C"
$env:CONTENT_INSTANCE_LABEL = "实例 C · account-3"
$env:PORT = "4333"
$env:TB_REMOTE_DEBUGGING_PORT = "9433"
$env:CONTENT_HTTP_PROXY = "http://127.0.0.1:7897"
$env:TEAMBUILDING_DASHBOARD_RUNTIME = (Join-Path $dataDir "instance-C")
$env:TEAMBUILDING_SHARED_MATERIAL_ROOT = (Join-Path $dataDir "shared-material")
$env:TB_USER_DATA_ROOT = (Join-Path $env:TEAMBUILDING_DASHBOARD_RUNTIME "electron-userdata")
$env:CONTENT_ACCOUNT_IDS = "account-3"
$env:CONTENT_ONLY_MODE = "1"
$env:TB_MAIN_WINDOW_SANDBOX = "0"
Set-Location -LiteralPath (Join-Path $PSScriptRoot "src")

# Self-healing: clear stale processes listening on this instance's ports
$oldConns = Get-NetTCPConnection -LocalPort 4333, 9433 -State Listen -ErrorAction SilentlyContinue
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

$electronExe = (Resolve-Path (Join-Path $toolsDir "projects\content-production-app\src\node_modules\electron\dist\electron.exe")).Path
Start-Process -FilePath $electronExe -ArgumentList @("--remote-debugging-port=9433", "--no-sandbox", ".") -WorkingDirectory (Join-Path $PSScriptRoot "src")
