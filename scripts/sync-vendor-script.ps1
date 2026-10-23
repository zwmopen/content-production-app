#requires -Version 5.1
<#
.SYNOPSIS
  同步内置油猴脚本（vendor）到上游最新版。方案 C 之后 vendor 是纯净上游副本，可整文件替换。

.DESCRIPTION
  - 上游地址默认走 GitHub Contents API（绕过 raw.githubusercontent.com 的 CDN 缓存延迟）
  - -Check 只比对版本，不改任何文件
  - 覆盖前自动备份旧 vendor 到 backups/
  - manifest.json 的 patch 版本号自动 +1（内容脚本变了，扩展版本要跟着动，否则浏览器不重载）

.EXAMPLE
  .\sync-vendor-script.ps1 -Check
  .\sync-vendor-script.ps1
  .\sync-vendor-script.ps1 -Source "D:\path\to\chatgpt-conversation-tree.user.js"
#>
[CmdletBinding()]
param(
  [string]$Source = 'https://api.github.com/repos/zwmopen/scripts/contents/chatgpt-conversation-tree.user.js?ref=master',
  [switch]$Check,
  [string]$Proxy = 'http://127.0.0.1:7897'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # 关掉 Invoke-WebRequest 的进度条，否则输出被刷满

$repoRoot    = Split-Path -Parent $PSScriptRoot
$extDir      = Join-Path $repoRoot 'src\integrations\gpt-production-extension'
$vendorFile  = Join-Path $extDir 'vendor\chatgpt-conversation-tree.user.js'
$manifestFile= Join-Path $extDir 'manifest.json'
$backupDir   = Join-Path $repoRoot 'backups'

function Get-ScriptVersion {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return $null }
  $head = Get-Content -Path $Path -TotalCount 25 -Encoding UTF8
  foreach ($line in $head) {
    if ($line -match '^//\s*@version\s+(\S+)') { return $Matches[1] }
  }
  return $null
}

function Compare-SemVer {
  param([string]$A, [string]$B)
  try {
    $va = [version]($A -replace '[^0-9\.].*$', '')
    $vb = [version]($B -replace '[^0-9\.].*$', '')
    return $va.CompareTo($vb)
  } catch {
    if ($A -eq $B) { return 0 }
    return 1
  }
}

function Save-Remote {
  param([string]$Uri, [string]$OutFile)
  $headers = @{ 'Accept' = 'application/vnd.github.raw'; 'User-Agent' = 'sync-vendor-script' }
  $attempts = @(
    @{ Name = '直连'; Web = $null },
    @{ Name = "代理 $Proxy"; Web = $Proxy }
  )
  foreach ($a in $attempts) {
    try {
      # 注意：不要用 $args 当变量名，它是 PowerShell 的保留自动变量
      $req = @{ Uri = $Uri; OutFile = $OutFile; UseBasicParsing = $true; Headers = $headers; TimeoutSec = 60 }
      if ($a.Web) { $req['Proxy'] = $a.Web }
      Write-Host ("  拉取（{0}）..." -f $a.Name)
      Invoke-WebRequest @req | Out-Null
      if ((Test-Path $OutFile) -and ((Get-Item $OutFile).Length -gt 10240)) {
        Write-Host ("  成功，{0} 字节" -f (Get-Item $OutFile).Length)
        return $true
      }
    } catch {
      Write-Host ("  失败：{0}" -f $_.Exception.Message)
    }
  }
  return $false
}

Write-Host '=== 内置脚本同步（vendor <- 上游） ===' -ForegroundColor Cyan

$localVer = Get-ScriptVersion -Path $vendorFile
if (-not $localVer) { throw "本地 vendor 不存在或读不到 @version：$vendorFile" }
Write-Host ("本地 vendor 版本 : {0}" -f $localVer)

$isRemote = $Source -match '^https?://'
$tmp = Join-Path $env:TEMP ("vendor-sync-" + [Guid]::NewGuid().ToString('N') + ".user.js")

if ($isRemote) {
  if (-not (Save-Remote -Uri $Source -OutFile $tmp)) {
    throw '上游拉取失败：直连和代理都不通，请检查网络/代理端口。'
  }
} else {
  if (-not (Test-Path $Source)) { throw "源文件不存在：$Source" }
  Copy-Item -Path $Source -Destination $tmp -Force
}

$remoteVer = Get-ScriptVersion -Path $tmp
if (-not $remoteVer) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue; throw '上游文件读不到 @version，可能拿到的是错误页。' }
Write-Host ("上游最新版本     : {0}" -f $remoteVer)

$cmp = Compare-SemVer -A $remoteVer -B $localVer

if ($cmp -le 0) {
  Write-Host ''
  Write-Host '已是最新，无需替换。' -ForegroundColor Green
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  return
}

Write-Host ''
Write-Host ("发现新版本：{0} -> {1}" -f $localVer, $remoteVer) -ForegroundColor Yellow

if ($Check) {
  Write-Host '（-Check 模式，未改动任何文件）' -ForegroundColor DarkGray
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  return
}

# 1) 备份
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir -Force | Out-Null }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bak = Join-Path $backupDir ("vendor-{0}-{1}.user.js" -f $localVer, $stamp)
Copy-Item -Path $vendorFile -Destination $bak -Force
Write-Host ("已备份旧版 -> {0}" -f $bak) -ForegroundColor DarkGray

# 2) 覆盖 vendor
Copy-Item -Path $tmp -Destination $vendorFile -Force
Remove-Item $tmp -Force -ErrorAction SilentlyContinue
Write-Host ("已覆盖 vendor -> {0}" -f $remoteVer) -ForegroundColor Green

# 3) manifest patch +1（只动 version 字段，保留原格式与中文）
$raw = [System.IO.File]::ReadAllText($manifestFile, [System.Text.Encoding]::UTF8)
if ($raw -match '"version"\s*:\s*"(\d+)\.(\d+)\.(\d+)"') {
  $maj = [int]$Matches[1]; $min = [int]$Matches[2]; $pat = [int]$Matches[3]
  $newPatch = $pat + 1
  $newVer = "{0}.{1}.{2}" -f $maj, $min, $newPatch
  $raw2 = [regex]::Replace($raw, '"version"\s*:\s*"\d+\.\d+\.\d+"', ('"version": "' + $newVer + '"'), 1)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($manifestFile, $raw2, $utf8NoBom)
  Write-Host ("扩展版本 -> {0}.{1}.{2} -> {3}`n" -f $maj, $min, $pat, $newVer) -ForegroundColor Green
} else {
  Write-Host '警告：manifest.json 里没匹配到 version 字段，请手工改。' -ForegroundColor Yellow
}

Write-Host '完成。下一步：重启内容制作 App（或重新加载 ChatGPT 页面）让新脚本生效。' -ForegroundColor Cyan
