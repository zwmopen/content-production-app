$ErrorActionPreference = "Stop"
$env:CONTENT_INSTANCE_ID = "B"
$env:CONTENT_INSTANCE_LABEL = "实例 B · 账号2"
$env:PORT = "4332"
$env:TB_REMOTE_DEBUGGING_PORT = "9432"
$env:TEAMBUILDING_DASHBOARD_RUNTIME = "D:\AICode\运行数据\江湖有旅人\内容生产App\instance-B"
$env:TEAMBUILDING_SHARED_MATERIAL_ROOT = "D:\AICode\运行数据\江湖有旅人\内容生产App\shared-material"
$env:TB_USER_DATA_ROOT = "D:\AICode\运行数据\江湖有旅人\内容生产App\instance-B\electron-userdata"
$env:CONTENT_ACCOUNT_IDS = "account-2"
$env:CONTENT_ONLY_MODE = "1"
Set-Location -LiteralPath (Join-Path $PSScriptRoot "src")
$node = (Get-Command node.exe -ErrorAction Stop).Source
$serverOut = Join-Path $env:TEAMBUILDING_DASHBOARD_RUNTIME "server.stdout.log"
$serverErr = Join-Path $env:TEAMBUILDING_DASHBOARD_RUNTIME "server.stderr.log"
New-Item -ItemType Directory -Force -Path $env:TEAMBUILDING_DASHBOARD_RUNTIME | Out-Null
$server = Start-Process -FilePath $node -ArgumentList @((Join-Path $PSScriptRoot "src\server.js")) -WorkingDirectory (Join-Path $PSScriptRoot "src") -WindowStyle Hidden -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr -PassThru
$ready = $false
for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
  Start-Sleep -Milliseconds 250
  if ($server.HasExited) { throw "内容生产服务提前退出，详见 $serverErr" }
  $client = [Net.Sockets.TcpClient]::new()
  try { $ready = $client.ConnectAsync("127.0.0.1", 4332).Wait(300) } catch { $ready = $false } finally { $client.Dispose() }
  if ($ready) { break }
}
if (-not $ready) { throw "内容生产服务未能监听 4332，详见 $serverErr" }
$exitCode = 0
try {
  $electronExe = Join-Path $PSScriptRoot "src\node_modules\electron\dist\electron.exe"
  & $electronExe desktop\main.js
  $exitCode = $LASTEXITCODE
} finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}
exit $exitCode
