$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$projectsRoot = Split-Path -Parent $projectRoot
$integrationRoot = Join-Path $projectRoot "src\integrations"
$workPackageRoot = Join-Path $integrationRoot "work-package"
$extensionVendorRoot = "D:\AICode\工具开发\projects\teambuilding-gpt-production-extension\src\vendor"

New-Item -ItemType Directory -Force -Path $integrationRoot, $workPackageRoot, $extensionVendorRoot | Out-Null

$workPackageSourceRoot = "D:\AICode\运行数据\江湖有旅人\团建工作台\work-package"

$publicAssets = @(
  @{
    Source = Join-Path $projectsRoot "chatgpt-conversation-tree\src\chatgpt-conversation-tree.user.js"
    Target = Join-Path $integrationRoot "chatgpt-conversation-tree.user.js"
  },
  @{
    Source = Join-Path $workPackageSourceRoot "configure_work_package.ps1"
    Target = Join-Path $workPackageRoot "configure_work_package.ps1"
  },
  @{
    Source = Join-Path $workPackageSourceRoot "make_work_package.ps1"
    Target = Join-Path $workPackageRoot "make_work_package.ps1"
  }
)

foreach ($asset in $publicAssets) {
  if (Test-Path -LiteralPath $asset.Source) {
    Copy-Item -LiteralPath $asset.Source -Destination $asset.Target -Force
  }
}

$syncedUserscript = Join-Path $integrationRoot "chatgpt-conversation-tree.user.js"
if (Test-Path -LiteralPath $syncedUserscript) {
  Copy-Item -LiteralPath $syncedUserscript `
    -Destination (Join-Path $extensionVendorRoot "chatgpt-conversation-tree.user.js") `
    -Force
}

# Preserve the existing VBS launchers as parallel fallbacks without depending on localized names.
Get-ChildItem -LiteralPath $workPackageSourceRoot -Filter "*.vbs" -File -ErrorAction SilentlyContinue | ForEach-Object {
  $source = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
  if ($source -match "(configure|make)_work_package\.ps1") {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $workPackageRoot $_.Name) -Force
  }
}

Write-Output "Integration assets synchronized."
