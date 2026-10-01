param(
    [switch]$LoopMode = $false
)
# Windows 原生操作系统级脱壳守护脚本（独立于任何 IDE / AI 聊天终端）

# [2026-09-23 修] 从 WorkBuddy 沙箱 shell 里被调用时，父进程会注入大小写重复的环境变量
# （如 Path/PATH、HTTPS_PROXY/https_proxy），PowerShell 的 Start-Process 把它们当字典键处理，
# Windows 环境变量大小写不敏感 → 抛 "已添加项。字典中的关键字:Path/PATH" 导致拉起主脑失败。
# 这里在脚本入口处统一清掉重复的大小写变体，只保留一种标准写法，保证 Start-Process 干净可用。
try {
    $dupKeys = 'Path', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY'
    foreach ($k in $dupKeys) {
        # 若同时存在大小写两个键，删掉小写变体（保留系统标准的大写形式）
        if (Test-Path "Env:$k" -ErrorAction SilentlyContinue) {
            $lower = $k.ToLowerInvariant()
            if ($lower -ne $k -and (Test-Path "Env:$lower" -ErrorAction SilentlyContinue)) {
                Remove-Item "Env:$lower" -Force -ErrorAction SilentlyContinue
            }
        }
    }
} catch {}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$rootDir = Split-Path -Parent $scriptDir
$aicodeRoot = (Get-Item $rootDir).Parent.Parent.Parent.FullName
$logFile = Join-Path $aicodeRoot "运行数据\windows_watchdog.log"
$nodePath = if (Test-Path "D:\Program Files\nodejs\node.exe") { "D:\Program Files\nodejs\node.exe" } else { "node.exe" }
$pythonPath = if (Test-Path "C:\Users\z\AppData\Local\Programs\Python\Python311\python.exe") { "C:\Users\z\AppData\Local\Programs\Python\Python311\python.exe" } else { "python.exe" }

function Write-WatchdogLog($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] [WATCHDOG] $msg"
    Write-Host $line
    try {
        Add-Content -Path $logFile -Value $line -Encoding UTF8
    } catch {}
}

function Test-PauseFlag($name) {
    # 人工暂停开关：存在 <运行数据>\watchdog_pause_<name>.flag 时，跳过该组件的补位拉起。
    # 两种恢复方式：
    #   (1) 手动删除 flag 文件；
    #   (2) 【定时自愈】flag 内含 EXPIRES=yyyy-MM-dd HH:mm:ss 且已到时 → 自动删除该 flag 并恢复守护。
    #       用于长冷却期复工（如 A 实例 19:30 复工），避免只依赖 automation 单点（宿主重启会丢 automation）。
    # 注意：删除/日志各自独立兜底，最终 return 不受任何异常影响（曾因 return 写在 try 内被 catch 吞掉而误报）。
    $flag = Join-Path $aicodeRoot "运行数据\watchdog_pause_$name.flag"
    if (-not (Test-Path $flag)) { return $false }
    $exp = $null
    try {
        $content = Get-Content -Path $flag -Raw -Encoding UTF8 -ErrorAction Stop
        $m = [regex]::Match([string]$content, 'EXPIRES\s*=\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)')
        if ($m.Success) { $exp = [datetime]::Parse($m.Groups[1].Value) }
    } catch { $exp = $null }
    if ($null -ne $exp -and (Get-Date) -ge $exp) {
        try { Remove-Item -Path $flag -Force -ErrorAction Stop } catch {}
        try { Write-WatchdogLog "⏰ 实例 $name 暂停已到期 ($($exp.ToString('yyyy-MM-dd HH:mm:ss')))，自动解除 flag，恢复补位守护" } catch {}
        return $false
    }
    return $true
}

