param([string]$Source = "")

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$projectsRoot = Split-Path -Parent $projectRoot
if ([string]::IsNullOrWhiteSpace($Source)) {
  $Source = Join-Path $projectsRoot "teambuilding-gpt-production-extension\src"
}
$target = Join-Path $projectRoot "src\integrations\gpt-production-extension"
$requiredFiles = @(
  "manifest.json",
  "background.js",
  "gm-shim.js",
  "sidebar.js",
  "sidebar.css",
  "vendor\chatgpt-conversation-tree.user.js"
)

foreach ($relativePath in $requiredFiles) {
  $sourceFile = Join-Path $Source $relativePath
  if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
    throw "GPT extension runtime file is missing: $sourceFile"
  }
}

foreach ($relativePath in $requiredFiles) {
  $sourceFile = Join-Path $Source $relativePath
  $targetFile = Join-Path $target $relativePath
  $targetDirectory = Split-Path -Parent $targetFile
  New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
  Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force
}

$manifest = Get-Content -LiteralPath (Join-Path $target "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Output "Synced GPT extension $($manifest.version) to $target"
