$ErrorActionPreference = 'Stop'

$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Join-Path $project 'src'
$port = 4337
$runtime = Join-Path $env:LOCALAPPDATA 'TeambuildingWorkbenchDev'
$workPackageConfig = Join-Path $runtime 'workpkg_config.dev.json'
$log = Join-Path $runtime 'dashboard-dev.log'
$err = Join-Path $runtime 'dashboard-dev.err.log'

New-Item -ItemType Directory -Path $runtime -Force | Out-Null
if (-not (Test-Path -LiteralPath $workPackageConfig)) {
    $stableConfig = 'D:\Download\workpkg_config.json'
    if (Test-Path -LiteralPath $stableConfig) {
        Copy-Item -LiteralPath $stableConfig -Destination $workPackageConfig
    } else {
        '{}' | Set-Content -LiteralPath $workPackageConfig -Encoding UTF8
    }
}

$existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $existing) {
    $commandText = @"
`$env:PORT='$port'
`$env:TEAMBUILDING_DASHBOARD_RUNTIME='$($runtime.Replace("'","''"))'
`$env:TEAMBUILDING_WORKPKG_CONFIG_FILE='$($workPackageConfig.Replace("'","''"))'
`$env:TB_WORKBENCH_CHANNEL='dev-test'
`$env:TB_WORKBENCH_HOST='0.0.0.0'
Set-Location -LiteralPath '$($app.Replace("'","''"))'
node server.js
"@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($commandText))
    Start-Process -FilePath 'powershell.exe' `
        -ArgumentList @('-NoProfile', '-EncodedCommand', $encoded) `
        -WindowStyle Hidden `
        -RedirectStandardOutput $log `
        -RedirectStandardError $err
    Start-Sleep -Seconds 2
}

Start-Process "http://127.0.0.1:$port"
