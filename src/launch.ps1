$ErrorActionPreference = 'Stop'

$app = Split-Path -Parent $MyInvocation.MyCommand.Path
$aicodeRoot = $app
1..4 | ForEach-Object { $aicodeRoot = Split-Path -Parent $aicodeRoot }

function Join-Chars([int[]]$codes) {
    return -join ($codes | ForEach-Object { [char]$_ })
}

$runtimeLayer = Join-Chars @(0x8FD0,0x884C,0x6570,0x636E)
$projectName = Join-Chars @(0x6C5F,0x6E56,0x6709,0x65C5,0x4EBA)
$appName = Join-Chars @(0x56FE,0x6587,0x751F,0x4EA7,0x63A7,0x5236,0x53F0)
$runtime = Join-Path $aicodeRoot (Join-Path $runtimeLayer (Join-Path $projectName $appName))
$port = 4327
$log = Join-Path $runtime 'dashboard-server.log'
$err = Join-Path $runtime 'dashboard-server.err.log'

New-Item -ItemType Directory -Path $runtime -Force | Out-Null

$existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
$shouldStart = -not $existing

if ($existing) {
    $ownerPid = @($existing)[0].OwningProcess
    $owner = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
    $sourceFiles = @(
        Get-Item (Join-Path $app 'server.js') -ErrorAction SilentlyContinue
        Get-ChildItem (Join-Path $app 'lib') -Recurse -File -ErrorAction SilentlyContinue
        Get-ChildItem (Join-Path $app 'public') -Recurse -File -ErrorAction SilentlyContinue
    )
    $latestSource = $sourceFiles |
        Where-Object { $_.Extension -in @('.js', '.html', '.css', '.json') } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    $sourceChanged = $owner -and $latestSource -and ($latestSource.LastWriteTime -gt $owner.StartTime)
    if ($sourceChanged) {
        $busy = $false
        try {
            $distribution = Invoke-RestMethod "http://127.0.0.1:$port/api/distribution/tasks" -TimeoutSec 3
            $busy = @($distribution | Where-Object { $_.state -notin @('completed', 'failed') }).Count -gt 0
        } catch {}
        try {
            $production = Invoke-RestMethod "http://127.0.0.1:$port/api/production/tasks" -TimeoutSec 3
            $busy = $busy -or (@($production.tasks | Where-Object { $_.status -eq 'running' }).Count -gt 0)
        } catch {}

        if (-not $busy) {
            Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 800
            $shouldStart = $true
        }
    }
}

if ($shouldStart) {
    Start-Process -FilePath 'node' `
        -ArgumentList 'server.js' `
        -WorkingDirectory $app `
        -WindowStyle Hidden `
        -RedirectStandardOutput $log `
        -RedirectStandardError $err
    Start-Sleep -Seconds 2
}

Start-Process "http://127.0.0.1:$port"
