$ErrorActionPreference = 'Stop'

$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Join-Path $project 'src'
$launcher = Join-Path $app 'launch.ps1'
$desktopMain = Join-Path $app 'desktop\main.js'
$electronCandidates = @(
    (Join-Path $app 'node_modules\electron\dist\electron.exe'),
    (Join-Path (Split-Path -Parent $project) 'anygen-workbench\node_modules\electron\dist\electron.exe')
)
$electron = $electronCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

# 统一配置数据目录：GPT 登录态、账号配置、窗口位置等
# 开发版通过 TB_USER_DATA_ROOT 环境变量让 main.js 的 app.setPath("userData") 生效
$userDataRoot = "D:\AICode\运行数据\江湖有旅人\团建工作台\electron-userdata"
if (-not (Test-Path $userDataRoot)) { New-Item -ItemType Directory -Path $userDataRoot -Force | Out-Null }

if ($electron -and (Test-Path -LiteralPath $desktopMain)) {
    # PowerShell 5.1 不支持 Start-Process 的 -Environment 参数
    # 用 $env: 变量传递给子进程，子进程继承当前环境变量
    $env:TB_USER_DATA_ROOT = $userDataRoot
    Start-Process -FilePath $electron -ArgumentList $desktopMain -WorkingDirectory $app
    exit
}

if (-not (Test-Path -LiteralPath $launcher)) {
    throw "Launcher not found: $launcher"
}

& $launcher