function Check-And-Heal {
    # 1. 检查实例 A 守护
    if (Test-PauseFlag "A") {
        Write-WatchdogLog "⏸️ 实例 A 处于人工暂停状态 (watchdog_pause_A.flag)，跳过补位拉起"
    } else {
        $aCount = (Get-CimInstance Win32_Process -Filter "CommandLine like '%run-instance-a-daemon.js%'" -ErrorAction SilentlyContinue | Measure-Object).Count
        if ($aCount -eq 0) {
            Write-WatchdogLog "⚠️ 检测到实例 A 守护未运行，正在 Windows 原生后台拉起..."
            Start-Process -FilePath $nodePath -ArgumentList "`"$rootDir\scripts\run-instance-a-daemon.js`"" -WorkingDirectory $rootDir -WindowStyle Hidden
        }
    }

    # 2. 检查实例 B 守护（2026-09-23 补齐：此前看门狗漏了 B，导致 B 浏览器退出后无人补位 → 长期 OFFLINE）
    if (Test-PauseFlag "B") {
        Write-WatchdogLog "⏸️ 实例 B 处于人工暂停状态 (watchdog_pause_B.flag)，跳过补位拉起"
    } else {
        $bCount = (Get-CimInstance Win32_Process -Filter "CommandLine like '%run-instance-b-daemon.js%'" -ErrorAction SilentlyContinue | Measure-Object).Count
        if ($bCount -eq 0) {
            Write-WatchdogLog "⚠️ 检测到实例 B 守护未运行，正在 Windows 原生后台拉起..."
            Start-Process -FilePath $nodePath -ArgumentList "`"$rootDir\scripts\run-instance-b-daemon.js`"" -WorkingDirectory $rootDir -WindowStyle Hidden
        }
    }

    # 2b. 检查实例 C 守护
    if (Test-PauseFlag "C") {
        Write-WatchdogLog "⏸️ 实例 C 处于人工暂停状态 (watchdog_pause_C.flag)，跳过补位拉起"
    } else {
        $cCount = (Get-CimInstance Win32_Process -Filter "CommandLine like '%run-instance-c-daemon.js%'" -ErrorAction SilentlyContinue | Measure-Object).Count
        if ($cCount -eq 0) {
            Write-WatchdogLog "⚠️ 检测到实例 C 守护未运行，正在 Windows 原生后台拉起..."
            Start-Process -FilePath $nodePath -ArgumentList "`"$rootDir\scripts\run-instance-c-daemon.js`"" -WorkingDirectory $rootDir -WindowStyle Hidden
        }
    }

    # 3. 检查生产主脑脚本
    if (Test-PauseFlag "producer") {
        Write-WatchdogLog "⏸️ 生产主脑处于人工暂停状态 (watchdog_pause_producer.flag)，跳过补位拉起"
    } else {
        # [2026-09-25 新增] 主脑「心跳自愈」—— 填补本脚本最大的盲区。
        # 事故复盘：主脑在 CDP 长文本注入超时后整个 asyncio 协程挂死，进程还在（WMI 查得到）、
        # 心跳却停在 2026-09-25 00:47:22 不动 —— 而本脚本「只补位不杀」，只要进程在就永不介入，
        # 于是 CDP 产线静默停摆 4.5 小时、整夜零产出、还搭进去 2 套素材，全程无人知晓。
        # 现在改为按心跳判定：心跳超过 20 分钟未更新即认定协程挂死，强制终止，交给下面补位逻辑重启。
        try {
            $statusPath = Join-Path $aicodeRoot "运行数据\autonomous_production_daemon_status.json"
            if (Test-Path $statusPath) {
                $st = Get-Content -Path $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
                $hbRaw = [string]$st.last_heartbeat
                if ($hbRaw) {
                    $hb = [datetime]::Parse($hbRaw)
                    $ageMin = ((Get-Date) - $hb).TotalMinutes
                    if ($ageMin -gt 20) {
                        Write-WatchdogLog "🩺 主脑心跳停滞 $([math]::Round($ageMin,1)) 分钟（阈值 20 分钟），判定协程挂死，强制终止并交给本轮补位重启"
                        Get-CimInstance Win32_Process -Filter "CommandLine like '%dual_browser_autonomous_producer.py%'" -ErrorAction SilentlyContinue |
                            ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
                        Start-Sleep -Seconds 3
                    }
                }
            }
        } catch {
            Write-WatchdogLog "心跳自检异常（忽略，不影响补位逻辑）: $($_.Exception.Message)"
        }

        # [2026-09-22] WMI 偶发超时会返回空结果 -> 假阴性 -> 误判主脑缺失并重复拉起
        # （实测 16:20:07 判"未运行"并拉起，16:20:19 新进程自己发现已有 30652 而退出）。
        # 复检一次再决定，避免无谓的重复拉起与日志抖动。
        $producerFilter = "CommandLine like '%dual_browser_autonomous_producer.py%'"
        $producerCount = (Get-CimInstance Win32_Process -Filter $producerFilter -ErrorAction SilentlyContinue | Measure-Object).Count
        if ($producerCount -eq 0) {
            Start-Sleep -Seconds 3
            $producerCount = (Get-CimInstance Win32_Process -Filter $producerFilter -ErrorAction SilentlyContinue | Measure-Object).Count
        }
        if ($producerCount -eq 0) {
            Write-WatchdogLog "⚠️ 检测到生产主脑未运行，正在 Windows 原生后台拉起..."
            # [2026-09-22] 每次拉起用带时间戳的独立重定向文件：
            # Start-Process 的重定向是"覆盖写"，固定文件名会把上一次
            # 的崩溃原因直接冲掉（实测抖动期完全查不到死因）。
            $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
            $stdoutLog = "D:\AICode\运行数据\dual_daemon_stdout_$stamp.log"
            $stderrLog = "D:\AICode\运行数据\dual_daemon_stderr_$stamp.log"
            Start-Process -FilePath $pythonPath -ArgumentList "-u `"$rootDir\scripts\dual_browser_autonomous_producer.py`"" -WorkingDirectory "D:\AICode" -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -WindowStyle Hidden

            # 只保留最近 40 组历史重定向，避免无限膨胀
            try {
                Get-ChildItem "D:\AICode\运行数据\dual_daemon_std*_*.log" -ErrorAction SilentlyContinue |
                    Sort-Object LastWriteTime -Descending | Select-Object -Skip 40 |
                    Remove-Item -Force -ErrorAction SilentlyContinue
            } catch {}
        } else {
            Write-WatchdogLog "✅ 生产流水线运行正常 (主脑与双守护均存活)"
        }
    }
}

Write-WatchdogLog "Windows 原生守护进程启动核检..."
Check-And-Heal

if ($LoopMode) {
    Write-WatchdogLog "进入常驻循环守护模式 (每 180 秒自检一次)..."
    while ($true) {
        Start-Sleep -Seconds 180
        Check-And-Heal
    }
}
