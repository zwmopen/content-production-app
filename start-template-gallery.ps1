param(
    [switch]$Restart
)

$ErrorActionPreference = "Stop"
$port = 4327
$collectorPort = 8766
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverRoot = Join-Path $projectRoot "src"
$collectorRoot = Join-Path (Split-Path -Parent $projectRoot) "xhs-dl"
$collectorScript = Join-Path $collectorRoot "collector_bridge_api.py"

function Get-PortOwner {
    try {
        $connection = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
            Select-Object -First 1 -ExpandProperty OwningProcess
        if ($connection) { return [int]$connection }
    } catch {
        # Fall back to netstat when the TCP cmdlet is unavailable or access is restricted.
    }

    $line = netstat -ano -p tcp 2>$null |
        Select-String ("\s127\.0\.0\.1:" + $port + "\s+.*LISTENING\s+(\d+)$") |
        Select-Object -First 1
    if ($line -and $line.Matches.Count -gt 0) {
        return [int]$line.Matches[0].Groups[1].Value
    }
    return $null
}

function Get-LocalPortOwner([int]$targetPort) {
    try {
        $connection = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $targetPort -State Listen -ErrorAction Stop |
            Select-Object -First 1 -ExpandProperty OwningProcess
        if ($connection) { return [int]$connection }
    } catch {
        # Fall back to netstat below when Windows restricts TCP table access.
    }
    $line = netstat -ano -p tcp 2>$null |
        Select-String ("\s127\.0\.0\.1:" + $targetPort + "\s+.*LISTENING\s+(\d+)$") |
        Select-Object -First 1
    if ($line -and $line.Matches.Count -gt 0) { return [int]$line.Matches[0].Groups[1].Value }
    return $null
}

function Ensure-CollectorBridge {
    $owner = Get-LocalPortOwner $collectorPort
    if (-not $owner) {
        if (-not (Test-Path -LiteralPath $collectorScript)) {
            throw "Collector API script not found: $collectorScript"
        }
        $python = (Get-Command python.exe -ErrorAction Stop).Source
        $logsRoot = $collectorRoot
        $claimDir = Join-Path $collectorRoot "runtime\download_claims"
        New-Item -ItemType Directory -Path $claimDir -Force | Out-Null
        $env:XHS_DL_CLAIM_DIR = $claimDir
        $stdout = Join-Path $logsRoot "collector_bridge_runtime.log"
        $stderr = Join-Path $logsRoot "collector_bridge_runtime.err.log"
        $collectorArgs = '"' + $collectorScript + '" --host 127.0.0.1 --port ' + $collectorPort
        Start-Process -FilePath $python -ArgumentList $collectorArgs -WorkingDirectory $collectorRoot -WindowStyle Hidden `
            -RedirectStandardOutput $stdout -RedirectStandardError $stderr | Out-Null
        $deadline = (Get-Date).AddSeconds(12)
        do {
            Start-Sleep -Milliseconds 250
            $owner = Get-LocalPortOwner $collectorPort
        } while (-not $owner -and (Get-Date) -lt $deadline)
    }
    if (-not $owner) { throw "Collector API failed to listen on 127.0.0.1:$collectorPort; see $collectorRoot\collector_bridge_runtime.err.log" }

    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$collectorPort/api/v1/status" -UseBasicParsing -TimeoutSec 8
        if ($response.StatusCode -ne 200) { throw "HTTP $($response.StatusCode)" }
        $status = $response.Content | ConvertFrom-Json
        if (-not $status.collector) { throw "Health response has no collector state" }
    } catch {
        throw "Collector API port conflict or health check failed (127.0.0.1:$collectorPort): $($_.Exception.Message)"
    }
    Write-Output "Collector API is running: http://127.0.0.1:$collectorPort (PID $owner; paused=$($status.collector.pause.paused))"
}

if ($Restart) {
    $collectorOwner = Get-LocalPortOwner $collectorPort
    if ($collectorOwner) {
        try {
            $jobs = Invoke-RestMethod -Uri "http://127.0.0.1:$collectorPort/api/v1/jobs" -TimeoutSec 5
            $activeJobs = @($jobs.jobs | Where-Object { $_.status -in @("queued", "running") })
            if ($activeJobs.Count -gt 0) {
                throw "采集 API 仍有 $($activeJobs.Count) 条任务处理中；为免中断下载，先不重启采集器。"
            }
        } catch {
            throw "无法确认采集队列是否空闲，先不重启采集器：$($_.Exception.Message)"
        }
        Stop-Process -Id $collectorOwner -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }
    $owner = Get-PortOwner
    if ($owner) {
        Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }
}

Ensure-CollectorBridge

$owner = Get-PortOwner
if (-not $owner) {
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    Start-Process -FilePath $node -ArgumentList @("server.js") -WorkingDirectory $serverRoot -WindowStyle Hidden | Out-Null
    for ($attempt = 0; $attempt -lt 30 -and -not $owner; $attempt++) {
        Start-Sleep -Milliseconds 500
        $owner = Get-PortOwner
    }
}

if (-not $owner) {
    throw "Template gallery service failed to listen on port $port."
}

Write-Output "Template gallery service is running: http://127.0.0.1:$port/template-gallery (PID $owner)"
